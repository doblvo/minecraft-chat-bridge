const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const MOD_SECRET = process.env.MOD_SECRET || 'change_me_mod_secret';
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 150);
const MAX_OUTBOX = Number(process.env.MAX_OUTBOX || 50);
const SERVER_STALE_MS = Number(process.env.SERVER_STALE_MS || 20000);

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 20000
});

const history = [];
const outboxByServer = new Map();
const serverStatusById = new Map();
const lastPostByPlayer = new Map();

function sanitizeText(value, maxLen) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function normalizeRole(role) {
  const value = sanitizeText(role, 20).toLowerCase();
  if (['admin', 'writer', 'viewer'].includes(value)) return value;
  return 'viewer';
}

function canWrite(role) {
  return role === 'admin' || role === 'writer';
}

function parsePanelUsers() {
  const raw = process.env.PANEL_USERS;

  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      const users = new Map();

      for (const [token, user] of Object.entries(parsed)) {
        const cleanToken = String(token || '').trim();
        const name = sanitizeText(user?.name || 'Panel User', 32) || 'Panel User';
        const role = normalizeRole(user?.role || 'viewer');

        if (cleanToken) {
          users.set(cleanToken, { name, role, canWrite: canWrite(role) });
        }
      }

      if (users.size > 0) return users;
    } catch (error) {
      console.error('[CONFIG] PANEL_USERS JSON inválido:', error.message);
    }
  }

  // Backward-compatible fallback for V1 style config.
  const fallbackToken = String(process.env.PANEL_TOKEN || '1234').trim();
  const fallbackName = sanitizeText(process.env.PANEL_NAME || 'Felipe', 32) || 'Felipe';
  const fallbackRole = normalizeRole(process.env.PANEL_ROLE || 'admin');
  const users = new Map();
  users.set(fallbackToken, { name: fallbackName, role: fallbackRole, canWrite: canWrite(fallbackRole) });
  return users;
}

const PANEL_USERS = parsePanelUsers();
console.log(`[CONFIG] Panel users loaded: ${PANEL_USERS.size}`);

function pushHistory(payload) {
  history.push(payload);
  while (history.length > MAX_HISTORY) history.shift();
}

function getOutbox(serverId) {
  if (!outboxByServer.has(serverId)) outboxByServer.set(serverId, []);
  return outboxByServer.get(serverId);
}

function requireModSecret(req, res, next) {
  const secret = req.header('x-mod-secret');
  if (!MOD_SECRET || secret !== MOD_SECRET) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }
  next();
}

function getPanelUserFromToken(token) {
  const cleanToken = String(token || '').trim();
  return PANEL_USERS.get(cleanToken) || null;
}

function publicServerStatus(serverId = 'main') {
  const id = sanitizeText(serverId, 40) || 'main';
  const raw = serverStatusById.get(id);
  const now = Date.now();

  if (!raw) {
    return {
      serverId: id,
      online: false,
      stale: true,
      maxPlayers: 0,
      players: [],
      playerCount: 0,
      lastSeen: null,
      ageMs: null
    };
  }

  const ageMs = now - raw.lastSeen;
  const stale = ageMs > SERVER_STALE_MS;
  const players = stale ? [] : raw.players;

  return {
    serverId: id,
    online: !stale && raw.online,
    stale,
    maxPlayers: raw.maxPlayers,
    players,
    playerCount: players.length,
    lastSeen: raw.lastSeen,
    ageMs
  };
}

function allPublicServerStatuses() {
  const ids = new Set(['main', ...serverStatusById.keys()]);
  return Array.from(ids).map((id) => publicServerStatus(id));
}

function publicPanelUsers() {
  const countsByUser = new Map();

  for (const [, socket] of io.of('/').sockets) {
    const user = socket.data?.user;
    if (!user) continue;

    const key = `${user.name}|${user.role}`;
    const current = countsByUser.get(key) || {
      name: user.name,
      role: user.role,
      count: 0
    };

    current.count += 1;
    countsByUser.set(key, current);
  }

  return Array.from(countsByUser.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function broadcastStatus() {
  io.emit('server-status', allPublicServerStatuses());
  io.emit('panel-users', publicPanelUsers());
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = getPanelUserFromToken(token);

  if (!user) {
    return next(new Error('UNAUTHORIZED'));
  }

  socket.data.user = user;
  next();
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  console.log(`[PANEL] ${user.name} connected as ${user.role}: ${socket.id}`);

  socket.emit('me', user);
  socket.emit('history', history);
  socket.emit('server-status', allPublicServerStatuses());
  socket.emit('panel-users', publicPanelUsers());
  broadcastStatus();

  socket.on('web-chat', (data) => {
    const currentUser = socket.data.user;

    if (!currentUser?.canWrite) {
      socket.emit('toast', { type: 'error', message: 'Tu usuario es solo lectura.' });
      return;
    }

    const serverId = sanitizeText(data?.serverId || 'main', 40) || 'main';
    const message = sanitizeText(data?.message, 300);

    if (!message) return;

    const payload = {
      id: crypto.randomUUID(),
      serverId,
      source: 'web',
      player: currentUser.name,
      role: currentUser.role,
      message,
      ts: Date.now()
    };

    const queue = getOutbox(serverId);
    queue.push(payload);
    while (queue.length > MAX_OUTBOX) queue.shift();

    pushHistory(payload);
    io.emit('chat', payload);
  });

  socket.on('disconnect', () => {
    console.log(`[PANEL] ${user.name} disconnected: ${socket.id}`);
    broadcastStatus();
  });
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'minecraft-chat-bridge',
    version: '2.0.0',
    panelUsers: PANEL_USERS.size,
    servers: allPublicServerStatuses(),
    ts: Date.now()
  });
});

app.get('/mc/status', requireModSecret, (req, res) => {
  const serverId = sanitizeText(req.query?.serverId || 'main', 40) || 'main';
  res.json({ ok: true, status: publicServerStatus(serverId) });
});

// Minecraft -> Backend -> Web panel
app.post('/mc/chat', requireModSecret, (req, res) => {
  const serverId = sanitizeText(req.body?.serverId || 'main', 40) || 'main';
  const player = sanitizeText(req.body?.player || 'Unknown', 32) || 'Unknown';
  const message = sanitizeText(req.body?.message, 300);

  if (!message) {
    return res.status(400).json({ ok: false, error: 'EMPTY_MESSAGE' });
  }

  // Same player cannot post more than ~8 messages/sec through the bridge.
  const key = `${serverId}:${player}`;
  const now = Date.now();
  const previous = lastPostByPlayer.get(key) || 0;
  if (now - previous < 125) {
    return res.status(429).json({ ok: false, error: 'RATE_LIMIT' });
  }
  lastPostByPlayer.set(key, now);

  const payload = {
    id: crypto.randomUUID(),
    serverId,
    source: 'minecraft',
    player,
    message,
    ts: now
  };

  pushHistory(payload);
  io.emit('chat', payload);
  res.json({ ok: true, id: payload.id });
});

// Minecraft heartbeat -> Backend -> Web panel player list
app.post('/mc/players', requireModSecret, (req, res) => {
  const serverId = sanitizeText(req.body?.serverId || 'main', 40) || 'main';
  const maxPlayers = Math.max(0, Math.min(Number(req.body?.maxPlayers || 0), 10000));
  const online = req.body?.online !== false;
  const rawPlayers = Array.isArray(req.body?.players) ? req.body.players : [];

  const players = rawPlayers
    .map((name) => sanitizeText(name, 32))
    .filter(Boolean)
    .slice(0, 500)
    .sort((a, b) => a.localeCompare(b));

  serverStatusById.set(serverId, {
    serverId,
    online,
    maxPlayers,
    players,
    lastSeen: Date.now()
  });

  broadcastStatus();

  res.json({
    ok: true,
    status: publicServerStatus(serverId)
  });
});

// Web panel -> Backend -> Minecraft
// The Forge mod can poll this endpoint every 500 ms or 1 second.
app.get('/mc/outbox', requireModSecret, (req, res) => {
  const serverId = sanitizeText(req.query?.serverId || 'main', 40) || 'main';
  const queue = getOutbox(serverId);
  const messages = queue.splice(0, queue.length);
  res.json({ ok: true, messages });
});

setInterval(() => {
  broadcastStatus();
}, 5000).unref();

server.listen(PORT, () => {
  console.log(`Minecraft chat bridge v2 running on port ${PORT}`);
});
