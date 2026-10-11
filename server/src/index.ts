import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import { DEFAULT_PORT, MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION } from '@starforge/shared';
import { Room, type GameServer } from './game/Room.js';
import { MemoryStore } from './persistence/Store.js';

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
    code = Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

io.on('connection', (socket) => {
  socket.on('ping', (_t, ack) => typeof ack === 'function' && ack(Date.now()));

  socket.once('hello', (p, ack) => {
    if (typeof ack !== 'function') return;
    if (!p || p.protocol !== PROTOCOL_VERSION) return ack({ error: 'protocol-mismatch' });
    const role = p.role === 'refiner' ? 'refiner' : 'miner';

    let room = p.room ? rooms.get(p.room.toUpperCase()) : undefined;
    if (p.room && !room) return ack({ error: 'room-not-found' });
    if (!room) {
      room = new Room(newCode(), io, store);
      rooms.set(room.code, room);
      room.start();
    }
    if (room.size >= MAX_PLAYERS_PER_ROOM) return ack({ error: 'room-full' });

    const joined = room.join(socket, String(p.name ?? ''), role, p.resumeToken);
    ack({ room: room.code, ...joined });

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
