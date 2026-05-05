# Minecraft Chat Bridge V2

Panel web móvil en tiempo real para Minecraft Forge + backend Node.js/Socket.IO.

## Qué cambia en V2

- Ya no existe campo manual para elegir nombre.
- Cada usuario entra con su propio token.
- El backend asigna el nombre y rol según `PANEL_USERS`.
- Los mensajes de la web se marcan como `[WEB] Nombre`.
- Soporta roles:
  - `admin`: puede leer y escribir.
  - `writer`: puede leer y escribir.
  - `viewer`: solo lectura.
- Agrega estado del servidor y jugadores conectados.
- El mod debe reportar jugadores online con `POST /mc/players` cada 5 segundos.

## Variables de entorno en Render

Recomendado:

```env
MOD_SECRET=una_clave_larga_para_el_mod
PANEL_USERS={"tokenFelipe123":{"name":"Felipe","role":"admin"},"tokenPablo456":{"name":"Pablo","role":"viewer"}}
MAX_HISTORY=150
MAX_OUTBOX=50
SERVER_STALE_MS=20000
NODE_ENV=production
```

Importante: `PANEL_USERS` debe ir en una sola línea y ser JSON válido.

## Endpoints para el mod Forge

### 1. Enviar chat Minecraft -> Web

`POST /mc/chat`

Headers:

```txt
x-mod-secret: MOD_SECRET
Content-Type: application/json
```

Body:

```json
{
  "serverId": "main",
  "player": "Steve",
  "message": "hola"
}
```

### 2. Reportar jugadores conectados

`POST /mc/players`

Headers:

```txt
x-mod-secret: MOD_SECRET
Content-Type: application/json
```

Body:

```json
{
  "serverId": "main",
  "online": true,
  "maxPlayers": 20,
  "players": ["Felipe", "Pablo", "Matias"]
}
```

Recomendado: enviar esto cada 5 segundos desde el mod.

### 3. Leer mensajes web -> Minecraft

`GET /mc/outbox?serverId=main`

Headers:

```txt
x-mod-secret: MOD_SECRET
```

Respuesta:

```json
{
  "ok": true,
  "messages": [
    {
      "source": "web",
      "player": "Felipe",
      "message": "hola desde el celular"
    }
  ]
}
```

Recomendado: consultar cada 500 ms o 1 segundo desde el mod.

## Deploy en Render

Build Command:

```txt
npm install
```

Start Command:

```txt
npm start
```

## Seguridad mínima

- No compartas `MOD_SECRET`.
- No uses tokens fáciles para usuarios reales.
- Para usuarios que solo deben mirar, usa rol `viewer`.
- Para quienes pueden escribir al Minecraft, usa `writer` o `admin`.
