'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const BOTS = process.env.BOTS !== undefined ? Number(process.env.BOTS) : 12;
const TICK_RATE = 20;

const game = new Game({ bots: BOTS });

// ---------- static files (client/) ----------

const CLIENT_DIR = path.join(__dirname, '..', 'client');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(CLIENT_DIR, pathname));
  if (!file.startsWith(CLIENT_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------- websocket ----------

const wss = new WebSocketServer({ server, maxPayload: 20000 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.snake = null;
  let windowStart = Date.now();
  let msgCount = 0;

  const send = (str) => {
    // Drop frames for slow clients instead of buffering forever.
    if (ws.readyState === 1 && ws.bufferedAmount < 1_000_000) ws.send(str);
  };

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    // Simple flood protection: max 90 messages per second.
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; msgCount = 0; }
    if (++msgCount > 90) return ws.terminate();

    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'join') {
      if (ws.snake && ws.snake.alive) return;
      const snake = game.join(m.name, send, { hue: m.hue, av: m.av });
      if (!snake) return send(JSON.stringify({ t: 'full' }));
      ws.snake = snake;
      send(JSON.stringify({ t: 'welcome', id: snake.id, world: game.cfg.world }));
    } else if (m.t === 'in' && ws.snake) {
      game.input(ws.snake, Number(m.a), m.b === 1 || m.b === true);
    }
  });

  ws.on('close', () => {
    game.leave(ws.snake);
    ws.snake = null;
  });

  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  try {
    game.tick((now - last) / 1000);
  } catch (err) {
    console.error('tick error:', err);
  }
  last = now;
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`pest.mom running on http://localhost:${PORT} (bots: ${BOTS})`);
});
