'use strict';

/**
 * Authoritative game simulation. No networking in here: the server (index.js)
 * feeds it inputs and gives each player a `send(string)` callback.
 */

const HUES = [265, 140, 350, 28, 190, 50, 310, 215];
const BOT_NAMES = [
  'Noodle', 'Zigzag', 'Pixel', 'Moss', 'Comet', 'Biscuit', 'Orbit', 'Nova',
  'Pickle', 'Ember', 'Glitch', 'Mango', 'Echo', 'Tango', 'Fizz', 'Jelly',
  'Buzzy', 'Gnat', 'Wasp', 'Bluebottle', 'Maggot', 'Flap', 'Zed', 'Pip',
  'Fuzz', 'Drizzle', 'Mothra', 'Skeeter', 'Twitch', 'Nibble', 'Kiwi', 'Rocket',
];

const DEFAULTS = {
  world: 2600,        // square map, px
  spacing: 6,         // distance between body segments, px
  baseSpeed: 170,     // px/s
  boostSpeed: 320,    // px/s
  boostCost: 5,       // mass lost per second while boosting
  minBoostMass: 12,   // can't boost below this
  turnRate: 4.2,      // rad/s
  startMass: 10,
  foodTarget: 650,    // coin orbs kept on the map
  foodMax: 1100,      // hard cap incl. drops from dead snakes
  foodGain: 0.5,      // mass per orb value
  view: 1000,         // half-size of the box of snakes sent to each player, px
  foodView: 800,      // half-size of the box of orbs sent to each player, px
  bots: 12,           // flies kept in the arena in total (bots fill the gaps)
  minBots: 4,         // bots never drop below this while BOTS > 0
  maxPlayers: 40,
};

const radiusOf = (m) => Math.min(24, 8 + Math.sqrt(m) * 0.6);
const segCountOf = (m) => Math.floor(12 + 5 * Math.sqrt(m));

function normAngle(a) {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

// Avatars are tiny JPEGs made in the browser (data URLs). Only that exact shape is accepted.
const AVATAR_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
function cleanAvatar(raw) {
  if (typeof raw !== 'string' || raw.length > 14000 || !AVATAR_RE.test(raw)) return null;
  return raw;
}

function cleanName(raw) {
  const s = String(raw || '')
    .replace(/[^\p{L}\p{N} _.@\-]/gu, '')
    .trim()
    .slice(0, 16);
  return s || 'Player';
}

class Game {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.snakes = new Map();
    this.food = new Map();
    this.nextId = 1;
    this.nextFoodId = 1;
    this.time = 0;
    this.botTimer = 1;
    this.lb = [];
    this.rankOf = new Map();
    this.total = 0;
    this.online = 0;

    for (let i = 0; i < this.cfg.foodTarget; i++) this.spawnFood();
    for (let i = 0; i < this.cfg.bots; i++) this.spawnBot();
  }

  // ---------- spawning ----------

  addFood(x, y, v) {
    if (this.food.size >= this.cfg.foodMax) return;
    this.food.set(this.nextFoodId++, { x, y, v });
  }

  spawnFood() {
    const w = this.cfg.world;
    this.addFood(
      30 + Math.random() * (w - 60),
      30 + Math.random() * (w - 60),
      2 + Math.floor(Math.random() * 4)   // value 2..5
    );
  }

  /**
   * Bots spawn anywhere. Real players spawn 700-1200 px from another real player
   * while only a few people are online, so friends actually meet.
   */
  findSpawn(human) {
    const { world } = this.cfg;
    const margin = 400;
    const humans = human ? [...this.snakes.values()].filter((s) => !s.bot) : [];
    let best = null;
    for (let attempt = 0; attempt < 14; attempt++) {
      let x;
      let y;
      if (humans.length > 0 && humans.length <= 6 && attempt < 10) {
        const h = humans[Math.floor(Math.random() * humans.length)].segs[0];
        const a = Math.random() * Math.PI * 2;
        const d = 700 + Math.random() * 500;
        x = Math.max(margin, Math.min(world - margin, h.x + Math.cos(a) * d));
        y = Math.max(margin, Math.min(world - margin, h.y + Math.sin(a) * d));
      } else {
        x = margin + Math.random() * (world - 2 * margin);
        y = margin + Math.random() * (world - 2 * margin);
      }
      let clear = true;
      for (const s of this.snakes.values()) {
        for (let i = 0; i < s.segs.length; i += 5) {
          const dx = s.segs[i].x - x;
          const dy = s.segs[i].y - y;
          if (dx * dx + dy * dy < 350 * 350) { clear = false; break; }
        }
        if (!clear) break;
      }
      best = { x, y };
      if (clear) break;
    }
    return best;
  }

  createSnake(name, bot, send, opts = {}) {
    const { spacing, startMass } = this.cfg;
    const { x, y } = this.findSpawn(!bot);
    const angle = Math.random() * Math.PI * 2;
    const s = {
      id: this.nextId++,
      name,
      bot,
      send,
      hue: Number.isInteger(opts.hue) && opts.hue >= 0 && opts.hue < 360
        ? opts.hue
        : HUES[Math.floor(Math.random() * HUES.length)],
      angle,
      target: angle,
      boost: false,
      boosting: false,
      boostAcc: 0,
      ignoreInputUntil: 0,
      mass: startMass,
      kills: 0,
      alive: true,
      av: bot ? null : cleanAvatar(opts.av),
      born: this.time,
      seenAv: bot ? null : new Set(),
      segs: [],
      ai: bot ? { t: 0, wander: 0 } : null,
    };
    const n = segCountOf(startMass);
    for (let i = 0; i < n; i++) {
      s.segs.push({
        x: x - Math.cos(angle) * i * spacing,
        y: y - Math.sin(angle) * i * spacing,
      });
    }
    if (s.seenAv) s.seenAv.add(s.id);
    this.snakes.set(s.id, s);
    return s;
  }

  spawnBot() {
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    return this.createSnake(name, true, null);
  }

  humanCount() {
    let n = 0;
    for (const s of this.snakes.values()) if (!s.bot) n++;
    return n;
  }

  /** Returns the new snake, or null if the server is full. */
  join(name, send, opts = {}) {
    if (this.humanCount() >= this.cfg.maxPlayers) return null;
    return this.createSnake(cleanName(name), false, send, opts);
  }

  input(snake, angle, boost) {
    if (!snake || !snake.alive) return;
    if (Number.isFinite(angle) && this.time >= snake.ignoreInputUntil) snake.target = angle;
    snake.boost = !!boost;
  }

  leave(snake) {
    if (!snake) return;
    snake.send = null;
    this.kill(snake, null, 'left');
  }

  // ---------- simulation ----------

  tick(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;

    const list = [...this.snakes.values()];
    for (const s of list) {
      if (s.bot) this.think(s, dt);
      this.step(s, dt);
      this.eat(s);
    }
    this.collide(list);

    this.botTimer -= dt;
    if (this.botTimer <= 0) {
      this.botTimer = 1;
      this.balanceBots();
    }

    for (let i = 0; i < 50 && this.food.size < this.cfg.foodTarget; i++) this.spawnFood();

    const ranked = [...this.snakes.values()].sort((a, b) => b.mass - a.mass);
    this.rankOf = new Map(ranked.map((s, i) => [s.id, i + 1]));
    this.total = ranked.length;
    this.online = this.humanCount();
    this.lb = ranked.slice(0, 8).map((s) => [s.name, Math.round(s.mass), s.id, s.bot ? 1 : 0]);

    for (const s of this.snakes.values()) {
      if (!s.bot && s.send) this.sendSnapshot(s);
    }
  }

  step(s, dt) {
    const c = this.cfg;
    const head = s.segs[0];

    const diff = normAngle(s.target - s.angle);
    const maxTurn = c.turnRate * dt;
    s.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));

    let speed = c.baseSpeed;
    s.boosting = false;
    if (s.boost && s.mass > c.minBoostMass) {
      speed = c.boostSpeed;
      s.boosting = true;
      const cost = c.boostCost * dt;
      s.mass -= cost;
      s.boostAcc += cost;
      if (s.boostAcc >= 1) {
        s.boostAcc -= 1;
        const tail = s.segs[s.segs.length - 1];
        this.addFood(tail.x, tail.y, 1);
      }
    }

    head.x += Math.cos(s.angle) * speed * dt;
    head.y += Math.sin(s.angle) * speed * dt;

    // Bounce off the walls instead of dying. Steering is ignored for a moment so the push-off is clear.
    const edge = 12;
    let bounced = false;
    if (head.x < edge) { head.x = edge; s.angle = Math.PI - s.angle; bounced = true; }
    else if (head.x > c.world - edge) { head.x = c.world - edge; s.angle = Math.PI - s.angle; bounced = true; }
    if (head.y < edge) { head.y = edge; s.angle = -s.angle; bounced = true; }
    else if (head.y > c.world - edge) { head.y = c.world - edge; s.angle = -s.angle; bounced = true; }
    if (bounced) {
      s.angle = normAngle(s.angle);
      s.target = s.angle;
      s.ignoreInputUntil = this.time + 0.4;
    }

    const sp = c.spacing;
    for (let i = 1; i < s.segs.length; i++) {
      const p = s.segs[i - 1];
      const q = s.segs[i];
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      const d = Math.hypot(dx, dy);
      if (d > sp) {
        const k = (d - sp) / d;
        q.x += dx * k;
        q.y += dy * k;
      }
    }

    const want = segCountOf(s.mass);
    while (s.segs.length < want) {
      const t = s.segs[s.segs.length - 1];
      s.segs.push({ x: t.x, y: t.y });
    }
    while (s.segs.length > want) s.segs.pop();
  }

  eat(s) {
    const h = s.segs[0];
    const r = radiusOf(s.mass) + 22;
    const r2 = r * r;
    for (const [id, f] of this.food) {
      const dx = f.x - h.x;
      if (dx > r || dx < -r) continue;
      const dy = f.y - h.y;
      if (dy > r || dy < -r) continue;
      if (dx * dx + dy * dy < r2) {
        s.mass += f.v * this.cfg.foodGain;
        this.food.delete(id);
      }
    }
  }

  collide(list) {
    const { spacing } = this.cfg;
    const deaths = new Map();

    for (const a of list) {
      const h = a.segs[0];
      const ra = radiusOf(a.mass);
      for (const b of list) {
        if (b === a) continue;
        const bh = b.segs[0];
        const reach = b.segs.length * spacing + 80;
        if (Math.abs(bh.x - h.x) > reach || Math.abs(bh.y - h.y) > reach) continue;
        const lim = ra * 0.7 + radiusOf(b.mass) * 0.9;
        const lim2 = lim * lim;
        const segs = b.segs;
        for (let i = 0; i < segs.length; i++) {
          const dx = segs[i].x - h.x;
          const dy = segs[i].y - h.y;
          if (dx * dx + dy * dy < lim2) {
            deaths.set(a, { by: b, reason: 'snake' });
            break;
          }
        }
        if (deaths.has(a)) break;
      }
    }

    for (const [s, info] of deaths) this.kill(s, info.by, info.reason);
  }

  kill(s, by, reason) {
    if (!s.alive) return;
    s.alive = false;
    let rank = 1;
    for (const o of this.snakes.values()) if (o !== s && o.mass > s.mass) rank++;
    const of = this.snakes.size;
    this.snakes.delete(s.id);
    if (by && by !== s) by.kills++;

    // A dead snake turns into food.
    const n = s.segs.length;
    const per = Math.max(1, Math.round((s.mass * 1.2) / (n / 2)));
    for (let i = 0; i < n; i += 2) {
      const g = s.segs[i];
      this.addFood(g.x + (Math.random() - 0.5) * 10, g.y + (Math.random() - 0.5) * 10, per);
    }

    if (!s.bot && s.send) {
      s.send(JSON.stringify({
        t: 'dead',
        score: Math.round(s.mass),
        kills: s.kills,
        rank,
        of,
        time: Math.round(this.time - s.born),
        by: by ? by.name : null,
        reason,
      }));
    }
  }

  // ---------- bots ----------

  /** Keeps the arena lively: fewer bots when more real players are online. */
  balanceBots() {
    let bots = 0;
    let humans = 0;
    for (const s of this.snakes.values()) {
      if (s.bot) bots++;
      else humans++;
    }
    const want = this.cfg.bots === 0 ? 0 : Math.max(this.cfg.minBots, this.cfg.bots - humans);
    if (bots < want) {
      this.spawnBot();
    } else if (bots > want) {
      let smallest = null;
      for (const s of this.snakes.values()) {
        if (s.bot && (!smallest || s.mass < smallest.mass)) smallest = s;
      }
      if (smallest) this.kill(smallest, null, 'despawn');
    }
  }

  think(s, dt) {
    const ai = s.ai;
    ai.t -= dt;
    if (ai.t > 0) return;
    ai.t = 0.2 + Math.random() * 0.3;

    const { world } = this.cfg;
    const h = s.segs[0];
    const m = 250;
    s.boost = false;

    if (h.x < m || h.y < m || h.x > world - m || h.y > world - m) {
      s.target = Math.atan2(world / 2 - h.y, world / 2 - h.x);
      return;
    }

    // Steer away from the nearest body part of another snake.
    let danger = null;
    let best = (110 + radiusOf(s.mass)) ** 2;
    for (const o of this.snakes.values()) {
      if (o === s) continue;
      const oh = o.segs[0];
      const reach = o.segs.length * this.cfg.spacing + 150;
      if (Math.abs(oh.x - h.x) > reach || Math.abs(oh.y - h.y) > reach) continue;
      for (let i = 0; i < o.segs.length; i += 2) {
        const dx = o.segs[i].x - h.x;
        const dy = o.segs[i].y - h.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; danger = o.segs[i]; }
      }
    }
    if (danger) {
      s.target = Math.atan2(h.y - danger.y, h.x - danger.x);
      s.boost = s.mass > 30;
      return;
    }

    // Head for the nearest food, otherwise wander.
    let target = null;
    let bd = 350 * 350;
    for (const f of this.food.values()) {
      const dx = f.x - h.x;
      const dy = f.y - h.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; target = f; }
    }
    if (target) {
      s.target = Math.atan2(target.y - h.y, target.x - h.x);
    } else {
      ai.wander = Math.max(-1, Math.min(1, ai.wander + (Math.random() - 0.5) * 0.6));
      s.target = s.angle + ai.wander;
    }
  }

  // ---------- network snapshots ----------

  inView(s, me, V) {
    const segs = s.segs;
    for (let i = 0; i < segs.length; i += 4) {
      if (Math.abs(segs[i].x - me.x) < V + 100 && Math.abs(segs[i].y - me.y) < V + 100) return true;
    }
    return false;
  }

  sendSnapshot(p) {
    const V = this.cfg.view;
    const me = p.segs[0];

    const sn = [];
    for (const s of this.snakes.values()) {
      if (s !== p && !this.inView(s, me, V)) continue;
      const segs = s.segs;
      const n = segs.length;
      const flat = [];
      // Every second segment is enough: the client draws overlapping circles.
      for (let i = 0; i < n; i += 2) flat.push(Math.round(segs[i].x), Math.round(segs[i].y));
      if ((n - 1) % 2 !== 0) flat.push(Math.round(segs[n - 1].x), Math.round(segs[n - 1].y));
      sn.push({ i: s.id, n: s.name, h: s.hue, m: Math.round(s.mass), b: s.boosting ? 1 : 0, bt: s.bot ? 1 : 0, s: flat });
      // Send a player's photo once to each viewer, the first time they see them.
      if (s.av && !p.seenAv.has(s.id)) {
        p.seenAv.add(s.id);
        p.send(JSON.stringify({ t: 'av', i: s.id, d: s.av }));
      }
    }

    // Orbs are static, so they are sent at a lower rate (every 3rd tick) and only
    // inside the area a screen can actually show.
    if (p.seenAv.size > 600) { p.seenAv.clear(); p.seenAv.add(p.id); }
    const msg = { t: 's', y: p.id, k: p.kills, sn, lb: this.lb, rk: [this.rankOf.get(p.id) || this.total, this.total], on: this.online };
    p.snapTick = (p.snapTick || 0) + 1;
    if (p.snapTick % 3 === 1) {
      const FV = this.cfg.foodView;
      const fd = [];
      for (const f of this.food.values()) {
        if (Math.abs(f.x - me.x) < FV && Math.abs(f.y - me.y) < FV) {
          fd.push(Math.round(f.x), Math.round(f.y), f.v);
        }
      }
      msg.fd = fd;
    }

    if (p.snapTick % 4 === 1) {
      msg.mm = [...this.snakes.values()].map((s) => {
        const h = s.segs[0];
        const row = [s.id, Math.round(h.x), Math.round(h.y), s.hue, s.bot ? 0 : 1];
        if (!s.bot) row.push(s.name);
        return row;
      });
    }

    p.send(JSON.stringify(msg));
  }
}

module.exports = { Game, DEFAULTS, radiusOf, segCountOf, cleanName, cleanAvatar };
