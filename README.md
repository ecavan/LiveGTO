# LiveGTO
# Poker Decision Trainer

Personal decision-training web app for live low-stakes poker ($1/2–$2/5). Not a solver — compressed decision theory. Trains automatic, disciplined instincts through active recall.

Flask + HTMX (Python everywhere), deploys free to Vercel via GitHub.

---

## Architecture

Two phases:

**Offline (run once on your laptop):** A mini CFR solver computes approximate Nash equilibrium strategies for a heavily abstracted game tree (6 hand buckets × 5 board textures × 3 bet sizes). Outputs JSON files.

**Online (web app):** Flask loads those JSONs at startup, generates random scenarios, evaluates your decisions against the solved strategies, shows range-vs-range feedback. Stateless — perfect for Vercel serverless.

```
solver/solve.py  →  data/*.json  →  Flask app reads JSON, serves HTML
(run locally)       (committed)      (deployed to Vercel)
```

No database. No persistent state. Strategy files are baked in at deploy time.

---

## Tech Stack

- **Solver**: Pure Python + numpy (CFR is just array math, your toy tree is tiny)
- **Hand evaluator**: `treys` (fast Python lookup-table eval, ~250k evals/sec, `pip install treys`)
- **Web framework**: Flask (serves HTML via Jinja2 templates)
- **Frontend**: HTMX (click button → Flask returns HTML fragment → swapped in, zero JS) + Tailwind CSS (CDN)
- **Deploy**: Vercel free hobby tier (push to GitHub → auto-deploys)

```
# requirements.txt
flask
treys
numpy
```

---

## Project Structure

```
poker-trainer/
├── api/
│   └── index.py              # Flask app (Vercel entry point)
├── engine/
│   ├── __init__.py
│   ├── cards.py               # Card utilities using treys
│   ├── ranges.py              # Preflop range tables (hand-tuned)
│   ├── abstraction.py         # Equity calc + hand bucketing (nut/strong/medium/draw/weak/air)
│   ├── postflop.py            # Board texture classifier (monotone/paired/wet/high_dry/low_dry)
│   ├── scenarios.py           # Scenario generators for all 3 modes
│   └── evaluator.py           # Check answers, generate feedback + range breakdowns
├── solver/
│   ├── __init__.py
│   ├── cfr.py                 # Vanilla CFR algorithm
│   ├── game_tree.py           # Simplified poker game tree (3 bet sizes, 1 raise cap)
│   ├── equity.py              # Monte Carlo equity matrices per texture per bucket pair
│   └── solve.py               # Entry point: run solver → output JSONs to data/
├── data/
│   ├── preflop_rfi.json       # Raise-first-in ranges by position
│   ├── preflop_vs_open.json   # Facing open: call/3bet/fold
│   ├── preflop_bb_defense.json
│   └── postflop_strategies.json  # CFR-solved strategies by context × texture × street
├── templates/
│   ├── base.html              # Layout + Tailwind/HTMX CDN imports
│   ├── home.html              # Mode selector
│   ├── preflop.html
│   ├── postflop.html
│   ├── play.html
│   └── partials/
│       ├── cards.html         # Card rendering
│       ├── feedback.html      # Correct/incorrect + explanation + range display
│       ├── range_grid.html    # 13×13 preflop grid
│       └── actions.html       # Action buttons
├── static/
│   └── style.css              # Card styling, range grid colors
├── requirements.txt
└── vercel.json
```

Vercel expects the Flask app at `api/index.py`. It maps all requests there.

---

## The Mini Solver: CFR on a Simplified Game Tree

### What CFR is

GTO solvers use Counterfactual Regret Minimization — an iterative self-play algorithm, not a PDE or LP. The loop:

1. Initialize all strategies to uniform random
2. For many iterations: traverse the game tree, compute counterfactual regret at each decision point (how much better each action would have been vs current strategy), update strategy proportional to positive regrets
3. The average strategy across all iterations converges to Nash equilibrium

Math: at information set I with actions A(I), cumulative regret R^T(I,a) = Σ_t [v(σ_t|I→a, I) - v(σ_t, I)]. Strategy via regret matching: σ(I,a) ∝ max(R(I,a), 0). Average strategy σ̄ converges to ε-Nash.

Full NLHE has ~10^160 states. Your abstracted game has ~750 information sets per player per street. CFR solves it in seconds.

### The three abstraction layers

**Hand buckets (6 categories based on equity vs villain's range):**

| Bucket | Equity vs range | Examples |
|--------|----------------|----------|
| nut | ≥80% | Sets, two pair+, nut flush draws |
| strong | 65-80% | Overpairs, top pair top kicker |
| medium | 50-65% | Top pair weak kicker, middle pair |
| draw | 35-50% | Flush draws, OESDs, combo draws |
| weak_draw | 20-35% | Gutshots, backdoor draws |
| air | <20% | Nothing |

Equity calculated via Monte Carlo using `treys`: deal out remaining cards N times, count wins.

**Board textures (5 categories):**

| Texture | Definition |
|---------|-----------|
| monotone | 3+ same suit |
| paired | Board has a pair |
| wet | Connected (gaps ≤2) + two-tone |
| high_dry | 2+ broadway cards, rainbow, unconnected |
| low_dry | Low cards, rainbow, unconnected |

**Bet sizes (3 only):**

| Size | Fraction of pot | Usage |
|------|----------------|-------|
| Small | 33% | C-bets dry boards, thin value, probes |
| Medium | 66% | Standard value, semi-bluffs |
| Large | 100% | Polarized (nuts + bluffs) |

Plus check, fold, call. Max 6 actions at any node.

### Game tree structure

One postflop street, heads-up, OOP acts first, 1 raise cap:

- OOP: check / bet_s / bet_m / bet_l (4 actions)
- IP after check: check / bet_s / bet_m / bet_l (4 actions)
- IP facing bet: fold / call / raise_s / raise_m / raise_l (5 actions)
- After raise: fold / call only (capped)

~25-30 terminal nodes per bucket pair. With 6 buckets × 5 textures = ~750 info sets per player. Trivial for CFR.

### Solver output → training feedback

The solver outputs mixed strategies like: "OOP with nut bucket: check 5%, bet_s 20%, bet_m 35%, bet_l 40%."

For the trainer, simplify to a discrete correct action (highest probability). If no action >50%, accept top two as both correct. The full distribution is shown in the range-vs-range display.

### Range vs range display (the key learning feature)

After each decision, show both sides:

```
YOUR RANGE                        VILLAIN'S RANGE (after check)
Nut    → Bet Large 75%            Nut    → Check-Raise 60%
Strong → Bet Medium 50%           Strong → Call 80%
Medium → Check 55%                Medium → Call 65%
Draw   → Bet Small 60%            Draw   → Call 55%
W.Draw → Check 70%                W.Draw → Fold 50%
Air    → Check 60%                Air    → Fold 85%

Your hand: A♠K♥ → Strong (62% equity) → Solver says: Bet Medium
```

Both panels come directly from the solved strategy JSONs.

---

## Game Modes

### Preflop Mode — Range Trainer

Uses hand-tuned range tables, NOT the solver. Preflop is well-solved for live play.

**You see:** Position, action before you, your two cards.
**You pick:** Fold / Call / Raise / 3-Bet.
**Feedback:** Correct/incorrect, short explanation, 13×13 range grid with your hand highlighted.

Situations in priority order:
1. RFI (raise first in) — set of hands per position
2. BB defense vs open — set per opener position
3. Facing open (non-BB) — call/3bet/fold per position pair
4. SB vs BB steal/defend
5. Facing 3-bet

### Postflop Mode — Decision Discipline

Solver-backed. Random board → classify texture → bucket your hand → look up solved strategy → evaluate → show range-vs-range.

**You see:** Preflop context, board cards, your hand, villain's action, pot size.
**You pick:** Check / Fold / Call / Bet Small / Bet Medium / Bet Large.
**Feedback:** Correct/incorrect, what solver recommends for your bucket, full range breakdown for both players.

### Play Mode — Full Hands

Combines preflop ranges + postflop solver across all streets.

**Flow:** Random position → preflop decision → flop decision → turn → river → session summary.

Feedback after EACH street (this is training, not a real game). Session tracks leaks: overfolding, over-bluffing, missed value, preflop too loose/tight. No persistence — resets each session.

---

## Frontend

Dark theme, CSS-only cards (no images), HTMX for all interactions.

**HTMX pattern** — the entire app interaction with zero JavaScript:

```html
<button hx-post="/api/answer"
        hx-vals='{"action": "bet_m", "scenario_id": "abc123"}'
        hx-target="#feedback"
        hx-swap="innerHTML">
    Bet Medium (66%)
</button>
<div id="feedback"><!-- Flask returns feedback.html partial here --></div>
```

Click → POST to Flask → Flask evaluates answer, renders feedback partial → HTMX swaps it in. No page reload.

Cards are styled divs with rank/suit text, red for hearts/diamonds, black for spades/clubs. The 13×13 range grid is an HTML table with green (in-range), gray (fold), yellow border (your hand).

Base template imports Tailwind + HTMX via CDN in `<head>`. No build step.

---

## Implementation Order

### Phase 1: Preflop Trainer (weekend)

No solver needed. Hand-curated ranges only.

1. `engine/cards.py` — treys wrappers, deck, hand_key function
2. `engine/ranges.py` — RFI ranges per position as Python sets
3. `data/preflop_rfi.json` — same as JSON
4. `engine/scenarios.py` — generate random preflop spots
5. `engine/evaluator.py` — check answer vs range table
6. `api/index.py` — Flask routes (GET /preflop, POST /api/answer, GET /api/next/preflop)
7. Templates + partials + CSS
8. `vercel.json` + push to GitHub → live on Vercel

**Milestone: working preflop trainer deployed.**

### Phase 2: Solver Foundation (1-2 weeks)

The math phase. Work in notebooks first.

9. `engine/abstraction.py` — equity calculator + hand bucketing via treys
10. `engine/postflop.py` — board texture classifier
11. `solver/game_tree.py` — build simplified tree
12. `solver/cfr.py` — vanilla CFR
13. `solver/equity.py` — precompute equity matrices per texture
14. `solver/solve.py` — run solver → output `data/postflop_strategies.json`
15. Validate: do nut hands bet big? Does air check? Do draws semi-bluff? Tweak buckets if not.

**Milestone: solver produces plausible strategy JSONs.**

### Phase 3: Postflop Trainer (1 week)

16. Load strategy JSONs at Flask startup
17. `engine/scenarios.py` — generate postflop spots (deal board, classify, bucket, look up strategy)
18. Postflop routes + templates + range-vs-range display
19. Push → auto-deploys

**Milestone: working postflop trainer with solver-backed decisions.**

### Phase 4: Play Mode (3-5 days)

20. Multi-street flow: preflop → flop → turn → river
21. In-session scoring + leak tracking (Python dict, no DB)
22. Session summary template

**Milestone: full game loop.**

### Phase 5: Polish

23. Add facing-open + BB defense preflop situations
24. Keyboard shortcuts (F/C/R for fold/call/raise)
25. Mobile-friendly card sizing
26. Better explanation templates
27. Refine solver (more buckets, better equity calcs)

---

## Running Locally

```bash
git clone https://github.com/YOU/poker-trainer.git
cd poker-trainer
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Phase 2+: run solver first
python -m solver.solve

# Start app
cd api && flask --app index run --debug
# → http://localhost:5000
```

---

## Deploying to Vercel (Free)

### vercel.json

```json
{
  "builds": [
    { "src": "api/index.py", "use": "@vercel/python" }
  ],
  "routes": [
    { "src": "/static/(.*)", "dest": "static/$1" },
    { "src": "/(.*)", "dest": "api/index.py" }
  ]
}
```

### Deploy

```bash
npm i -g vercel
vercel          # first time — follow prompts
# After that: push to GitHub → auto-deploys
```

### Vercel constraints (all fine for this app)

- No persistent filesystem → fine, strategies are baked into data/ at deploy time
- 10-second execution limit → fine, routes just read JSON and render templates
- 250MB package limit → Flask + treys + numpy fits easily
- Cold starts ~2-3s → acceptable for personal use

---

## Future Expansions

| Feature | Effort | Impact |
|---------|--------|--------|
| Keyboard shortcuts | 2 hrs | High |
| BB defense + facing-open preflop | 1 day | High |
| More hand buckets (6→10) | Solver-side | Better decisions |
| Timed mode (10s/decision) | 2 hrs | Simulates live pressure |
| 5-min warmup mode | 1 hr | Pre-session drill |
| Population exploit knobs ("live regs overfold") | 1 day | Tune for your actual game |
| Spaced repetition on missed spots | 1 day | Very high (needs persistence) |