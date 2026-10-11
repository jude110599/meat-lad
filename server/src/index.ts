import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import { DEFAULT_PORT, PROTOCOL_VERSION } from '@starforge/shared';
import { Room, type GameServer } from './game/Room.js';
import { MemoryStore } from './persistence/Store.js';

/**
 * Optional dedicated host. The live site hosts rooms in a player's browser
 * over PeerJS; point the client here with VITE_SERVER_URL to use this instead.
 */
const PORT = Number(process.env.PORT ?? DEFAULT_PORT);
const ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',');
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const store = new MemoryStore();
const rooms = new Map<string, Room>();

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, protocol: PROTOCOL_VERSION }));
    return;
  }
  res.writeHead(404).end();
});

const io: GameServer = new Server(http, { cors: { origin: ORIGINS } });

function newCode(): string {
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

io.on('connection', (socket) => {
  socket.once('hello', async (h) => {
    if (!h || typeof h !== 'object') return;
    const want = typeof h.room === 'string' ? h.room.toUpperCase() : '';
    let room = want ? rooms.get(want) : undefined;
    if (want && !room) {
      const saved = await store.loadRoom(want);
      if (!saved) return void socket.emit('msg', { t: 'error', error: 'room-not-found' });
      room = new Room(want, io, store, saved);
      rooms.set(want, room);
      room.start();
    }
    if (!room) {
      room = new Room(newCode(), io, store);
      rooms.set(room.code, room);
      room.start();
    }
    if (!room.join(socket, h)) return;
    const r = room;
    socket.on('disconnect', () => {
      // Keep empty rooms alive briefly so a reconnecting client can resume.
      setTimeout(() => {
        if (r.size === 0 && rooms.get(r.code) === r) {
          r.stop();
          rooms.delete(r.code);
        }
      }, 60_000);
    });
  });
});

http.listen(PORT, () => console.log(`[starforge] server listening on :${PORT}`));
