'use strict';

/**
 * Share cards. When a player presses "Share on X" the browser uploads the result picture here.
 * The server keeps it in memory for a day and serves a tiny page (/s/<id>) whose meta tags make X
 * show the picture as a big card under the post. Only small JPEG files are accepted.
 */

const crypto = require('crypto');

const MAX_BYTES = 400 * 1024;      // biggest accepted picture
const MAX_CARDS = 200;             // oldest cards are dropped beyond this
const TTL_MS = 24 * 3600 * 1000;   // cards disappear after a day
const RATE_PER_MIN = 10;           // uploads per minute per IP

const cards = new Map();           // id -> { buf, at }
const hits = new Map();            // ip -> [timestamps]

const clientIp = (req) => {
  // The last X-Forwarded-For entry is the one added by our own proxy; earlier ones can be faked.
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',').pop().trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
};

function allow(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= RATE_PER_MIN) { hits.set(ip, list); return false; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

function prune() {
  const now = Date.now();
  for (const [id, c] of cards) if (now - c.at > TTL_MS) cards.delete(id);
  while (cards.size >= MAX_CARDS) cards.delete(cards.keys().next().value);
}

function send(res, code, type, body, extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

function upload(req, res) {
  const type = String(req.headers['content-type'] || '');
  const len = Number(req.headers['content-length'] || 0);
  if (!type.startsWith('image/jpeg')) return send(res, 400, 'text/plain', 'JPEG only');
  if (len > MAX_BYTES) return send(res, 413, 'text/plain', 'Too large', { Connection: 'close' });
  if (!allow(clientIp(req))) return send(res, 429, 'text/plain', 'Slow down');

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c) => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_BYTES) {
      aborted = true;
      send(res, 413, 'text/plain', 'Too large', { Connection: 'close' });
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    const buf = Buffer.concat(chunks);
    if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      return send(res, 400, 'text/plain', 'Not a JPEG');
    }
    prune();
    const id = crypto.randomBytes(6).toString('hex');
    cards.set(id, { buf, at: Date.now() });
    send(res, 200, 'application/json', JSON.stringify({ id }));
  });
  req.on('error', () => {});
}

function page(req, res, id) {
  if (!cards.has(id)) return send(res, 404, 'text/plain', 'This card has expired');
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() === 'https' ? 'https' : 'http';
  const hostRaw = String(req.headers.host || 'localhost');
  const host = /^[a-z0-9.\-:]+$/i.test(hostRaw) ? hostRaw : 'localhost';
  const base = `${proto}://${host}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Think you can beat me on pest.mom?</title>
<meta name="description" content="Become the biggest pest on Solana. Free multiplayer fly game.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="pest.mom">
<meta property="og:title" content="Think you can beat me on pest.mom?">
<meta property="og:description" content="Become the biggest pest on Solana. Free multiplayer fly game.">
<meta property="og:image" content="${base}/c/${id}.jpg">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${base}/s/${id}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Think you can beat me on pest.mom?">
<meta name="twitter:description" content="Become the biggest pest on Solana. Free multiplayer fly game.">
<meta name="twitter:image" content="${base}/c/${id}.jpg">
<meta name="twitter:image:alt" content="A pest.mom result card">
<style>body{margin:0;background:#08070d;color:#f1eefc;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}a{color:#b9a8ff}</style>
</head><body><p>Taking you to <a href="/">pest.mom</a>...</p>
<script>location.replace('/');</script></body></html>`;
  send(res, 200, 'text/html; charset=utf-8', req.method === 'HEAD' ? '' : html, { 'Cache-Control': 'public, max-age=300' });
}

function image(req, res, id) {
  const c = cards.get(id);
  if (!c) return send(res, 404, 'text/plain', 'This card has expired');
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Content-Length': c.buf.length,
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : c.buf);
}

/** Returns true when the request was one of ours. */
function handle(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/card') { upload(req, res); return true; }
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let m = pathname.match(/^\/c\/([a-f0-9]{12})\.jpg$/);
  if (m) { image(req, res, m[1]); return true; }
  m = pathname.match(/^\/s\/([a-f0-9]{12})$/);
  if (m) { page(req, res, m[1]); return true; }
  return false;
}

module.exports = { handle, MAX_BYTES, RATE_PER_MIN };
