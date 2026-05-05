const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const MOD_SECRET = process.env.MOD_SECRET || 'change_me_mod_secret';
const PANEL_TOKEN = process.env.PANEL_TOKEN || '1234';
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 100);
const MAX_OUTBOX = Number(process.env.MAX_OUTBOX || 50);

app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const history = [];
const outboxByServer = new Map();
const lastPostByPlayer = new Map();

function sanitizeText(value, maxLen) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

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

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!PANEL_TOKEN || token !== PANEL_TOKEN) {
    return next(new Error('UNAUTHORIZED'));
  }
  next();
});

io.on('connection', (socket) => {
  socket.emit('history', history);

  socket.on('web-chat', (data) => {
    const serverId = sanitizeText(data?.serverId || 'main', 40) || 'main';
    const player = sanitizeText(data?.player || 'Panel Web', 32) || 'Panel Web';
    const message = sanitizeText(data?.message, 300);

    if (!message) return;

    const payload = {
      id: crypto.randomUUID(),
      serverId,
      source: 'web',
      player,
      message,
      ts: Date.now()
    };

    const queue = getOutbox(serverId);
    queue.push(payload);
    while (queue.length > MAX_OUTBOX) queue.shift();

    pushHistory(payload);
    io.emit('chat', payload);
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'minecraft-chat-bridge', ts: Date.now() });
});

// Minecraft -> Backend -> Web panel
app.post('/mc/chat', requireModSecret, (req, res) => {
  const serverId = sanitizeText(req.body?.serverId || 'main', 40) || 'main';
  const player = sanitizeText(req.body?.player || 'Unknown', 32) || 'Unknown';
  const message = sanitizeText(req.body?.message, 300);

  if (!message) {
    return res.status(400).json({ ok: false, error: 'EMPTY_MESSAGE' });
  }

  // Small anti-spam guard: same player cannot post more than ~8 msgs/sec to bridge.
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

// Web panel -> Backend -> Minecraft
// The Forge mod can poll this endpoint every 1 second.
app.get('/mc/outbox', requireModSecret, (req, res) => {
  const serverId = sanitizeText(req.query?.serverId || 'main', 40) || 'main';
  const queue = getOutbox(serverId);
  const messages = queue.splice(0, queue.length);
  res.json({ ok: true, messages });
});

server.listen(PORT, () => {
  console.log(`Minecraft chat bridge running on port ${PORT}`);
});
