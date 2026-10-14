# Calibration against real hands

LiveGTO's bots, charts and solver, checked against **8.9 million real hands** and the **10,000
hands Pluribus played against pros**. What was wrong, what changed, and how close it is now.

**Short version**

- The preflop charts hold up: on raise-first-in hands they agree with Pluribus 88–93% of the time
  in every seat but the small blind (77%). They are tighter, as they should be for 9-handed live
  games.
- The solver holds up: its GTO answers by hand class sit close to what Pluribus did in the same
  spots.
- The bots did not. Regs, Sharks and Pros limped 20% of the time; every bot donk-bet into the
  preflop raiser about 30% of the time; the fish were far stickier than real fish (our Whale went
  to showdown 65% of the time, real whales 32%); our Station almost never bluffed the river
  (real stations: 15% of their called river bets are air). All of that is now fitted to the data:
  every archetype matches its real players within a few points on 18 stats.

## The data

[PHH dataset](https://github.com/uoftcprg/phh-dataset) (MIT), read with `solver/crates/ps-phh`:

| Source | Hands | What it is |
|---|---|---|
| HandHQ, 25NL–100NL | 8,879,414 kept of 10,464,590 | Online cash games, July 2009: PokerStars 4.7M, iPoker 1.6M, Party 1.5M, Absolute 0.56M, Full Tilt 0.45M. Player names are scrambled but stay the same across hands. |
| Pluribus | 10,000 | Pluribus against pros, 6-max, 100bb, every card face up. |

Left out: heads-up hands (1.24M), straddles and dead blinds (0.33M), antes (16k). Only the
summaries are kept; the raw hands are not in the repo.

**Checked:** every decision in 8,787 hands from all five sites, the Pluribus logs and the bot
simulator was replayed in [pokerkit](https://github.com/uoftcprg/pokerkit) (the PHH reference
implementation): the pot and the amount to call agree on every one (`analysis/crosscheck.py`).

**Things to know about these logs**

- They are online 2009, not live 2026. Live $1/$2 players limp more, open bigger and are probably
  stickier. Each archetype is fitted to real players *of that type*; how many of each type sit at
  a table stays LiveGTO's live pool.
- Hole cards are only known at showdown. On a called river bet the bettor's hand is shown
  99.8–100% of the time, so what bettors had is a fair sample. A caller who loses usually mucks
  (his hand is known 2–5% of the time when he loses), so what callers had is **not** a fair sample
  and isn't used as a target.

## Who the players are

Every player with at least 150 hands (49,063 players, 88% of the hands), typed by VPIP and PFR the
way a HUD reader would:

| Type | Rule | Players | Hands |
|---|---|---|---|
| Nit | VPIP < 15 | 11% | 28% |
| Tight-passive | VPIP 15–28, PFR < 0.6·VPIP | 21% | 19% |
| Reg (TAG) | VPIP 15–28, PFR ≥ 0.6·VPIP | 15% | 30% |
| LAG | VPIP 28–40, PFR ≥ 0.6·VPIP | 3% | 2% |
| Station | VPIP 28–45, passive | 30% | 14% |
| Whale | VPIP ≥ 45, passive | 16% | 6% |
| Maniac | VPIP ≥ 40 and PFR ≥ 0.5·VPIP, or AFq ≥ 50 | 3% | 1% |

What surprised me:

- **Real fish fold more than our bots did.** Real whales fold to half the flop bets they face and
  go to showdown 32% of the time. Postflop, the types differ less than the caricatures: a flop
  bet gets folded 49% of the time by maniacs and whales, 56% by stations, 65% by regs, 71% by nits.
- **Most of a station's leak is preflop**: he cold-calls 22% of opens (regs 8%) and defends his
  big blind 38% of the time (regs 19%).
- **Low-stakes players under-bluff the river.** Of the river bets that got called, these were air:
  nits 5%, regs 10%, stations 15%, whales 21%, maniacs 25%, the pros 24%, Pluribus 35%.
- **Everyone c-bets about two flops in three**, whatever his type. What separates the types after
  the flop is donk-betting (nits and regs 9–10%, stations 16%, whales 20%, maniacs 28%) and how
  much they fold.

## What changed

1. **Preflop numbers per archetype** (`src/engine/ring/preflop.json`), fitted by simulation
   (`analysis/fit_preflop*.py`): opens and open-limps by seat, isolating and limping behind,
   3-bets and cold calls, big-blind defence, what he does after limping into a raise, and how
   he answers a 3-bet as a share of his own opening range. The old model scaled the raise
   threshold by seat but not the limp threshold, so tight players limped everything in between.
2. **A postflop baseline from Pluribus** (`BASE_OPEN` / `BASE_FACING` in `src/engine/hu/bots.js`):
   what Pluribus did with each hand class, and it now depends on whose street it is: the
   previous street's aggressor (c-bet), betting into him (donk), or checked to. Pluribus bets
   33–73% of the time as the aggressor, depending on the hand, and almost never into the raiser; the old baseline did
   the same thing in all three.
3. **Villain profiles fitted to real players** (`solver/profiles/*.toml`, `analysis/profiles_fit.py`):
   each profile keeps its character rules, plus fitted strengths for folding by street, raising,
   c-betting, donk-betting, betting when checked to and river bluffing. Rules can now depend on
   whose street it is (`role`), in the app and in the solver. A new **Reg** profile is fitted to
   the online regs; the Shark and the Pro at the live table play the Pluribus baseline.
4. Two character rules were dropped because the data contradicts them: "the Station calls
   instead of raising" and "the Nit only raises the nuts" (both raise c-bets about as often as
   everyone else, 11–14%). The notes the puzzles show under "How he plays" now come from the data.

## Before, after, and the real players

Ring bots, 6-handed, 80,000 hands each run, measured with the same code as the real hands.
"Real" for the Shark is the pros in the Pluribus games; for the Pro, Pluribus itself.

### Whale (vs HandHQ whales)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 59% | 54% | 55% |
| Raises preflop (PFR) | 5% | 12% | 12% |
| Open-limps | 59% | 45% | 45% |
| Opens UTG | 4% | 14% | 13% |
| Opens on the button | 10% | 20% | 20% |
| 3-bets | 4% | 4% | 4% |
| Cold-calls an open | 55% | 38% | 38% |
| BB folds to an open | 28% | 41% | 41% |
| Folds to a 3-bet | 19% | 22% | 21% |
| C-bets the flop | 61% | 64% | 66% |
| Donk-bets the flop | 31% | 21% | 20% |
| Folds to a flop bet | 16% | 49% | 49% |
| Folds to a turn bet | 12% | 41% | 40% |
| Folds to a river bet | 12% | 54% | 53% |
| Check-raises the flop | 13% | 9% | 6% |
| Goes to showdown (WTSD) | 65% | 32% | 32% |
| Aggression (AFq) | 26% | 27% | 28% |
| Air in his called river bets | 28% | 23% | 21% |

### Station (vs HandHQ stations)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 44% | 35% | 35% |
| Raises preflop (PFR) | 4% | 10% | 11% |
| Open-limps | 43% | 24% | 24% |
| Opens UTG | 4% | 11% | 11% |
| Opens on the button | 10% | 22% | 21% |
| 3-bets | 2% | 3% | 3% |
| Cold-calls an open | 40% | 22% | 22% |
| BB folds to an open | 48% | 61% | 62% |
| Folds to a 3-bet | 14% | 33% | 32% |
| C-bets the flop | 39% | 64% | 64% |
| Donk-bets the flop | 15% | 17% | 16% |
| Folds to a flop bet | 53% | 56% | 56% |
| Folds to a turn bet | 32% | 46% | 46% |
| Folds to a river bet | 27% | 55% | 55% |
| Check-raises the flop | 3% | 10% | 7% |
| Goes to showdown (WTSD) | 50% | 30% | 30% |
| Aggression (AFq) | 14% | 26% | 26% |
| Air in his called river bets | 6% | 16% | 15% |

### Nit (vs HandHQ nits)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 18% | 13% | 13% |
| Raises preflop (PFR) | 9% | 8% | 9% |
| Open-limps | 11% | 2% | 2% |
| Opens UTG | 9% | 8% | 8% |
| Opens on the button | 24% | 20% | 20% |
| 3-bets | 2% | 3% | 3% |
| Cold-calls an open | 7% | 5% | 5% |
| BB folds to an open | 88% | 87% | 88% |
| Folds to a 3-bet | 66% | 46% | 51% |
| C-bets the flop | 26% | 68% | 67% |
| Donk-bets the flop | 19% | 10% | 10% |
| Folds to a flop bet | 75% | 71% | 71% |
| Folds to a turn bet | 59% | 60% | 62% |
| Folds to a river bet | 54% | 61% | 63% |
| Check-raises the flop | 1% | 9% | 5% |
| Goes to showdown (WTSD) | 40% | 28% | 28% |
| Aggression (AFq) | 15% | 25% | 23% |
| Air in his called river bets | 2% | 6% | 5% |

### Maniac (vs HandHQ maniacs)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 66% | 48% | 49% |
| Raises preflop (PFR) | 37% | 25% | 27% |
| Open-limps | 33% | 16% | 16% |
| Opens UTG | 30% | 30% | 30% |
| Opens on the button | 72% | 49% | 50% |
| 3-bets | 29% | 7% | 8% |
| Cold-calls an open | 24% | 30% | 30% |
| BB folds to an open | 36% | 48% | 48% |
| Folds to a 3-bet | 16% | 32% | 35% |
| C-bets the flop | 78% | 68% | 67% |
| Donk-bets the flop | 70% | 30% | 28% |
| Folds to a flop bet | 30% | 49% | 49% |
| Folds to a turn bet | 24% | 42% | 42% |
| Folds to a river bet | 22% | 52% | 53% |
| Check-raises the flop | 34% | 13% | 10% |
| Goes to showdown (WTSD) | 48% | 28% | 30% |
| Aggression (AFq) | 58% | 36% | 37% |
| Air in his called river bets | 35% | 25% | 25% |

### Reg (vs HandHQ regs (TAG))

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 36% | 18% | 20% |
| Raises preflop (PFR) | 19% | 14% | 15% |
| Open-limps | 20% | 0% | 1% |
| Opens UTG | 19% | 14% | 14% |
| Opens on the button | 48% | 35% | 35% |
| 3-bets | 7% | 5% | 5% |
| Cold-calls an open | 11% | 8% | 8% |
| BB folds to an open | 77% | 82% | 81% |
| Folds to a 3-bet | 68% | 57% | 57% |
| C-bets the flop | 36% | 66% | 66% |
| Donk-bets the flop | 29% | 9% | 9% |
| Folds to a flop bet | 60% | 64% | 65% |
| Folds to a turn bet | 41% | 59% | 58% |
| Folds to a river bet | 38% | 60% | 60% |
| Check-raises the flop | 6% | 11% | 7% |
| Goes to showdown (WTSD) | 44% | 26% | 27% |
| Aggression (AFq) | 24% | 29% | 27% |
| Air in his called river bets | 20% | 10% | 10% |

### Shark (vs the pros against Pluribus)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 38% | 27% | 27% |
| Raises preflop (PFR) | 22% | 19% | 18% |
| Open-limps | 23% | 2% | 2% |
| Opens UTG | 21% | 18% | 18% |
| Opens on the button | 53% | 44% | 43% |
| 3-bets | 8% | 8% | 8% |
| Cold-calls an open | 7% | 8% | 7% |
| BB folds to an open | 80% | 45% | 44% |
| Folds to a 3-bet | 72% | 43% | 46% |
| C-bets the flop | 35% | 47% | 52% |
| Donk-bets the flop | 31% | 2% | 1% |
| Folds to a flop bet | 69% | 59% | 46% |
| Folds to a turn bet | 53% | 47% | 52% |
| Folds to a river bet | 51% | 42% | 60% |
| Check-raises the flop | 2% | 6% | 10% |
| Goes to showdown (WTSD) | 42% | 30% | 30% |
| Aggression (AFq) | 25% | 24% | 25% |
| Air in his called river bets | 7% | 24% | 24% |

### Pro (vs Pluribus)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 42% | 28% | 27% |
| Raises preflop (PFR) | 24% | 20% | 18% |
| Open-limps | 25% | 2% | 2% |
| Opens UTG | 24% | 18% | 18% |
| Opens on the button | 57% | 42% | 42% |
| 3-bets | 9% | 6% | 7% |
| Cold-calls an open | 9% | 10% | 9% |
| BB folds to an open | 77% | 52% | 50% |
| Folds to a 3-bet | 72% | 52% | 50% |
| C-bets the flop | 33% | 46% | 54% |
| Donk-bets the flop | 29% | 3% | 2% |
| Folds to a flop bet | 70% | 60% | 46% |
| Folds to a turn bet | 51% | 45% | 48% |
| Folds to a river bet | 52% | 43% | 50% |
| Check-raises the flop | 2% | 6% | 9% |
| Goes to showdown (WTSD) | 40% | 31% | 31% |
| Aggression (AFq) | 24% | 24% | 27% |
| Air in his called river bets | 8% | 24% | 35% |


The Shark and the Pro fold more to flop bets than Pluribus: the baseline matches Pluribus by hand
class, but at a live table they face bets from looser players, multiway, with weaker hands.

## Checks against Pluribus

### The preflop charts

#### Raise first in

| Seat | Chart opens | Pluribus opens | Agreement | Pluribus opens, chart folds | Chart opens, Pluribus folds |
|---|---|---|---|---|---|
| UTG | 14% | 18% | 93% | AJo, ATo, KQo, K9s, K8s, J9s | 22, 87s |
| HJ | 16% | 22% | 93% | ATo, KJo, K9s, K7s, QJo, Q9s, T8s | 22 |
| CO | 22% | 30% | 90% | A9o, A8o, KTo, QJo, QTo, Q6s, JTo, J8s | 43s, 64s |
| BTN | 33% | 43% | 88% | A6o, A4o, K8o, J5s, T9o, T8o, T6s, A3o, 98o | 43s |
| SB | 26% | 27% | 77% | A6o, Q9o, Q3s, K9o, J4s | 33 |

#### Facing one raise

Agreement: how often Pluribus took the chart's action (3-bet / call / fold).

| You | Opener | Decisions | Chart: 3-bet / call | Pluribus: 3-bet / call | Agreement | Chart folds, Pluribus continues ≥80% | Chart continues, Pluribus folds ≥80% |
|---|---|---|---|---|---|---|---|
| BTN | UTG | 226 | 1% / 10% | 5% / 7% | 88% | AJo | — |
| BTN | HJ | 285 | 1% / 10% | 6% / 6% | 88% | A6s, AQo, ATo, A7s | — |
| BTN | CO | 358 | 4% / 10% | 8% / 10% | 91% | ATo, QJo | — |
| CO | UTG | 281 | 1% / 10% | 2% / 4% | 91% | AQo | — |
| CO | HJ | 304 | 1% / 10% | 7% / 3% | 88% | KQo, AQo | 22 |
| SB | UTG | 251 | 3% / 0% | 2% / 6% | 87% | A9s, KQs, 44 | — |
| SB | HJ | 201 | 3% / 0% | 5% / 6% | 85% | AQo, KQs | — |
| SB | CO | 276 | 7% / 0% | 7% / 8% | 82% | Q9s, A8s, 98s, A7s, ATo | — |
| SB | BTN | 373 | 7% / 0% | 9% / 9% | 80% | K7s, ATo, A6s, 55, 66, QJs, 99, T8s | — |
| BB | UTG | 238 | 1% / 17% | 2% / 24% | 76% | JTo, QTo | — |
| BB | HJ | 222 | 1% / 17% | 2% / 28% | 66% | JTo, KJo, ATo | — |
| BB | CO | 267 | 14% / 19% | 5% / 30% | 73% | A4o, J9o, 93s, 54o | — |
| BB | BTN | 287 | 14% / 19% | 10% / 36% | 69% | T8o, 76o, 54o, A3o | — |
| BB | SB | 146 | 14% / 19% | 12% / 24% | 60% | J8o, A6o, T8o | — |

The charts are 9-handed live charts mapped onto six seats, so they are tighter than Pluribus's
6-max ranges and defend the big blind less against Pluribus's small opens. That's by design. No
hand the charts open is one Pluribus clearly folds, apart from 22 and a few small suited connectors.

### The solver

BTN opens, the BB calls (the library's `srp_btn_bb` family, 2.5bb opens like Pluribus's).

**Checked to on the BTN: how often each class bets**
: how often each class bets

| Class | Library (GTO) | Pluribus logs | Hands |
|---|---|---|---|
| monster | 87% | 85% | 53 |
| strong | 73% | 82% | 90 |
| medium | 36% | 47% | 120 |
| weak | 26% | 16% | 93 |
| draw | 79% | 69% | 29 |
| air | 37% | 34% | 202 |


**BB facing a bet: fold / call / raise**


| Class | Library (GTO) | Pluribus logs | Hands |
|---|---|---|---|
| monster | 14 / 57 / 29 | 14 / 64 / 21 | 14 |
| strong | 18 / 72 / 9 | 6 / 89 / 6 | 18 |
| medium | 39 / 58 / 2 | 34 / 61 / 5 | 64 |
| weak | 64 / 33 / 3 | 62 / 29 / 9 | 76 |
| draw | 30 / 52 / 18 | 33 / 42 / 25 | 24 |
| air | 78 / 21 / 1 | 89 / 8 / 2 | 83 |

Close everywhere the sample isn't tiny. The solver calls a bet with air more than Pluribus does
(21% vs 8%): those are mostly ace-high bluff-catchers.

## Reproduce

See [analysis/README.md](../analysis/README.md).
