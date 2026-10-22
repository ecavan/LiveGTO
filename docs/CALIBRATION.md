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
  every archetype matches its real players within a few points on 20 stats.
- **2026, not 2009.** The fish keep their real numbers: recreational players still limp and call
  like they did. The regulars have changed most since solvers (wider 3-bets, no limping, lighter
  c-bets), so the **Reg** sits halfway between the 2009 regs and the 2019 pros who played
  Pluribus; the Shark and the Pro are already from 2019. See *A 2026 Reg* below.

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
| Tight-passive (the **Passive**) | VPIP 15–28, PFR < 0.6·VPIP | 21% | 19% |
| Reg (TAG) | VPIP 15–28, PFR ≥ 0.6·VPIP | 15% | 30% |
| LAG | VPIP 28–40, PFR ≥ 0.6·VPIP | 3% | 2% |
| Station | VPIP 28–45, passive, WTSD ≥ 33% | 10% | 4% |
| Loose-passive (not sticky) | VPIP 28–45, passive, WTSD < 33% | 20% | 10% |
| Whale | VPIP ≥ 45, passive | 16% | 6% |
| Maniac | VPIP ≥ 40 and PFR ≥ 0.5·VPIP, or AFq ≥ 50 | 3% | 1% |

A **Station** is the sticky one: loose, passive *and* going to showdown at least a third of the
time he sees a flop, the way a HUD reader would call someone a station. Typed by VPIP alone,
two-thirds of the loose-passive players weren't sticky at all, and the exploits against that
"station" came out wrong (bluff him, raise him).

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
   each profile keeps its character rules, plus fitted strengths for folding to a c-bet, to other
   flop bets and to turn and river bets, raising, c-betting, donk-betting, betting when checked
   to and river bluffing. Rules can depend on whose street it is (`role`), in the app and in the
   solver: not facing a bet `aggr` / `donk` / `free`; facing one `vs_cbet` (the c-bet), `vs_bet`
   (any other first bet) or `vs_raise`. The folding knobs only touch first bets, like the HUD
   stats they are fitted to; facing a raise stays the baseline (an earlier fit scaled folding to
   raises too, which made raise-bluffing a Nit on the river look right). New profiles: **Reg**,
   **Passive** (tight-passive), and calibration-only **Shark** and **Pro**, fitted to the pros
   and to Pluribus (on the plain baseline they folded to flop bets 60% of the time, against 46%).
4. Two character rules were dropped because the data contradicts them: "the Station calls
   instead of raising" and "the Nit only raises the nuts" (both raise c-bets about as often as
   everyone else, 11–14%). The notes the puzzles show under "How he plays" now come from the data.

## A 2026 Reg

The HandHQ hands are from July 2009. Recreational players play much as they did then: live
$1/$2 is still loose, passive and limp-heavy. The regulars are what changed: since solvers they
3-bet wider, almost never limp, and bet more polarized (small or big, little in between)
([PokerListings](https://www.pokerlistings.com/news/5-drastic-ways-poker-strategy-has-changed-since-2010),
[Beasts of Poker](https://beastsofpoker.com/how-modern-poker-strategy-has-changed-in-the-last-five-years/)).
Neither source has numbers, so nothing is invented: the Reg is fitted to targets halfway between
the 2009 regs and the pros of the 2019 Pluribus games, stat by stat (`analysis/modern.py`). Every
number sits between two real populations. The fish, the Shark and the Pro are unchanged.

| Stat | 2009 regs | 2019 pros | The Reg (target) |
|---|---|---|---|
| VPIP / PFR | 20 / 15 | 27 / 18 | 23 / 17 |
| 3-bet | 5% | 8% | 6% |
| Folds to a 3-bet | 57% | 46% | 52% |
| C-bets the flop | 66% | 52% | 59% |
| Folds to a flop c-bet | 54% | 46% | 50% |
| Check-raises the flop | 7% | 10% | 9% |
| Air in his called river bets | 10% | 24% | 17% |

## Before, after, and the real players

Ring bots, 6-handed, 40,000 hands, measured with the same code as the real hands. "Before" is
the previous calibration (its Station was typed by VPIP alone and its Reg was the 2009 reg).
"Real" for the Shark is the pros in the Pluribus games; for the Pro, Pluribus itself.

### Whale (vs HandHQ whales)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 54% | 55% | 55% |
| Raises preflop (PFR) | 12% | 12% | 12% |
| Open-limps | 45% | 45% | 45% |
| Opens UTG | 14% | 14% | 13% |
| Opens on the button | 20% | 22% | 20% |
| 3-bets | 4% | 4% | 4% |
| Cold-calls an open | 38% | 38% | 38% |
| BB folds to an open | 41% | 42% | 41% |
| Folds to a 3-bet | 22% | 18% | 21% |
| C-bets the flop | 64% | 69% | 66% |
| Donk-bets the flop | 21% | 19% | 20% |
| Folds to a flop c-bet | 48% | 50% | 50% |
| Folds to another flop bet | 51% | 48% | 49% |
| Folds to a flop bet | 49% | 49% | 49% |
| Folds to a turn bet | 41% | 40% | 40% |
| Folds to a river bet | 54% | 54% | 53% |
| Check-raises the flop | 9% | 8% | 6% |
| Goes to showdown (WTSD) | 32% | 32% | 32% |
| Aggression (AFq) | 27% | 28% | 28% |
| Air in his called river bets | 23% | 22% | 21% |

### Station (vs HandHQ stations)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 35% | 35% | 36% |
| Raises preflop (PFR) | 10% | 10% | 10% |
| Open-limps | 24% | 25% | 26% |
| Opens UTG | 11% | 11% | 11% |
| Opens on the button | 22% | 19% | 18% |
| 3-bets | 3% | 3% | 3% |
| Cold-calls an open | 22% | 23% | 22% |
| BB folds to an open | 61% | 61% | 61% |
| Folds to a 3-bet | 33% | 23% | 26% |
| C-bets the flop | 64% | 61% | 60% |
| Donk-bets the flop | 17% | 14% | 15% |
| Folds to a flop c-bet | 55% | 48% | 48% |
| Folds to another flop bet | 56% | 54% | 53% |
| Folds to a flop bet | 56% | 51% | 51% |
| Folds to a turn bet | 46% | 40% | 40% |
| Folds to a river bet | 55% | 50% | 50% |
| Check-raises the flop | 10% | 7% | 7% |
| Goes to showdown (WTSD) | 30% | 34% | 37% |
| Aggression (AFq) | 26% | 22% | 23% |
| Air in his called river bets | 16% | 13% | 14% |

### Passive (vs HandHQ tight-passive players)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | — | 22% | 22% |
| Raises preflop (PFR) | — | 8% | 9% |
| Open-limps | — | 12% | 12% |
| Opens UTG | — | 9% | 9% |
| Opens on the button | — | 20% | 20% |
| 3-bets | — | 3% | 3% |
| Cold-calls an open | — | 14% | 13% |
| BB folds to an open | — | 77% | 76% |
| Folds to a 3-bet | — | 41% | 40% |
| C-bets the flop | — | 63% | 64% |
| Donk-bets the flop | — | 12% | 12% |
| Folds to a flop c-bet | — | 53% | 55% |
| Folds to another flop bet | — | 67% | 66% |
| Folds to a flop bet | — | 61% | 62% |
| Folds to a turn bet | — | 49% | 52% |
| Folds to a river bet | — | 56% | 58% |
| Check-raises the flop | — | 10% | 7% |
| Goes to showdown (WTSD) | — | 30% | 29% |
| Aggression (AFq) | — | 24% | 24% |
| Air in his called river bets | — | 11% | 10% |

### Nit (vs HandHQ nits)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 13% | 12% | 13% |
| Raises preflop (PFR) | 8% | 8% | 9% |
| Open-limps | 2% | 2% | 2% |
| Opens UTG | 8% | 8% | 8% |
| Opens on the button | 20% | 21% | 20% |
| 3-bets | 3% | 4% | 3% |
| Cold-calls an open | 5% | 5% | 5% |
| BB folds to an open | 87% | 87% | 88% |
| Folds to a 3-bet | 46% | 51% | 51% |
| C-bets the flop | 68% | 69% | 67% |
| Donk-bets the flop | 10% | 12% | 10% |
| Folds to a flop c-bet | 68% | 59% | 59% |
| Folds to another flop bet | 72% | 73% | 76% |
| Folds to a flop bet | 71% | 68% | 71% |
| Folds to a turn bet | 60% | 65% | 62% |
| Folds to a river bet | 61% | 58% | 63% |
| Check-raises the flop | 9% | 7% | 5% |
| Goes to showdown (WTSD) | 28% | 27% | 28% |
| Aggression (AFq) | 25% | 23% | 23% |
| Air in his called river bets | 6% | 8% | 5% |

### Maniac (vs HandHQ maniacs)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 48% | 48% | 49% |
| Raises preflop (PFR) | 25% | 24% | 27% |
| Open-limps | 16% | 16% | 16% |
| Opens UTG | 30% | 29% | 30% |
| Opens on the button | 49% | 48% | 50% |
| 3-bets | 7% | 7% | 8% |
| Cold-calls an open | 30% | 30% | 30% |
| BB folds to an open | 48% | 48% | 48% |
| Folds to a 3-bet | 32% | 34% | 35% |
| C-bets the flop | 68% | 69% | 67% |
| Donk-bets the flop | 30% | 31% | 28% |
| Folds to a flop c-bet | 51% | 46% | 48% |
| Folds to another flop bet | 47% | 53% | 51% |
| Folds to a flop bet | 49% | 50% | 49% |
| Folds to a turn bet | 42% | 40% | 42% |
| Folds to a river bet | 52% | 51% | 53% |
| Check-raises the flop | 13% | 12% | 10% |
| Goes to showdown (WTSD) | 28% | 28% | 30% |
| Aggression (AFq) | 36% | 36% | 37% |
| Air in his called river bets | 25% | 22% | 25% |

### Reg (vs halfway between the 2009 HandHQ regs and the 2019 pros against Pluribus)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 18% | 22% | 23% |
| Raises preflop (PFR) | 14% | 16% | 17% |
| Open-limps | 0% | 1% | 1% |
| Opens UTG | 14% | 16% | 16% |
| Opens on the button | 35% | 38% | 39% |
| 3-bets | 5% | 6% | 6% |
| Cold-calls an open | 8% | 9% | 8% |
| BB folds to an open | 82% | 62% | 63% |
| Folds to a 3-bet | 57% | 54% | 52% |
| C-bets the flop | 66% | 61% | 59% |
| Donk-bets the flop | 9% | 6% | 5% |
| Folds to a flop c-bet | 63% | 48% | 50% |
| Folds to another flop bet | 65% | 61% | 59% |
| Folds to a flop bet | 64% | 55% | 56% |
| Folds to a turn bet | 59% | 56% | 55% |
| Folds to a river bet | 60% | 61% | 60% |
| Check-raises the flop | 11% | 8% | 9% |
| Goes to showdown (WTSD) | 26% | 29% | 29% |
| Aggression (AFq) | 29% | 27% | 26% |
| Air in his called river bets | 10% | 20% | 17% |

### Shark (vs the pros against Pluribus)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 27% | 26% | 27% |
| Raises preflop (PFR) | 19% | 18% | 18% |
| Open-limps | 2% | 2% | 2% |
| Opens UTG | 18% | 18% | 18% |
| Opens on the button | 44% | 43% | 43% |
| 3-bets | 8% | 8% | 8% |
| Cold-calls an open | 8% | 7% | 7% |
| BB folds to an open | 45% | 44% | 44% |
| Folds to a 3-bet | 43% | 42% | 46% |
| C-bets the flop | 47% | 52% | 52% |
| Donk-bets the flop | 2% | 2% | 1% |
| Folds to a flop c-bet | 59% | 47% | 46% |
| Folds to another flop bet | 60% | 44% | 48% |
| Folds to a flop bet | 59% | 46% | 46% |
| Folds to a turn bet | 47% | 50% | 52% |
| Folds to a river bet | 42% | 60% | 60% |
| Check-raises the flop | 6% | 9% | 10% |
| Goes to showdown (WTSD) | 30% | 31% | 30% |
| Aggression (AFq) | 24% | 24% | 25% |
| Air in his called river bets | 24% | 20% | 24% |

### Pro (vs Pluribus)

| Stat | Before | After | Real |
|---|---|---|---|
| Plays (VPIP) | 28% | 28% | 27% |
| Raises preflop (PFR) | 20% | 20% | 18% |
| Open-limps | 2% | 2% | 2% |
| Opens UTG | 18% | 18% | 18% |
| Opens on the button | 42% | 42% | 42% |
| 3-bets | 6% | 7% | 7% |
| Cold-calls an open | 10% | 9% | 9% |
| BB folds to an open | 52% | 52% | 50% |
| Folds to a 3-bet | 52% | 47% | 50% |
| C-bets the flop | 46% | 54% | 54% |
| Donk-bets the flop | 3% | 1% | 2% |
| Folds to a flop c-bet | 60% | 41% | 45% |
| Folds to another flop bet | 59% | 48% | 47% |
| Folds to a flop bet | 60% | 44% | 46% |
| Folds to a turn bet | 45% | 47% | 48% |
| Folds to a river bet | 43% | 48% | 50% |
| Check-raises the flop | 6% | 9% | 9% |
| Goes to showdown (WTSD) | 31% | 31% | 31% |
| Aggression (AFq) | 24% | 27% | 27% |
| Air in his called river bets | 24% | 38% | 35% |

The Shark and the Pro fold to flop bets like the pros now (46% and 44%, against 61% and 60% on
the plain baseline): the baseline matches Pluribus by hand class, but at a live table they face
bets from looser players, multiway, with weaker hands, so they got their own fitted knobs.

## Heads-up ratings

The heads-up bots share the postflop baseline and profiles, so the Elo ladder was played again
(`scripts/ladder.mjs`: the Pro against each bot, 6,000 duplicate hands; ±45–90bb/100 at 95%):

| Bot | Before | After |
|---|---|---|
| Whale | 860 | 1100 |
| Maniac | 920 | 1410 |
| Station | 1380 | 1490 |
| Nit | 1560 | 1550 |
| Reg | 1690 | 1600 |
| Shark | 1660 | 1780 |
| Pro | 2000 | 2000 |

The fish are less wild than they were, so they lose less. The heads-up Reg keeps the Pluribus
baseline: the fitted Reg profile is a 6-max online regular, who folds far too much heads-up (the
Pro beat him by about 110bb/100). He plays at the live table, where he belongs.

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

BTN opens, the BB calls (the library's `srp_btn_bb` family, 2.5bb opens like Pluribus's). The
puzzle library was rebuilt with the fitted profiles; its GTO answers don't depend on them and
came out the same.

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
