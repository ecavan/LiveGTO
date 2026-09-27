# LiveGTO — design

LiveGTO is a free, personal "chess.com for live poker": puzzles, rated bots and hand review for
live $1/$2–$2/$5 NLHE. The goal is to beat $2/$5 with confidence and one day play $5/$10.

> GTO is the baseline. Exploitation is the adaptation. Every answer is one action.

## 1. What it is

| Chess habit | LiveGTO |
|---|---|
| Engine | `postflop-solver` (Rust, Discounted CFR, node locking), in `solver/` |
| Puzzles (rated) | A real spot, your real cards, one correct action, vs GTO or vs a villain type. **Built.** |
| Bots rated 250 → 2200 | Bot = GTO strategy bent by a **profile** at **intensity** λ. Next. |
| Game review ("you played like an 1100") | EV lost per decision, vs GTO and vs the best exploit of that bot. Next. |
| Theory | The Boot Camp course (5 modules, 239 questions) → in-app lessons. Later. |

It's phone-first and offline: a PWA on Vercel, with the solver's output shipped as a static
library of JSON. Solving happens offline with `solver/`, on your Mac or anywhere with Rust.

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

Poker isn't win/lose and it isn't transitive (two fish leak in different ways), so everything is
anchored to one yardstick: the GTO bot. Let L be a player's loss rate against the GTO bot, in
bb/100:

```
R = 2200 − 400 · log₂(1 + L / L₀)
```

Every 400 points roughly doubles how fast you bleed. With L₀ = 5 bb/100:

| L (bb/100 lost to GTO) | 0 | 2 | 5 | 15 | 35 | 75 | 155 |
|---|---|---|---|---|---|---|---|
| R | 2200 | ~2000 | 1800 | 1400 | 1000 | 600 | 200 |

So a 1000 bot bleeds about 17× faster than a 2000 bot.

- **Bots**: R(profile, λ) is measured by simulating hands against the GTO bot, not assumed. The
  ladder picks λ per profile to hit target ratings (Station 600, Station 1000, Nit 1400, …).
- **Your review rating**: the same formula, using your EV loss per decision (×100 hands) against
  the GTO reference. A second number shows loss against the *exploit* reference, because beating
  a 600 whale means playing unlike GTO, and the review should reward that.
- L₀ is set once from calibration so the bands feel right. It's a display scale, not physics.

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
- Flop puzzles aren't in the library yet.
- The flop tree used for turn ranges is coarse: one 33% c-bet, 3× raises, one turn size and one
  river size plus all-in. It fits in about 1 GB; your Mac can afford a richer one.

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

## 8. Roadmap

1. **Puzzles** (done): library, rating, EV grading, range vs range, real cards. Five pot types,
   board-texture filters, suit relabelling. Puzzles default to exploitative villains; GTO is an
   opt-in baseline filter.
1b. **Playbook** (done): texture × villain × spot rules.
2. **Play and Simulate** (done). Heads-up BTN vs BB, 100bb, SB folded (0.5 dead).
   - Engine `src/engine/hu/game.js`: BB option, min-raise = last full raise, a short all-in does
     not reopen, uncalled bets returned. All-ins are logged as all-ins.
   - Bots `src/engine/hu/bots.js`: a Reg baseline plus the solver profiles (same rule semantics as
     the Rust side, exported by `scripts/export-profiles.mjs`) acting on hand classes. Preflop by
     percentile. `scripts/bot-league.mjs` plays them against each other; the Reg beats all four.
   - Range reading `range.js`: exact Bayesian posterior over the bot's own policy.
   - Coach `coach.js`: EV of each option against that range, one street ahead (exact on the
     river, a bot raise treated as a call). Preflop: the Reg chart ("check", never "fold", when
     checking is free) plus the steal maths, with the bot's fold share taken over the range he
     has shown so far (a limper's range, not all hands) and card removal.
   - Play grades every decision; Simulate plays 25–200 hands and reviews them: EV given up,
     a rating `2200 − 400·log2(1 + L/5)` from bb/100 lost, the biggest mistakes, past sessions.
3. **Preflop** (done): `ranges.js` holds The Course live charts: raise-or-fold, 3-bet vs strong
   and loose opens, blind defense.
4. **Flop puzzles**, **multiway pots** (most live limped pots are multiway; the solver is heads-up
   only), and profiles that also act on earlier streets.
5. **Lessons**: import the Boot Camp `COURSE`, applying the corrections in `docs/THEORY.md`.
6. **RL track** (for the science): self-play agent on the heads-up engine, measured on the same
   ladder.

The old strategy layer (`data/strategies.json`, `src/engine/abstraction.js`, `postflop.js`) is
kept only until the Play/Simulate rebuild. The audit found stale solver data, a CFR that
mis-weights regrets, and grading by frequency. The Python solver and its write-up are in
`archive/python-solver/`.
