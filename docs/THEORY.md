# Theory conventions

The formulas the app uses, what they mean, and where the sources disagree. The full audit, with
page references for every claim, is in [theory-audit.md](theory-audit.md).

Notation: **P** = pot before the bet, **B** = bet, **s = B/P**, **C** = amount to call.
Code: `src/engine/potmath.js`, tested in `test/puzzles.test.js`.

| Quantity | Formula | Plain English | Pot-size bet |
|---|---|---|---|
| Required equity | C / (P + B + C) = s/(1+2s) | Your share of the final pot has to cover your call | 33.3% |
| α (bluff break-even) | B / (P + B) = s/(1+s) | How often a pure bluff must work | 50% |
| MDF | P / (P + B) = 1/(1+s) | Defend this often with hands that beat a bluff | 50% |
| Bluff share of a polar bet | B / (P + 2B) = s/(1+2s) | Enough bluffs to make a bluff-catcher indifferent | 33.3% (2 value : 1 bluff) |
| Geometric size | ((1 + 2·S/P)^(1/N) − 1)/2 | Same pot fraction every street to get all-in by the river | SPR 13 over 3 streets → pot |
| Outs | 1 − (47−o)(46−o)/(47·46) | Exact chance to hit over two cards; the rule of 4 overstates big draws | 15 outs → 54.1%, not 60% |

## Conventions the app follows

- **Grade by EV, never by frequency.** A hand that mixes at equilibrium has equal EV for its actions,
  so any of them is correct. Against a node-locked opponent, the best response is pure.
- **MDF is over the hands that beat a bluff** (Mathematics of Poker p.119), not the whole range (Janda,
  Acevedo). It's shown as a guide, never used as a grading rule, because:
  - before the river, bluffs have equity (Acevedo p.603);
  - live players under-bluff (The Course, Skill #2), and MDF-style calling is too loose against
    them (the Malmuth/Sklansky note in Janda).
- **Separate names for separate things**: `alpha`, `mdf`, `bluffShare`, `bluffsPerValue`.
- **Hand classes are relative to the board and the line.** On the river "draw" becomes "air".
- Exact numbers are computed, never copied from rounded tables (e.g. Gaines' Table 5).

## Corrections to the older material

1. **Medium article, polar river game.** The bluff share of bets is B/(P+2B), not B/(P+B). The article
   credits the caller with P instead of P+B, so its "f + α = 1" doesn't hold. The lessons stand.
2. **Article, Kuhn poker.** The a = ⅓ solution is one member of a family: OOP bets QQ a, AA 3a, and
   calls KK a + ⅓ (tested: T3).
3. **Boot Camp v2 "MDF/α = p/(p+1)"** conflates two quantities. In limit units, MDF = P/(P+1) and
   α = 1/(P+1).
4. **Boot Camp v2 AKQ "call aces + ⅓ of kings"** holds only for a half-pot bet. In general K calls
   (1−s)/(1+s), and never for s ≥ 1.
5. **Boot Camp v2 "Hawrilenko's AA fold is not exploited by a 90% bluffer".** True only in the
   unexploitable sense. Against a locked 90% bluffer, folding AA is a large EV loss.
6. **"1.5× semi-bluff rule"** is an approximation that's good near pot-size bets. The exact break-even
   fold rate is (R − E·P_final) / (R − E·P_final + P).
7. **Set-mining** needs about 15× the call in effective stacks (Gaines), not the naive 7.5:1.
8. **Isolating limpers**: The Course raises to $15–20 over multiple limpers at $1/$2, not "3–4bb + 1bb
   per limper".
9. Typos in the sources: Acevedo's $83.5 should be $83.33; the MoP PDF text's "0.114" should be 0.414.

## Where the books disagree (the app says so rather than picking silently)

- **C-bets on K-high dry flops**: solvers bet them a lot. The Course prefers low dry boards against
  $2/$5 pools. That's a population exploit, not GTO.
- **Slowplaying**: The Course says don't at $1/$2; Janda says sometimes, against good players.
- **Size tells**: The Course says don't worry about them at $1/$2; Negreanu and Acevedo say never size by
  strength. (The Whale profile has a size tell on purpose.)
- **Rake**: The Course ignores it in-hand; Boot Camp v2 teaches it as its own concept.
