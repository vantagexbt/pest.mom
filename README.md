# pest.mom

![CI](https://github.com/YOUR_GITHUB_NAME/pest-mom/actions/workflows/ci.yml/badge.svg)

**Become the biggest pest on Solana.**

A free multiplayer fly game that runs in the browser. Fly around, eat `$PEST`
orbs, grow a tail of coins and make other flies crash into it. Hit someone
else's tail and you are out.

- **One online arena.** Everyone who opens the page plays in the same room (up to 40 players).
- **Make your fly.** Pick a nickname, a tail colour and, if you want, a photo for the fly's head.
- **Bots keep it lively.** A few AI flies fill the arena when few people are online.
  They are labelled "bot" and step aside as real players join.
- **Fly brain.** The corner widget is a decorative visualisation of neurons firing when
  you eat, boost or get in danger. It is a visual effect, not a real AI.

## Is this legit? Read the code.

This repository is the **entire** game, client and server. Things you can verify yourself:

- The game **never asks for a wallet**, a signature or any login. There is no wallet code in this repo.
- There is **no real-money play**, no deposits, no payouts. Points are just your length.
- The only outside request the page makes is Google Fonts. The "Share on X" button only
  opens a prefilled post link when you click it; the game never connects to your X account.
- Photos are shrunk to a tiny JPEG in your browser and sent to the server, which only forwards
  them to other players in the arena. Nothing is stored on disk.
- `$PEST` is a memecoin. The game does not affect its price and nothing here is financial advice.
  The official contract address will be listed here once it exists: `TBA`.

## Run it locally

```bash
npm install
npm start          # http://localhost:3000
```

Open it in two tabs to try multiplayer.

| Variable | Default | Meaning                                              |
| -------- | ------- | ---------------------------------------------------- |
| `PORT`   | `3000`  | HTTP + WebSocket port                                |
| `BOTS`   | `12`    | Flies kept in the arena in total (bots fill the gaps; `0` disables bots) |

```bash
npm test           # headless simulation test
```

## How it works

The server is authoritative: it runs all movement, eating and collisions 20 times per second.
Browsers only send "steer this way / boosting or not" and draw what the server sends back,
so a modified client cannot give itself length.

```
client/index.html   rendering, input, menu, fly brain, HUD (no build step)
client/coin.png     the $PEST coin picture used inside every orb
server/game.js      game rules: movement, orbs, collisions, bots, snapshots
server/index.js     static files + WebSocket glue
server/test-sim.js  headless test of the game rules
```

Tuning (speed, map size, orb amount, bots) lives in `DEFAULTS` at the top of `server/game.js`.
The coin name, picture and colour are in the `COIN` block at the top of the script in `client/index.html`.

## Deploying

Any host with long-lived WebSocket support works (Render, Railway, Fly.io, a small VPS).
Start command: `npm start`. Use HTTPS; the client switches to `wss://` automatically.
A `render.yaml` is included for one-click deploys on Render.

## Known limits

- One room, plain JSON snapshots (about 50 KB/s per player).
- No accounts and no report button for photos yet. Add moderation before a big public launch.
- No per-IP connection limits yet.

## License

MIT, see `LICENSE`.
