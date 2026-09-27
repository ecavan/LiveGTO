# LiveGTO

A free, personal "chess.com for live poker", for live $1/$2–$2/$5 no-limit hold'em. It runs in
the browser as a PWA, is designed for the iPad first, and works offline once installed.

Three modes:

- **Learn**: the Boot Camp course (5 modules, 415 lessons and questions, with Feel / Formula / Proof
  depths, corrected against the textbooks), endless table-maths drills (pot odds, MDF, α,
  bluff-to-value, outs, combos, SPR, geometric sizing, implied odds), a range drill ("who
  continues?" on solved spots), the live preflop charts with a trainer, and cheat sheets.
- **Puzzles**: a solved spot with your real hole cards and one right answer, graded by EV against a
  specific villain type (Station, Nit, Maniac, Whale) or GTO. Rated like chess puzzles.
- **Play**: heads-up against seven rated bots, from Whale to Pro. The thinking bots read your
  range, learn your habits between hands and sessions, and punish bluffing that works "only in
  the short run". The coach grades every decision by EV against the bot's real range; the session
  review separates the EV you gave up from all-in luck and gives you a Play rating.

Every answer is **one action**. There are no "call 55%" answers.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173
npm run dev:phone    # reachable from an iPad/phone on the same Wi-Fi (open the Network URL)
npm test             # engine, bots, coach, drills (vitest)
npm run build        # static site in dist/ (Vercel)
```

On the iPad: open the site in Safari → Share → Add to Home Screen. Then Settings (gear) →
"Download puzzle library" once, and everything works offline.

## Where things are

```
src/engine/hu/   heads-up engine: game.js (rules), equity.js (range-vs-range equity), policy.js
                 (strategies as arrays), bots.js (profile bots), thinker.js (thinking bots),
                 agents.js (all bots + Elo), range.js (reading his range), coach.js, session.js
src/engine/      potmath.js, drills.js, puzzles.js, playbook.js, ranges.js, texture.js, library.js
src/ui/          home, learn (+ learn/*), puzzles, play (+ play/views.js), settings, kit.js (UI kit)
public/          course.json (Boot Camp, built by scripts/build-course.mjs), library/ (solved spots)
solver/          Rust: postflop-solver + node-locked villain profiles + library builder
scripts/         match.mjs (bot vs bot, duplicate deals), ladder.mjs (Elo), calibrate.mjs (rating)
docs/            DESIGN.md, THEORY.md, theory-audit.md
```

Rebuild the puzzle library with `npm run library` (needs Rust).

## Licence

AGPL-3.0-or-later for `solver/`, which builds on the AGPL postflop-solver. The web app keeps its own
LICENSE.
