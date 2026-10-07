'use strict';

// Tests the share-card endpoints with a small throwaway HTTP server. Run with: npm test

const assert = require('assert');
const http = require('http');
const cards = require('./cards');

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (!cards.handle(req, res, pathname)) { res.writeHead(404); res.end(); }
});

const fakeJpeg = (n) => {
  const b = Buffer.alloc(n, 7);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff;
  return b;
};

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const jpg = fakeJpeg(5000);
    let r = await fetch(base + '/card', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpg });
    assert.strictEqual(r.status, 200, 'valid JPEG accepted');
    const { id } = await r.json();
    assert.ok(/^[a-f0-9]{12}$/.test(id), 'card id looks right');

    r = await fetch(`${base}/c/${id}.jpg`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('content-type'), 'image/jpeg');
    assert.strictEqual(Buffer.from(await r.arrayBuffer()).length, 5000, 'same bytes come back');

    r = await fetch(`${base}/s/${id}`, { headers: { 'x-forwarded-proto': 'https' } });
    const html = await r.text();
    assert.strictEqual(r.status, 200);
    assert.ok(html.includes('summary_large_image'), 'twitter card tag present');
    assert.ok(html.includes(`/c/${id}.jpg`), 'image url present');
    assert.ok(html.includes('content="https://'), 'image url is https behind the proxy');

    r = await fetch(base + '/card', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: jpg });
    assert.strictEqual(r.status, 400, 'non-JPEG content type rejected');

    const png = Buffer.alloc(5000, 1); png[0] = 0x89;
    r = await fetch(base + '/card', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: png });
    assert.strictEqual(r.status, 400, 'fake JPEG rejected');

    let big;
    try { big = (await fetch(base + '/card', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: fakeJpeg(500 * 1024) })).status; }
    catch { big = 413; }
    assert.strictEqual(big, 413, 'huge upload rejected');

    r = await fetch(`${base}/s/ffffffffffff`);
    assert.strictEqual(r.status, 404, 'unknown card is 404');
    r = await fetch(`${base}/s/..%2F..%2Fetc`);
    assert.strictEqual(r.status, 404, 'odd ids are not served');

    let limited = 0;
    for (let i = 0; i < 15; i++) {
      const x = await fetch(base + '/card', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpg });
      if (x.status === 429) limited++;
    }
    assert.ok(limited > 0, 'rate limit kicks in');

    console.log('ok - share cards: upload, serve, card page, rejects and rate limit');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
