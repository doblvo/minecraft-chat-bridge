# Minecraft Chat Bridge

Bridge simple para ver el chat de Minecraft Forge en una web móvil en tiempo real.

## Flujo

Minecraft Forge mod -> HTTP POST -> Backend Node.js -> Socket.IO -> Web móvil

La web también puede mandar mensajes hacia Minecraft usando `/mc/outbox`, que el mod puede consultar cada 1 segundo.

## Variables de entorno en Render

- `MOD_SECRET`: clave secreta que usa el mod al llamar al backend.
- `PANEL_TOKEN`: clave que escribes en el celular para entrar al panel.
- `MAX_HISTORY`: cantidad de mensajes visibles al reconectar.
- `MAX_OUTBOX`: máximo de mensajes pendientes desde web hacia Minecraft.

## Endpoints

### Health check

`GET /health`

### Minecraft a web

`POST /mc/chat`

Headers:

`x-mod-secret: TU_MOD_SECRET`

Body:

```json
{
  "serverId": "main",
  "player": "Steve",
  "message": "hola"
}
```

### Web a Minecraft

`GET /mc/outbox?serverId=main`

Headers:

`x-mod-secret: TU_MOD_SECRET`

Respuesta:

```json
{
  "ok": true,
  "messages": []
}
```

## Deploy en Render

1. Sube estos archivos a un repositorio de GitHub.
2. En Render crea un Web Service conectado al repo.
3. Build Command: `npm install`.
4. Start Command: `npm start`.
5. Agrega `MOD_SECRET` y `PANEL_TOKEN` en Environment.
6. Abre la URL pública de Render desde tu celular.
