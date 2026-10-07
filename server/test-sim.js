'use strict';

// Headless smoke test: runs the simulation for a few simulated minutes with
// bots plus one scripted "human" and checks that nothing goes wrong.
// Run with: npm test

const assert = require('assert');
const { Game } = require('./game');

const AV = 'data:image/jpeg;base64,' + 'A'.repeat(200);
const { cleanAvatar } = require('./game');
assert.strictEqual(cleanAvatar('javascript:alert(1)'), null, 'bad avatar rejected');
assert.strictEqual(cleanAvatar('data:image/svg+xml;base64,AAAA'), null, 'only jpeg avatars');
assert.strictEqual(cleanAvatar('data:image/jpeg;base64,' + 'A'.repeat(20000)), null, 'huge avatar rejected');
assert.strictEqual(cleanAvatar(AV), AV, 'valid avatar accepted');

const game = new Game({ bots: 12 });
let bytes = 0;
let snapshots = 0;
let deaths = 0;
let lastSnap = null;
let sawMm = false;

let me = game.join('<b>Tester</b>!!', (str) => {
  bytes += str.length;
  const m = JSON.parse(str);
  if (m.t === 's') {
    snapshots++; lastSnap = m;
    if (m.mm) sawMm = true;
    if (m.fd) for (let i = 2; i < m.fd.length; i += 3) assert.ok(m.fd[i] >= 1 && m.fd[i] <= 40, 'orb value in range');
  }
  if (m.t === 'dead') deaths++;
}, { hue: 190, av: AV });
assert.strictEqual(me.name, 'bTesterb', 'names are sanitised');
assert.strictEqual(me.hue, 190, 'colour is kept');
assert.strictEqual(me.av, AV, 'avatar is kept');

const DT = 1 / 20;
const TICKS = 20 * 180; // 3 minutes

for (let i = 0; i < TICKS; i++) {
  if (!me.alive) me = game.join('@Tester', me.send, { hue: 190 });
  game.input(me, Math.sin(i / 40) * Math.PI, i % 100 < 15);
  game.tick(DT);

  for (const s of game.snakes.values()) {
    for (const seg of s.segs) {
      assert.ok(Number.isFinite(seg.x) && Number.isFinite(seg.y), 'positions stay finite');
    }
    assert.ok(s.mass > 0, 'mass stays positive');
  }
  assert.ok(game.food.size <= game.cfg.foodMax, 'food cap respected');
}

assert.ok(snapshots > 0, 'snapshots were sent');
assert.ok(sawMm, 'minimap data was sent');

// Walls: a fly flying into a wall bounces back and survives.
{
  const g = new Game({ bots: 0 });
  const f = g.join('Wall', () => {}, { hue: 10 });
  f.segs[0].x = 30; f.segs[0].y = 1000; f.angle = Math.PI; f.target = Math.PI;
  for (let i = 0; i < 80; i++) { g.input(f, Math.PI, false); g.tick(0.05); }
  assert.ok(f.alive, 'fly survives hitting the wall');
  assert.ok(f.segs[0].x >= 0 && f.segs[0].x <= g.cfg.world, 'fly stays inside the map');
}

// Friends find each other: a second real player spawns near the first.
{
  const g = new Game({ bots: 0 });
  const a = g.join('A', () => {}, {});
  const b = g.join('B', () => {}, {});
  const d = Math.hypot(a.segs[0].x - b.segs[0].x, a.segs[0].y - b.segs[0].y);
  assert.ok(d < 1400, 'second player spawns near the first (distance ' + Math.round(d) + ')');
}
assert.ok(lastSnap && lastSnap.sn.length >= 1, 'snapshot contains snakes');
assert.strictEqual(game.humanCount(), me.alive ? 1 : 0);

const kb = bytes / 1024 / (TICKS * DT);
console.log(`ok - ${TICKS} ticks, ${snapshots} snapshots, ${deaths} deaths`);
console.log(`snakes alive: ${game.snakes.size}, food: ${game.food.size}`);
console.log(`avg bandwidth for one player: ${kb.toFixed(1)} KB/s`);
