# LiveGTO — design

LiveGTO is a free, personal "chess.com for live poker": puzzles, rated bots and hand review for
live $1/$2–$2/$5 NLHE. The goal is to beat $2/$5 with confidence and one day play $5/$10.

> GTO is the baseline. Exploitation is the adaptation. Every answer is one action.

## 1. What it is

| Chess habit | LiveGTO |
|---|---|
| Engine | `postflop-solver` (Rust, Discounted CFR, node locking) in `solver/` for puzzles; a JS range-vs-range engine for play |
| Lessons | **Learn**: the Boot Camp course, table-maths drills, range drills, preflop trainer (§10) |
| Puzzles (rated) | A real solved spot, your real cards, one correct action, vs a villain type or GTO (§7) |
| Bots with Elo | **Play**: seven bots from Whale to Pro on one Elo ladder; the thinking bots adapt to you (§9) |
| Game review ("you played like an 1100") | EV lost per decision against the bot's real range, luck shown separately (§5, §9) |

Three modes: Learn, Puzzles, Play. It's an iPad-first PWA on Vercel and works offline: the app,
course and bots ship with the page, and the solved puzzle library (~36 MB of JSON) downloads once
from Settings.

## 2. Principle: one action, never frequencies

Live, nobody randomises. Two facts make pure answers correct rather than a simplification:

1. **Against a known opponent the best response is pure.** With villain's strategy σ_V fixed,
   hero solves a one-player problem, BR(σ_V) = argmax_σH u_H(σ_H, σ_V), and a one-player problem
   always has a deterministic optimum. Every hand has exactly one best action (ties are real
   indifference: either is fine).
2. **Against GTO, mixing only happens where you're indifferent.** A hand that mixes has equal EV
   for its actions, so no single choice is a mistake. What matters is the *range*: if every
   bluff-catcher folds, a thinking opponent bluffs you off every pot. So the GTO playbook keeps the
   range-level frequencies and hands each action to the hands that lean towards it most: "call
   with the best 40% of your bluff-catchers, fold the rest". That's how strong live players stay
   balanced without dice.

The trainer reports how much never-mixing costs, so this stays a measured choice:

- `Exploit, one action per hand` vs the best exploit: ≈ 0 by (1). Verified by test.
- `GTO playbook vs a perfect opponent`: the worst case if someone knew your exact playbook, which
  no $1/$2 player does. So far: 2.5–3bb in a ~20bb river pot, but 8.6bb in a 16bb turn pot,
  where the playbook covers two streets. Improving the purification (for example choosing
  hands by EV threshold instead of greedy quotas) is an open item.

Answers are graded by EV, not by matching frequencies. Any action within `fine_pct` (default 1%) of
the pot of the best one counts as correct, and the grader shows it as "also fine".

## 3. Profiles: human leaks as edits to GTO

A profile is a TOML list of rules. Each rule says where it applies (street, facing a bet or not,
the size faced, hand class) and how it bends the GTO frequencies:

- `scale = { fold = 0.25 }`: "folds a quarter as often as a solver". The frequency of the
  matched actions is multiplied by m^λ (capped at 1), and the other actions absorb the difference
  in proportion to their GTO weight:
  σ'(S|h) = min(1, m^λ · σ(S|h))
- `set = { raise = 0.7, call = 0.3 }`: "raises his draws 70% of the time", whatever GTO does:
  σ' = (1 − λ)·σ + λ·target

Hand classes are what a live player sees: `monster, strong, medium, weak, draw, air`
(see `ps-core`). Action classes: `fold, check, call, bet, bet_small, bet_large, raise, allin,
aggressive, passive`. Facing sizes: `small` (< ½ pot), `large` (½–1 pot), `overbet`.

Shipped profiles: `gto`, `station`, `nit`, `maniac`, `whale`. **They are hypotheses, not facts.**
The exploit is only as good as the read. The first calibration mistake is instructive: a
"folds ¼ as often" rule, applied to a 5×-pot river shove, turned a station into someone who calls
off 90bb with second pair. That's why `facing_size` exists. Tune profiles against what you see at
the table.

## 4. What one spot analysis computes

Five copies of the same tree, lined up node-for-node by action history:

| game | hero | villain | answers |
|---|---|---|---|
| A | solved | solved | GTO baseline |
| B | solved | locked = profile | best exploit of this villain |
| C | locked = GTO | locked = profile | what GTO alone wins against him |
| P | locked = one-action exploit | locked = profile | exploit with no mixing |
| Q | locked = GTO playbook | free (best response) | worst case of never mixing |

Invariants (tested in `solver/crates/ps-solve/tests/invariants.rs`). v = GTO value, ε = exploitability:

1. GTO guarantee: EV(GTO vs any villain) ≥ v − ε
2. Best response dominates: EV(BR vs P) ≥ EV(GTO vs P)
3. Convergence: the solved exploit matches the exact best-response value (`compute_mes_ev`)
4. Pure is enough: the one-action exploit ≈ the best exploit
5. No free lunch: a fixed playbook vs a perfect opponent ≤ v + ε
6. Identity: λ = 0 or the GTO profile changes nothing
7. Zero-sum (no rake); plus the textbook toy games in §6, which have exact answers

A lesson already visible in the numbers: against a Station on the river, GTO alone gains about
0.1–0.5bb from his leaks, and *adjusting* gains 4–7bb. GTO doesn't punish leaks where the villain's
choices were indifferent. You only collect by changing your play.

## 5. Ratings

Three ratings, all on a chess-like scale:

- **Puzzle rating**: Elo against the puzzle's rating (§7).
- **Bot Elo** (the ladder, `scripts/ladder.mjs` → `src/engine/hu/ladder.json`). Poker isn't
  transitive (a Whale and a Reg roughly break even against each other, yet the Pro beats one far
  harder than the other), so every bot is measured against one yardstick, the strongest bot:

  ```
  Elo(X) = 2000 − 900 · log₁₀(1 + W / 25)      W = the Pro's win rate against X, bb/100
  ```

  Beaten by 25bb/100 → ~1730; by 100 → ~1370; by 400 → ~890. Matches are *duplicate*: each deal is
  played twice with the seats swapped, which cancels most card luck.
- **Your Play rating**. Results over a few hundred hands are mostly noise, so the rating uses the
  EV you give up: every decision is graded by the coach against the bot's actual range and
  strategy, and L = EV lost per 100 hands.

  ```
  R = a − b · log₂(1 + L / L₀)
  ```

  a, b and L₀ are fitted by `scripts/calibrate.mjs`: each profile bot plays the Pro with the coach
  grading its decisions exactly as it grades yours, and the fit maps each bot's L to its ladder
  Elo. R(0) is pinned at 2100 (play the coach can't fault is above the Pro, who is exploitable).
  Current fit: R = 2100 − 1020·log₂(1 + L/855), RMSE 175 Elo over the five profile bots
  (`src/engine/hu/calibration.json`). Roughly: losing 100bb/100 of EV ≈ 1940, 300 ≈ 1660,
  650 ≈ 1270, 1150 ≈ 850. Your Play rating is the hands-weighted average of your recent sessions
  (up to 1,000 hands). It is an estimate: treat ±150 as noise.

Current ladder (duplicate matches, 6,000 hands per pair; Elo ± ~150 for the noisier pairs):

| Bot | Whale | Maniac | Station | Nit | Shark | Reg | Pro |
|---|---|---|---|---|---|---|---|
| Pro wins (bb/100) | 442 | 376 | 99 | 53 | — | 31 | 0 |
| Elo | 860 | 920 | 1380 | 1560 | 1660 | 1690 | 2000 |

The Shark is rated through the profile bots it beats (thinking bot vs thinking bot is too noisy).
The Reg is strong because, like every bot now, it adjusts to its opponent (§8).

Preflop is graded against the chart (The Course). An off-chart choice costs what the EV model
says the chart play was worth over it (one street ahead, equity realisation 0.95 in position,
0.8 out of position), at least 15% of the pot. Shoving, and calling a shove, are graded by exact
EV against his range.

## 6. Is the solver right? Textbook games with exact answers

These are **engine tests only**. They never appear in the app, whose puzzles are about exploiting
real player types. They exist because every number the app shows comes from `solver/`, so the
solver is checked against poker games with closed-form solutions, played on real cards
(`solver/crates/ps-solve/tests/textbook.rs`).
Sources and derivations are in `docs/theory-audit.md` §2.

| Test | Game | Checked |
|---|---|---|
| T1 | Clairvoyance: nuts + air vs a bluff-catcher (MoP 11.1/14.1, Acevedo p.98) | Value 50(1+2s)/(1+s) for s = ½, 1, 2; bluffs s/(1+s); calls 1/(1+s) |
| T1-lock | Node-locked caller (Acevedo MinES p.124) | Pure best response flips at the indifference point; EV 77.5 / 100 |
| T1-maniac | Bettor bluffs every air hand | Bluff-catcher must always call; value 50 |
| T2 | AKQ half street (MoP ch.13, Brokos ch.3) | IP 52.78; QQ bluffs ⅓; KK calls ⅓ |
| T2-lock | KK never / always calls | QQ always / never bluffs; 58.33 |
| T3 | Kuhn poker | OOP 47.22; the equilibrium *family* (AA bets 3a, KK calls a + ⅓); IP unique |

Building these caught a real trap. postflop-solver adds an all-in option automatically when stacks
are short relative to the pot, so the "AKQ half street" became Kuhn poker. The solver's answer was
right (it was Kuhn's family of equilibria); the spot was wrong. Spots can now turn that off
(`add_allin_threshold = 0`).

App-side formulas (pot odds, α, MDF, bluff share, geometric sizing, outs) live in
`src/engine/potmath.js` and are tested against the books' reference values in
`test/puzzles.test.js`. `docs/THEORY.md` lists the conventions and the corrections to the older
material.

## 7. The puzzle library

`ps library solver/library/families.toml --out public/library` builds it:

1. **Preflop** gives the ranges for each spot family (`solver/library/families.toml`):

   | Family | Preflop | Lead |
   |---|---|---|
   | `srp_btn_bb` | BTN opens 2.5bb, BB calls | BTN |
   | `srp_co_btn` | CO opens 5bb, BTN calls | CO (out of position) |
   | `srp_ep_bb` | UTG opens 5bb, BB calls | UTG |
   | `3bp_bb_btn` | BTN opens 5bb, BB 3-bets to 18bb, BTN calls (SPR ≈ 2.2) | BB (out of position) |
   | `limp_mp_bb` | MP limps, BB checks (SPR ≈ 40) | nobody |

   Opening ranges are Ed Miller's live ranges (The Course). The 5bb opens match $10 at $1/$2.
2. **Flop**: GTO solve on a coarse tree, only to get realistic ranges at the start of the turn after
   "c-bet called" and "checked through".
3. **Turn**: for sampled turn cards, analyse the two decisions of the line against every profile
   (5 games each, §4). When IP has the lead, that's "checked to you" (IP) and "facing a 75% bet"
   (OOP). When OOP has it (CO vs BTN, the 3-bet pot), it's "first to act" (OOP) and "facing a
   75% bet" (IP).
4. **River**: a GTO turn solve gives river ranges after "barrel called" / "checked through". Same
   two decisions × profiles.
5. **Records**: each (decision × profile) record stores the table, the history, class-level answers,
   the villain's range (solver vs profile) and 13×13 range grids for both players. It also keeps up
   to 8 puzzles: real hole cards whose best action beats the next-best wrong one by at least 4% of the
   pot. Each puzzle carries its EV for every action, both the GTO and the exploit answer, and a
   rating.

Ratings start as a heuristic: harder when the exploit changes the GTO
answer, when the EV gap is small, or when the answer is counter-intuitive (fold a strong hand, call
with a weak one). Once there are enough attempts, real solve rates replace the heuristic.

Known limits:
- Profiles act only on the decision street. Earlier streets are GTO, so a Station's turn range
  doesn't yet include his loose flop calls.
- Flop puzzles aren't in the solver library; the Flop and Multiway sets (§7c) come from the Play
  engines instead.
- The flop tree used for turn ranges is coarse: one 33% c-bet, 3× raises, one turn size and one
  river size plus all-in. It fits in about 1 GB; your Mac can afford a richer one.

## 7c. More puzzle modes

Puzzles has five modes: **Rated**, **Daily**, **Review**, **Ranges** (preflop), **Buckets**
(postflop). Rated draws from three sources: the solver library above (turn and river), flop spots
and multiway spots (below), 50 / 30 / 20 unless a filter picks one (street: flop / turn / river;
players: heads-up / multiway; villain type, pot type and texture filters apply to the library).

- **Daily**: one library spot per date, fixed by a hash of the date (same spot and same suits for
  everyone). Unrated; it keeps a streak of consecutive days.
- **Review** (spaced repetition): every puzzle you miss, in any mode, joins a queue. It comes back
  after 1 day; solve it and it comes back after 3, then 7; solve it then and it leaves. Miss it and
  it starts over. Unrated, so nobody farms rating on known puzzles.
- **Ranges** (range builder): paint a whole preflop range on the 13×13 grid (raise / call / fold,
  drag to paint on the iPad) for 11 spots: opens from each seat, and 3-bet / call / fold against
  an open. Graded cell by cell against The Course charts, weighted by combos: score = combos played
  right ÷ combos either of you plays (a 3-bet where the chart calls counts half). Too loose, too
  tight and wrong-action cells are coloured.
- **Buckets** (`public/spots/buckets.json`): a spot, your whole range split into buckets (§7d),
  and one action to choose for each. Graded per bucket against the coach's best play for every
  hand in it: right if it's the bucket's best play or the best play for 40%+ of its hands;
  score weighted by each bucket's share of your range. Heads-up on every street and multiway.
  (This replaces Learn's "Who continues?", which used the library's six classes.)
- **Flop** and **Multiway** spots (`scripts/gen-spots.mjs` → `public/spots/*.json`): bots play hands,
  and at the puzzle decision the Play coach prices every option against the real ranges and
  strategies of the players still in. A spot is kept when the best option beats the next one by
  max(0.8bb, 7% of the pot). Flop: heads-up against each of six bots, 40–200bb deep. Multiway:
  three or more players at a live table (all levels, all stack settings). All-ins bigger than 3×
  the pot are dropped from these spots (the bot models treat any overbet alike, see §8). Ratings are
  a heuristic from the EV gap and how counter-intuitive the answer is; they share your puzzle rating.

## 7d. Hand buckets

After the flop players think in kinds of hand, not combos (`src/engine/buckets.js`). The buckets
build on the live classes (the same `classify` the bots and the solver use), with two refinements:

| Bucket | What's in it |
|---|---|
| Monsters | sets, two pair, straights, flushes, boats that nothing obvious beats |
| Big but vulnerable | the same hands when the board can beat them: a flush possible (for sets, two pair, straights), a straight possible (for sets and two pair), a paired board (a full house beats two pair, trips, straights, flushes), or a non-nut flush on a four-flush board |
| Strong pairs | overpairs, top pair good kicker, weaker two pair |
| Medium pairs | top pair weak kicker, second pair |
| Weak pairs | third pair, small pocket pairs |
| Flush draws | four to a flush (with or without a straight draw) |
| Straight draws | open-enders |
| Air | gutshots, overcards, nothing |

A **plan by bucket** is your range (as a solid player has it on this line, or as a thinking bot
reads you) with the best play for each hand, summed per bucket: its share of your range, how its
hands split across the options, and the bucket's play. Heads-up it's exact (the range view prices
every combo); at a multiway table a few hands per bucket, spread across its strength, are priced
with the coach and stand in for the bucket.

Where it shows: the Play coach (heads-up and the live table) after each postflop decision ("You
have Medium pairs. With these here: Bet 75%", then every bucket, then every hand's grid); his
range by bucket in every coach card and puzzle; the plan in every puzzle's answer (the library's
own class plans for solver spots); the Buckets drill.

## 7b. Board textures and suit relabelling

`src/engine/texture.js` sorts flops the way a live player does:

- **Suits**: rainbow, two-tone or monotone.
- **Connectedness**:
  - *connected*: three ranks in one 5-card straight window, so straights are already possible;
  - *semi*: two ranks within 3 of each other, so there are plenty of draws (J-9-4);
  - *dry*: K-7-2, J-6-2.
- **Pairing**: unpaired, paired or trips.
- **High card**: A, K/Q, J–8, or 7 and lower.

Each puzzle also tags what the current board makes possible: flush draw or flush possible, straight
possible or 4 to a straight, paired.

Suits only matter through what they make possible, so **every puzzle is shown with its suits
randomly relabelled**. J♥5♥9♠ and J♦5♦9♠ are the same solved spot. Poker is exactly symmetric
under relabelling suits, so this is free variety that trains the texture, not the specific cards.

**Playbook** (`src/engine/playbook.js`, data from `scripts/build-playbook.mjs`) rolls every solved
spot up into rules. For a filter (villain, pot type, facing a bet or not, street, texture), it
averages each hand class's one-action answers, weighted by how much of your range that class is.
Actions are grouped as fold / check / call / bet small (< ½ pot) / bet big / raise / all-in. The
classes it shows where the exploit's usual action differs from the solver's are the adjustments
to remember.

## 8. Play: engine, bots, coach

Heads-up, button vs big blind, 100bb, blinds 0.5/1 with the small blind's 0.5 dead (the SB has
folded). Hands alternate seats.

**Engine** (`src/engine/hu/game.js`): BB option; min-raise = last full raise; a short all-in does not
reopen the betting; uncalled bets are returned. Menu: fold, check, call, bet 33% / 75%, raise 3×,
all-in; preflop opens of 2.5 / 3.5bb.

**Range-vs-range equity** (`equity.js`). For a board, a fixed set of runouts (every river on the
turn; every turn with a seeded sample of rivers on the flop; seeded boards preflop), and every
combo evaluated once per runout. The equity of *all 1,326 combos* against a weighted range is then
one sorted sweep per runout, with card removal done by per-card running totals:

    eq(i) = Σ_r Σ_{j ∩ i = ∅} w_j ([v_i > v_j] + ½[v_i = v_j])  /  Σ_r Σ_{j ∩ i = ∅} w_j

About 1ms per range on the turn, 5ms on the flop; exact on the turn and river (tested against
brute force).

**Bots** (`agents.js`), all behind one interface, `policyAll(agent, node)`: the strategy for every
combo at once.

- *Profile bots*, Whale, Station, Nit, Maniac, Reg: a style by hand class, bent by the same TOML
  profiles the solver uses (identical rule semantics, `bots.js`). Preflop by hand percentile.
- *Thinking bots*, Shark and Pro (`thinker.js`):
  1. A belief π over player types (reg, TAG, station, nit, maniac, whale, and "random").
  2. A joint posterior over (type, hand) from your actions this hand:
     w_t(h) ∝ π_t · Π P_t(action | h). Your range is Σ_t w_t(h).
  3. The EV of each option for every combo it could hold, one street ahead, with your responses
     predicted by the type mixture: call ρ·eq·(P+C) − C; bet x: F·P + (1−F)(ρ·eq_c·(P+x+y) − x);
     passive lines include your bets/raises after them and its best reply. ρ is equity
     realisation (1 on the river and when all-in).
  4. A quantal response, p(a) ∝ exp(EV_a / (τ·pot)): τ = 0.03 (Pro) is nearly pure.
  Deep all-ins are pruned (no 100bb preflop shoves, postflop shoves only up to ~2.5× the pot):
  without that the bots find shoves that only "work" against a model that folds too much.
  Facing an overbet or shove (≥ 1.5× the pot) a thinking bot always continues with at least the
  top MDF share of its own range (by equity), so any-two-cards shoves can't print just because
  its read says you're honest. Profile bots answer big preflop bets by size (a 25bb+ bet is
  treated like a 4-bet: even a station doesn't call 100bb with 72% of hands).
- *Every bot learns you*, like a chess bot of its rating. After each hand it updates π with a
  tempered likelihood, π_t ← π_t · L_t^rate (normalised), where the rate runs from 0.15 (Whale)
  to 0.5 (Pro), and 'random' is capped at 40% of the read. A profile bot then plays
  (1 − α)·its style + α·the thinking bot's exploit of its read, with α = α_max · min(1, hands/ramp):

  | Bot | rate | α_max | ramp (hands) |
  |---|---|---|---|
  | Whale | 0.15 | 0.20 | 300 |
  | Station | 0.20 | 0.25 | 250 |
  | Maniac | 0.20 | 0.30 | 200 |
  | Nit | 0.25 | 0.35 | 150 |
  | Reg | 0.35 | 0.50 | 100 |
  | Shark, Pro | 0.3, 0.5 | 1 (they are the exploit) | — |

  Reads persist between sessions (per bot, on the device).

**Measured** (duplicate matches): against the Pro, shoving every river loses about 22bb per hand and
calling down every street about 9bb per hand; the Pro reads a whale as a whale (93%), a maniac as a
maniac (79–97%) and a station as a station (86%) on its own. See §5 for the ladder.

**Reading his range** (`range.js`): w(h) ∝ Π P(his action | h, node), from the bot's own policy,
so the range the coach uses is the true posterior, not a guess.

**Coach** (`coach.js`): EV of each of your options against that range and strategy, one street
ahead (exact on the river; a re-raise is treated as a call). Each option also carries its fold
equity, your equity when called, and the price, which the "Why" panel turns into one-line reasons.

**Natural sizes**: the best option (the one others are graded against) is always a natural one.
An all-in of more than 2.5× the pot is never the benchmark, because the bots treat every overbet
alike (a 20×-pot shove gets the same calls as a 1.2× overbet), so its EV is a model artifact. You
can still shove; it grades as fine if it's worth as much.

**Stack depth**: heads-up at 40, 100 or 200bb. The table shows the SPR (effective stack ÷ pot at
the start of the street) from the flop on.

**Sessions** (`session.js`): coach after every decision (pauses on mistakes), after each hand, or
only in the review. Per hand: result, EV lost, and all-in luck (result minus equity-when-all-in ×
pot − what you put in), so a lucky shove shows up as luck, not skill. A decision loses ≥ 25% of the
pot or ≥ 10bb: a blunder.

## 8b. Watch and the live table

**Watch** (`src/engine/hu/watch.js`): two bots play heads-up with every card face up. Each decision
is explained from the bot's own numbers. A thinking bot shows its read of the other player, its
equity against the range it puts him on and against his actual cards, the fold equity it expects,
and the EV of each option. A profile bot shows its style, how often it takes each option with this
hand, and how far it has adjusted.

**Live table** (`src/engine/ring/`): you and 3–5 players, button moving every hand.
- *Stacks*: everyone 100bb, everyone 200bb, or a live mix: each player sits with his own buy-in
  (25% short, 25–45bb, the $50 stack at $1/$2; 45% 60–120bb; 30% deep, 150–300bb). You have 100bb.
  A short stack (≤35bb) facing a raise re-raises all-in instead of 3-betting small (≤15bb: shoves
  first in too). Facing a shove or a raise to 12bb+, the coach grades you by EV (price vs his
  shoving range), not the opening chart.
- *Engine* (`game.js`): 2–6 players, blinds 0.5/1, BB option, min-raise = last full raise, short
  all-ins don't reopen, side pots built from what each player put in (uncalled chips come back to
  their owner). Tested with thousands of random hands for chip conservation, plus side-pot and
  reopening cases.
- *Players* (`players.js`): each seat is a mix of styles drawn from a live $1/$2 pool (stations
  28%, nits 20%, regs 20%, whales 14%, sharks 12%, maniacs 6%; half of them blended with a second
  style), with a name. Preflop by hand percentile, situation (first in, limpers, facing an open, a
  3-bet, a 4-bet or a shove, sized by the bet) and position; postflop by hand class with the same
  profile rules as the heads-up bots, bluffing less and folding weak hands more multiway. The
  table learns you from your VPIP / PFR and your river showdowns: it steals more from a tight
  player and calls down a player who has shown bluffs, each at its own rate.
- *Difficulty*: Easy is all fish (whales, stations, nits, maniacs and blends); Medium adds one
  shark or pro and one reg; Hard has three strong players (mostly pros) and one reg. A player who
  leaves is replaced by one of the same kind, so the level holds. Strong players read you faster
  (their adjustment ramps up over ~30–60 hands instead of ~150–200) and further. Measured with
  a solid reg in your seat (`scripts/table-levels.mjs`, 8,000 hands per level): about +104bb/100
  on Easy, +46 on Medium, +20 on Hard.
- *Reading them*: VPIP / PFR per player like a HUD, or reveal their styles.
- *Coach* (`coach.js`): every opponent still in has a range read from his own strategy; equity
  against all of them (exact heads-up, Monte Carlo multiway); EV one street ahead, with each
  opponent's fold share taken in turn. Preflop is graded against The Course charts by position
  (first in, isolating limpers, facing an open), with these EVs sizing the mistake. A bet's
  responses stop at the end of the street (fixed: the first player on the next street used to be
  counted as calling the bet a second time, which overvalued betting in position).
- *At showdown*: one line per player who showed: value bet, bluff, or calling down, and (when
  styles are shown) the style that explains it.
- *Watch scoreboard*: the result updates at the end of each hand, with a hand-by-hand curve; the
  win rate (bb/100 ± a 95% interval) only shows after 25 hands (before that it swings by
  hundreds of bb/100 and means nothing).
- *Watch summary*: per-bot VPIP, PFR, c-bet, fold to a bet, share of river bets that are bluffs
  (every card is known, so every river bet counts, called or not), river calls that lose, and
  result with and without showdown, plus one sentence on how the winner is winning.

## 8c. Game review, leaks, and your live hands

**Hand history** (`src/engine/history.js`): every hand you play heads-up or at the live table is
stored on the device (the last 400, ~2KB each): seats, stacks, cards, the action log and your
graded decisions (`decisions[i].at` = the log index of the action it became).

**Game review** (Play → Review), modelled on chess.com's:
- *Session*: accuracy (chess-style: 100 for a best or good move, falling with the EV lost relative
  to the pot: 100·e^(−4·loss/pot) − 10), and each decision classed Best ★ / Good ✓ /
  Inaccuracy ?! (a mistake under 1bb and 10% of the pot) / Mistake ? / Blunder ??. Key moments:
  the worst decisions, each a "find a better move".
- *Replayer*: step through any hand move by move (arrows, or tap a move), the table rebuilt from
  the log. "Guess first" (your mistakes, every move, or off): before your move the answer is hidden
  and you pick first; then the coach's full analysis. Their cards stay hidden unless you ask (or
  they showed).
- *Leak report*: every non-best decision is classed by what you did against what was best:
  too tight / too loose / flatting instead of raising preflop; overfolding to bets, calling too
  much, calling when a raise wins; missed value, missed bluffs, betting too thin, bluffs that
  don't work; sizing. Each leak: how often, its cost in bb/100, the fix, and the worst example
  hands (which open in the replayer).

**Log a live hand** (`src/engine/livelog.js`): enter a hand you played at the casino, in dollars
(stakes $1/$2 to $5/$10): your seat, cards, stacks, the action as it happened ("folds to you" in
one tap) and the board as it came. Tag the players who played (Station, Whale, Nit, Maniac, Reg,
Pro, or Unknown: a typical $1/$2 mix). The hand is modelled 6-handed; each opponent's range is
read through his type, and each of your decisions is priced against those ranges with your real
bet sizes. The grades stay hidden until you finish. Villains' cards you never saw are
placeholders (never shown, never used). Logged hands go into Review ("Your live hands", one
session per day) and count in the leak report.

## 9. Learn

- **Course**: the Boot Camp's `COURSE` (5 modules, 415 steps), imported by
  `scripts/build-course.mjs` into `public/course.json` with the corrections in
  `src/content/errata.js` (AKQ bet size, Hawrilenko's aces vs a known bluffer, the semi-bluff
  shortcut, iso sizing in limp-heavy games, MDF as a benchmark). Concepts come in three depths:
  Feel, Formula, Proof.
- **Bet-size feel** (timed, 8 seconds): dollar amounts as they come at the table ("the pot is $95,
  he bets $55"); name the size bucket or the price to call.
- **Table maths** (`src/engine/drills.js`): endless generated questions with exact answers. The
  wrong options are the classic wrong formulas (α for pot odds, B/P for MDF), so a miss tells you
  which mistake you made. Outs and combos questions use real cards.
- **Buckets** (moved to Puzzles): your whole range by bucket, one action per bucket.
- **Preflop trainer and charts**, **formula sheet**, **exploit playbook**.

## 10. Roadmap

1. Profiles that also act on earlier streets in the solver library.
2. Bot responses that scale with bet size beyond "overbet" (so huge shoves get fewer calls).
3. Stronger thinking bots: two-street lookahead, and solver strategies as their baseline.
4. Straddles (optional).
5. RL track (for the science): a self-play agent on the heads-up engine, measured on the same
   ladder.

The Flask version and the Python CFR+ solver are in `archive/`.
