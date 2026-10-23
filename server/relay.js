// Battle Fleet: Pre-Dreadnought — multiplayer relay server.
//
// It knows nothing about the game's rules. One player HOSTS and gets a short room code; a second player JOINS with
// that code; from then on every game message one of them sends is passed straight to the other. The two copies of
// the game keep the battle in step between themselves (see the MULTIPLAYER section of game.js).
//
// Protocol (JSON text frames):
//   client -> server  {t:'host'}               create a room; reply {t:'hosted', code}
//                     {t:'join', code}          join one;      reply {t:'joined', code}, and the host gets {t:'peer-joined'}
//                     {t:'msg', d:<anything>}   passed on to the other player as {t:'msg', d}
//   server -> client  {t:'peer-left'}           the other player disconnected (the room closes if it was the host)
//                     {t:'error', msg}          something went wrong (bad code, room full, ...)
//
// Settings (environment variables): PORT (default 8080), ALLOWED_ORIGINS (comma-separated page origins allowed to
// connect, e.g. "https://dwyer.github.io,null"; empty = allow any; "null" is a game opened straight from disk).

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const MAX_ROOMS = 500;
const MAX_MESSAGE_BYTES = 1024 * 1024;   // a whole fleet plus the map is well under this
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000;  // rooms with no traffic for 3 hours are closed
const PING_MS = 25 * 1000;                // keeps home routers and proxies from dropping a quiet connection
const RATE_PER_SEC = 40;                  // messages per second per connection before it is cut off
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const CODE_LEN = 4;

const rooms = new Map(); // code -> {host, guest, lastActive}

function log(...args){ console.log(new Date().toISOString(), ...args); }

function send(ws, obj){
  if(ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function newCode(){
  for(let tries = 0; tries < 1000; tries++){
    let c = '';
    for(let i = 0; i < CODE_LEN; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if(!rooms.has(c)) return c;
  }
  return null;
}

function closeRoom(code, reason){
  const room = rooms.get(code);
  if(!room) return;
  rooms.delete(code);
  [room.host, room.guest].forEach(ws => { if(ws) ws.roomCode = null; });
  log(`room ${code} closed (${reason}); ${rooms.size} open`);
}

function leave(ws){
  const code = ws.roomCode;
  const room = code && rooms.get(code);
  if(!room) return;
  ws.roomCode = null;
  if(room.host === ws){
    send(room.guest, {t:'peer-left'});
    if(room.guest) room.guest.roomCode = null;
    closeRoom(code, 'host left');
  } else if(room.guest === ws){
    room.guest = null;
    send(room.host, {t:'peer-left'});
    log(`room ${code}: guest left`);
  }
}

const server = http.createServer((req, res) => {
  if(req.url === '/health'){
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({ok: true, rooms: rooms.size}));
    return;
  }
  res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
  res.end('Battle Fleet multiplayer relay is running. Point the game\'s Multiplayer screen at this address.\n');
});

const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: ({origin}) => !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin || 'null')
});

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.roomCode = null;
  ws.rate = {windowStart: Date.now(), count: 0};
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw, isBinary) => {
    const now = Date.now();
    if(now - ws.rate.windowStart > 1000){ ws.rate.windowStart = now; ws.rate.count = 0; }
    if(++ws.rate.count > RATE_PER_SEC){ ws.close(1008, 'too many messages'); return; }
    if(isBinary) return;
    let m;
    try { m = JSON.parse(raw.toString()); } catch(e){ send(ws, {t:'error', msg:'Bad message.'}); return; }
    if(!m || typeof m !== 'object') return;

    if(m.t === 'host'){
      leave(ws);
      if(rooms.size >= MAX_ROOMS){ send(ws, {t:'error', msg:'The server is full right now. Try again later.'}); return; }
      const code = newCode();
      if(!code){ send(ws, {t:'error', msg:'Could not create a room. Try again.'}); return; }
      rooms.set(code, {host: ws, guest: null, lastActive: now});
      ws.roomCode = code;
      send(ws, {t:'hosted', code});
      log(`room ${code} opened; ${rooms.size} open`);
    } else if(m.t === 'join'){
      const code = String(m.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if(!room){ send(ws, {t:'error', msg:`No game found with the code ${code || '(blank)'}. Check it with the host.`}); return; }
      if(room.host === ws){ send(ws, {t:'error', msg:'That is your own game.'}); return; }
      if(room.guest){ send(ws, {t:'error', msg:'That game already has two players.'}); return; }
      leave(ws);
      room.guest = ws;
      room.lastActive = now;
      ws.roomCode = code;
      send(ws, {t:'joined', code});
      send(room.host, {t:'peer-joined'});
      log(`room ${code}: guest joined`);
    } else if(m.t === 'msg'){
      const room = ws.roomCode && rooms.get(ws.roomCode);
      if(!room) return;
      room.lastActive = now;
      send(room.host === ws ? room.guest : room.host, {t:'msg', d: m.d});
    } else if(m.t === 'leave'){
      leave(ws);
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// Drop connections that stopped answering pings, and rooms nobody has used for hours.
const sweeper = setInterval(() => {
  wss.clients.forEach(ws => {
    if(!ws.isAlive){ ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
  const now = Date.now();
  rooms.forEach((room, code) => {
    if(now - room.lastActive > ROOM_IDLE_MS){
      [room.host, room.guest].forEach(ws => { if(ws) ws.close(1000, 'room idle'); });
      closeRoom(code, 'idle');
    }
  });
}, PING_MS);

wss.on('close', () => clearInterval(sweeper));

server.listen(PORT, () => {
  log(`Battle Fleet relay listening on port ${PORT}` + (ALLOWED_ORIGINS.length ? ` (origins: ${ALLOWED_ORIGINS.join(', ')})` : ' (any origin)'));
});

function shutdown(){
  log('shutting down');
  wss.clients.forEach(ws => ws.close(1001, 'server restarting'));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
