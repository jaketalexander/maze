import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Room } from './room.js';
import { MSG, generateRoomCode } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR  = path.resolve(__dirname, '..', 'dist');
const PORT      = Number(process.env.PORT || 3000);

// ─── In-memory room registry ────────────────────────────────────────────────
const rooms = new Map();

function createRoom() {
  let code;
  do { code = generateRoomCode(); } while (rooms.has(code));
  const room = new Room(code, (c) => rooms.delete(c));
  rooms.set(code, room);
  return room;
}

// ─── HTTP (API + static) ────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '4kb' }));

app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

app.post('/api/create-room', (_req, res) => {
  const room = createRoom();
  res.json({ code: room.code });
});

app.get('/api/room/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const room = rooms.get(code);
  if (!room) return res.status(404).json({ error: 'not_found' });
  res.json({
    code: room.code,
    lifecycle: room.lifecycle,
    playerCount:
      (room.slots.p1 ? 1 : 0) + (room.slots.p2 ? 1 : 0),
    full:
      !!(room.slots.p1 && room.slots.p2),
  });
});

// Static build (prod only — in dev Vite serves the client on :5173)
app.use(express.static(DIST_DIR, { maxAge: '1h', index: false }));
// SPA fallback for unknown paths (e.g. /?room=ABCD) — send index.html.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(DIST_DIR, 'index.html'), (err) => {
    if (err) next();
  });
});

// ─── HTTP + WS on the same port ────────────────────────────────────────────
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/ws') { socket.destroy(); return; }

  const code = String(url.searchParams.get('room') || '').toUpperCase();
  const name = String(url.searchParams.get('name') || '').slice(0, 20);
  const room = rooms.get(code);

  if (!room) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: MSG.ERROR, code: 'no_room', msg: 'Room not found' }));
      ws.close();
    });
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const slot = room.addConnection(ws, name);
    if (!slot) { ws.close(); return; }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      room.onMessage(ws, msg);
    });
    ws.on('close', () => room.removeConnection(ws));
    ws.on('error', () => room.removeConnection(ws));
  });
});

httpServer.listen(PORT, () => {
  console.log(`[maze] http+ws listening on :${PORT}`);
});
