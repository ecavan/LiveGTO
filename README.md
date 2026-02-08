# LiveGTO

Poker GTO trainer for live low-stakes ($1/2 - $2/5). Runs entirely in the browser as a PWA — works offline on any device. No solver needed at runtime — strategies are pre-computed via CFR+ and baked into `data/strategies.json`.

---

## Running Locally

```bash
git clone https://github.com/YOUR_USERNAME/LiveGTO.git
cd LiveGTO
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

---

## Install on iPhone / iPad (PWA)

LiveGTO is a Progressive Web App — no App Store needed.

1. Deploy to Vercel (see below) or run locally
2. Open the URL in **Safari** on your iPhone/iPad
3. Tap the **Share** button (box with arrow)
4. Tap **"Add to Home Screen"**
5. Tap **"Add"**

The app runs entirely offline after the first load. No server needed — everything runs in the browser.

---

## Game Modes

### Simulate
Heads-up session against an AI villain (70% GTO, 30% noise). Real chip stacks starting at 100bb, pot math, alternating positions. Session review shows P/L, BB/hand, and your top 5 mistakes ranked by GTO deviation.

### Play
Full hands from preflop through river. Deals 5 board cards upfront, reveals them street by street. Feedback after each decision with strategy bars and range breakdowns.

### Preflop
Drill raise-first-in and facing-open ranges. 13x13 range grid shows your hand highlighted against the full range.

### Postflop
Standalone postflop decisions. Random board texture, hand bucket, and position. Shows strategy frequencies, range-vs-range equity, and theory explanations.

### Filters
All drill modes support position filters (UTG/MP/CO/BTN/SB/BB). Postflop also supports texture filters (Monotone/Paired/Wet/High Dry/Low Dry).

---

## Architecture

```
index.html              App shell + CSS
src/
  main.js               Entry point, route registration
  router.js             Hash-based SPA router
  state.js              Global state (streak, filters)
  engine/
    evaluator.js        Hand evaluation (wraps pokersolver)
    cards.js            Card utils, deck, dealing
    ranges.js           Preflop RFI + facing-open range tables
    abstraction.js      Hand bucketing (9 buckets: premium -> air)
    postflop.js         Board texture classifier, strategy lookup
    scenarios.js        Scenario generators for all modes
    feedback.js         Answer evaluation, explanation generator
    rangeAnalysis.js    Range-vs-range equity from solver data
    simulate.js         Villain AI, pot math, showdown, session review
  ui/
    components.js       Shared rendering (cards, table, grids, bars)
    home.js             Mode selector
    preflop.js          Preflop drill page
    postflop.js         Postflop drill page
    play.js             Multi-street play mode
    simulate.js         Heads-up simulate mode
data/
  strategies.json       Pre-computed CFR+ strategies (~25KB)
solve/                  Local-only solver pipeline (Python)
public/                 PWA icons
test/
  engine.test.js        Engine unit tests (vitest)
```

Client-side SPA: all game logic runs in the browser. No server, no database, no sessions.

---

## Solver Pipeline

Pre-computes Nash equilibrium strategies for 9 hand buckets x 5 board textures x 3 positions (OOP/IP/facing bet). Run once locally:

```bash
source .venv/bin/activate
python -m solve.generate
```

Takes ~6 minutes. Outputs `data/strategies.json` which is committed and deployed.

---

## Deploying to Vercel

```bash
npm i -g vercel
vercel --prod
```

Or push to GitHub with Vercel connected for auto-deploy. Builds as a static Vite site.

---

## Testing

```bash
npm test
```

63 tests covering hand classification, texture detection, strategy coverage, and all engine modules.

---

## Tech Stack

- **Frontend**: Vanilla JS + Vite
- **Styling**: Tailwind CSS (CDN)
- **Hand evaluation**: pokersolver
- **Solver**: Pure Python CFR+ with numpy (local-only)
- **Deploy**: Vercel free tier (static site)
- **Offline**: PWA with vite-plugin-pwa + Workbox
