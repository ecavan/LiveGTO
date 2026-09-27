# LiveGTO

A free, personal "chess.com for live poker", for live $1/$2–$2/$5 NLHE. It runs in the browser as
a PWA and works offline on a phone.

- **Puzzles**: a real spot with your real hole cards. Pick one action and it's graded by EV against a
  solver or against a specific villain type (Station, Nit, Maniac, Whale). The review shows what it
  cost, both ranges on a 13×13 grid, the pot odds, and why the exploit differs from GTO. Puzzles are
  rated, and so are you, like chess puzzles.
- **Playbook**: the rules behind the puzzles. For a villain type, spot and flop texture (rainbow /
  two-tone / monotone, connected / semi / dry, paired, high card), it shows what each hand class
  does against him next to what a solver does, plus the adjustments that matter.
- **Play / Simulate / Preflop / Postflop**: the original drills. They still run on the old bucket
  model and are being rebuilt on the solver (see the roadmap).

Every answer is **one action**. There are no "call 55%" answers: against a known opponent the best
play is pure, and against GTO a mixed hand is indifferent.

## Run

```sh
npm install
npm run dev        # http://localhost:5173 → tap Puzzles
npm run dev:phone  # same, reachable from your phone on the same Wi-Fi (Vite prints the Network URL)
npm test           # engine + pot math + puzzle engine (vitest)
npm run build      # static site in dist/ (Vercel)
```

The puzzle library in `public/library/` comes from the Rust solver in `solver/`:

```sh
cd solver
cargo test --release
cargo run --release -p ps-cli -- library library/families.toml --out ../public/library
```

## Layout

```
src/engine/   potmath.js (textbook formulas), puzzles.js (selection, EV grading, Elo, explanations),
              plus the legacy drill engines
src/ui/       puzzles.js and the other modes
solver/       Rust: postflop-solver + node-locked villain profiles + library builder
public/library/  generated puzzle library (JSON)
docs/         DESIGN.md, THEORY.md (formulas and conventions), theory-audit.md (sources)
archive/      the Flask version and the old Python CFR+ solver
```

## Licence

AGPL-3.0-or-later for `solver/`, which builds on the AGPL postflop-solver. The web app keeps its own
LICENSE.
