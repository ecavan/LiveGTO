# LiveGTO

A free, personal "chess.com for live poker", for live $1/$2–$2/$5 no-limit hold'em. It runs in
the browser as a PWA, is designed for the iPad first, and works offline once installed.

Two **levels**, everywhere: **Level 1 · Baseline** grades you against the solid play (what a strong
player does against a strong player), **Level 2 · Exploit** against the villain in front of you.
Each level has its own puzzle and Play rating, and every answer shows the other level's play too.
The stats and the words are the online ones (VPIP, PFR, 3-bet, c-bet, fold to c-bet, WTSD, AFq).

Three modes:

- **Learn**: the Boot Camp course (5 modules, 415 lessons and questions, with Feel / Formula / Proof
  depths, corrected against the textbooks), a timed bet-size feel drill in dollars, endless
  table-maths drills (pot odds, MDF, α, bluff-to-value, outs, combos, SPR, geometric sizing,
  implied odds), the live preflop charts with a trainer, and cheat sheets. **Hand buckets**: six
  kinds of hand after the flop (nuts, value, bluff-catcher, draw, air with equity, air) and the
  plan for each on each kind of board (dry, wet, paired, monotone), at Level 1 and against each
  villain type, with an endless *Bucket your hand* drill on hands you'd really have. **Player
  types**: the eight kinds of player with their real HUD stats, how to spot each one live and how
  to beat him.
- **Puzzles**: a solved spot with your real hole cards and one right answer, graded by EV against a
  specific villain type (Station, Nit, Maniac, Whale) or GTO, plus flop and multiway spots from
  the Play engines. Rated like chess puzzles. Every postflop puzzle first asks which bucket your
  hand is in, then for the play. Every answer shows the plan for your whole range by
  **hand bucket**. Level 1 puzzles are against GTO (or priced as if the villain played solid),
  Level 2 against a villain type. Plus
  a daily puzzle (with a streak), a review queue that brings back every puzzle you miss (1, 3, 7
  days), a range builder (paint a whole preflop range), and the Buckets drill (one plan per kind
  of hand after the flop).
- **Play**:
  - *Heads-up* against seven rated bots, from Whale to Pro. Every bot learns your habits (the
    weak ones slowly) and remembers you. The coach grades every decision by EV against the bot's
    real range, and shows your range by bucket with a plan for each; the review separates the
    EV you gave up from all-in luck and gives you a Play rating.
  - *Live table*: 4–6 players drawn from a live $1/$2 pool, each a mix of styles, read from their
    stats; Easy / Medium / Hard; 100bb, 200bb or a live mix of stacks ($50 short stacks next to
    $600 deep ones, SPR shown). The coach grades you against everyone still in the hand.
  - *Watch*: two bots, cards face up, every decision explained (how the Pro takes apart a
    Station), with match stats and how the winner is winning.
  - *Review*: chess-style game review of every hand you played: accuracy, Best / Good /
    Inaccuracy / Mistake / Blunder, a replayer that hides your answer until you've guessed, and a
    leak report across sessions. **Log a live hand** from the casino and the coach grades it too.

Every answer is **one action**. There are no "call 55%" answers.

The bots are calibrated against real hands: 8.9 million low-stakes online hands and Pluribus's
10,000 hands against pros. Each archetype plays like the real players of its type (preflop ranges,
c-betting, donk-betting, folding by street, river bluffs), the postflop baseline is what Pluribus
did with each kind of hand, and the preflop charts and the solver are checked against Pluribus.
The hands are from 2009: the fish keep their real numbers (live fish play much as they did), and
the Reg sits halfway between the 2009 regs and the 2019 pros, the way regulars have moved since
solvers.
See [docs/CALIBRATION.md](docs/CALIBRATION.md).

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
src/engine/ring/ live table: game.js (2–6 players, side pots), players.js, coach.js, session.js
src/engine/hu/   heads-up engine: game.js (rules), equity.js (range-vs-range equity), policy.js
                 (strategies as arrays), bots.js (profile bots), thinker.js (thinking bots),
                 agents.js (all bots + Elo), range.js (reading his range), coach.js, session.js
src/engine/      potmath.js, drills.js, puzzles.js, playbook.js, ranges.js, texture.js, library.js,
                 history.js (hand history, grades, leaks), livelog.js (logging casino hands),
                 level.js (Level 1 / 2), buckets.js (six buckets, board kinds), plans.js +
                 plans.json (the plan per bucket, board and level, from the library:
                 scripts/build-plans.mjs)
src/ui/          home, learn (+ learn/*), puzzles (+ puzzles/*: ranges, generated), play (+ play/*:
                 table, watch, review, logger, views), settings, kit.js (UI kit)
public/          course.json (Boot Camp, built by scripts/build-course.mjs), library/ (solved spots),
                 spots/ (flop + multiway puzzles, built by scripts/gen-spots.mjs)
solver/          Rust: postflop-solver + node-locked villain profiles + library builder;
                 crates/ps-phh reads real hand histories (PHH) into player stats
analysis/        calibration against real hands: stats by player type, fitting, checks vs Pluribus
scripts/         match.mjs (bot vs bot, duplicate deals), ladder.mjs (Elo), calibrate.mjs (rating),
                 gen-spots.mjs (flop / multiway / bucket spots at both levels), build-plans.mjs
docs/            DESIGN.md, THEORY.md, theory-audit.md
```

Rebuild the puzzle library with `npm run library` (needs Rust).

## Licence

AGPL-3.0-or-later for `solver/`, which builds on the AGPL postflop-solver. The web app keeps its own
LICENSE.
