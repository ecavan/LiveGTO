# LiveGTO — Poker Theory Source Audit

Purpose: pin down the math, toy-game unit tests, exploit claims, preflop baselines and vocabulary that the LiveGTO trainer (DCFR baseline → node-locked profiles → one pure action per hand, graded by EV loss in bb) must agree with. Everything below comes from the files in `~/…/poker/`. Every toy-game number was also re-derived with an independent CFR+ script (`scratchpad/toycfr.py`, `zo.py`, `ladder.py`, `nlakq.py`), so the closed forms have been checked both analytically and numerically.

## 0. Sources, page conventions, extraction caveats

| Key | Source | How it's cited |
|---|---|---|
| **MoP** | Chen & Ankenman, *The Mathematics of Poker* | PDF page = printed page |
| **Course** | Ed Miller, *The Course* | printed page (= PDF page + 2) |
| **Gaines** | Owen Gaines, *Poker Math That Matters* | printed page (= PDF page − 11) |
| **Brokos** | Andrew Brokos, *Play Optimal Poker* (pdfcoffee copy) | chapter/section (the copy has no page numbers) |
| **Acevedo** | Michael Acevedo, *Modern Poker Theory* | PDF page. The text has no printed page numbers, and **its equations are images**, so the extracted text omits them. The formulas attributed to Acevedo here were rebuilt from his prose and worked numbers. |
| **Janda** | Matthew Janda, *Applications of No-Limit Hold 'em* (epub) | section title (the epub has no page numbers) |
| **Sklansky** | *The Theory of Poker* | printed page |
| **Negreanu** | *Power Hold'em Strategy*. The PDF is image-only and is **just the "Small Ball" chapter**; I OCR'd it with tesseract. | book page ≈ PDF page + 287. The chapter is tournament-oriented. |
| **SS** | *Super System*. The PDF is an abridged NLHE chapter (116 pp). | PDF page |
| **MIT Ln** | MIT 15.S50 (2015) lecture transcripts | lecture number |
| **Article** | `ecavan-mathematics-behind-GTO-poker.md` (Elijah's own) | — |

Notation used throughout: **P** = pot before the bet, **B** = bet, **s = B/P**, **C** = amount to call, **S** = effective stack behind, **E** = equity, **v** = share of the polar player's range that is value (nuts).

---

## 1. Core formulas the trainer must get exactly right

### 1.1 Pot odds / required equity (caller)
- **E_req = C / (P + B + C)**. Facing a bet with C = B, this becomes **s/(1+2s)**. Odds form: (P+B):C.
- Meaning: your share of the final pot has to cover your call.
- Sources: MoP ch.4 p.51 ("x > 3/26"); Gaines p.59–61 (`x/(x+y)`, Table 5); Janda "Calculating Pot Odds" ($30 into $50 → 27.3%); Acevedo p.37 (pot $100, all-in $100 → 33.3%); MIT L3 (call ÷ pot after the call).
- Reference values: ¼-pot bet → 16.7%, ⅓ → 20%, ½ → 25%, ⅔ → 28.6%, ¾ → 30%, pot → 33.3%, 1.5× → 37.5%, 2× → 40%. Gaines Table 5 rounds these (⅔ → "28%", ¼ → "16%"), so the app should compute them, not copy the table.

### 1.2 Bluff break-even fold frequency (α, "alpha")
- **α = B/(P+B) = s/(1+s)**.
- Meaning: a 0%-equity bluff breaks even when it succeeds α of the time.
- Sources: MoP eq. 11.3 p.112 (NL form; the limit form is α = 1/(P+1) with P measured in bets); Gaines p.93 and Table 8 p.94; Acevedo p.109 ("b/(b+p)"); Janda "Calculating Pot Odds" ($30 bluff into $50 → 37.5%); MIT L3/L8.
- Reference values: ½-pot → 33.3%, ¾ → 42.9%, pot → 50%, 2× → 66.7%. A pot-size **raise** needs 67% folds (Gaines Table 8).

### 1.3 MDF (minimum defense frequency)
- **MDF = 1 − α = P/(P+B) = 1/(1+s)**.
- Meaning: defend (call or raise) this often so that 0-equity bluffs don't profit automatically.
- Sources: MoP p.112 (X calls 1−α); Acevedo p.109; Brokos ch.2 "Optimal Calling Frequency" (table: ¼ → 4/5 … pot → 1/2 … 10× → 1/11); Janda "Large Bets Make Our Opponent Put More Money In"; MIT L8.
- **Convention disagreement (important):**
  - MoP applies MDF to the hands **that can beat a bluff**. See MoP p.119 ("X can fold α of his hands that can beat a bluff") and p.143 (AKQ).
  - Janda and Acevedo state it over the **whole range**, framed as "don't let villain profit with any two cards".
  - The two agree only when every defending hand beats every bluff. **The trainer should compute MDF over bluff-beaters.**
- **Caveats the app must not ignore:**
  - Acevedo p.603 ("Alpha and MDF Revisited"): before the river, bluffs carry equity and checking back isn't worth 0, so the BB does **not** need to defend MDF on the flop. Treat MDF as a rough guide, not a grading rule.
  - Janda "When Should Betting with Any Two Cards be Profitable?": it's fine for villain's river bluffs to be profitable after a polarized line, if he had to risk money to reach that spot.
  - The Malmuth/Sklansky preface in Janda ("A Cautionary Note About 'Bluff Catching'") says MDF-style calling is too loose against tight or timid opponents.
  - Hawrilenko (MIT L8): once your range already defends enough with stronger hands, a villain bluffing 90% isn't exploiting you, even if you fold AA. That only means you're not exploitable. It does **not** mean folding AA is correct: against a node-locked 90% bluffer, the best response calls.

### 1.4 Bluff-to-value ratio for a bet of size s (polar range)
- **bluffs : value = α = s/(1+s)**, so the **bluff share of the betting range = s/(1+2s)**, which equals the caller's required equity.
- Meaning: bluff exactly enough that the bluff-catcher is indifferent.
- Sources: MoP p.111–112 (b = 1/(P+1), "the ratio of bluffs to bets"); MIT L7 (Rose–Colin: "2 to 1" value:bluff for a pot bet); MIT L8; Acevedo p.99–103 and p.136 (½ pot → 75% value / 25% bluff); Janda "Making Our Opponent Indifferent to Calling on the River" (pot bet → two value bets per bluff).
- Value:bluff by size: ¼ → 5:1, ⅓ → 4:1, ½ → 3:1, ⅔ → 2.5:1, ¾ → 2.33:1, pot → 2:1, 2× → 1.5:1.
- **Error in the Article:**
  - It writes EV(call) = f·P − (1−f)·B. That credits the caller with P instead of **P+B** when he catches a bluff.
  - As a result it gives the bluff share of bets as f = B/(P+B). For a pot bet that is 1/2; the correct value is B/(P+2B) = 1/3.
  - Its identity "f + α = 1" only holds under that mistaken convention.
  - The Article's own header note already flags this. The Kuhn section happens to come out right because "bluff Q 1/3 of the time" is really α applied to Q frequency, with A and Q equally likely.
- **Naming disagreement:**
  - MoP uses α for **both** the bluff:value ratio and the caller's fold frequency.
  - Acevedo uses α only for the required fold frequency.
  - Bootcamp v2 lists "MDF/α (p/(p+1))", which conflates the two: in limit units MDF = P/(P+1) and α = 1/(P+1).
  - The app should use distinct symbols: `alpha`, `mdf`, `bluffRatio`, `bluffShare`.

### 1.5 Polarized river equilibrium (clairvoyance game; closed form)
Setup: polar player Y holds nuts with probability v and air with probability 1−v. X holds only bluff-catchers. Pot = 1, bet = s, no raises.
- If **v ≤ (1+s)/(1+2s)**:
  - Y bets all nuts and bluffs αv of total hands, i.e. **αv/(1−v) of his air**.
  - X calls **1/(1+s)**.
  - Y's pot share = **v(1+2s)/(1+s)**; X gets the rest.
  - Y's bluffs are 0-EV versus giving up.
- If **v > (1+s)/(1+2s)**: Y bets everything and X **folds 100%**. Y's share = 1. (MoP ex. 14.1 p.147–148: v = 0.6 with a 5-pot stack → X folds everything, even to tiny bets.)
- **Optimal size = all-in.** Y's ex-showdown EV is v·s/(1+s), which increases in s (MoP p.146–147; Acevedo p.103; Brokos ch.2).
- **Position doesn't matter** in nuts/air vs bluff-catcher: the bluff-catcher never bets (Acevedo p.103).
- Sources: MoP ex. 11.1 p.110–113 (limit: value to Y = P/(2(P+1)) bets), ch.14 p.146–148; Acevedo p.98–104; Brokos ch.2; MIT L8 ("Coin Flip Clairvoyance"); Sklansky ch.19 p.181–184 (lowball, v = 18/42, ½-pot bet → the "right" number of bluff cards is 6).
- **Error in Acevedo:** p.594 lists the P1 EV for a 2×-pot stack as $83.5. The formula gives **$83.33**. His other values (54.6 / 66.7 / 75 / 95.4) match the formula.

### 1.6 Defender holds some nuts (AKQ-type; no-limit form)
- Let n = the share of the defender's bluff-beaters that are nuts.
- Required total defense of bluff-beaters is 1/(1+s), so the **bluff-catcher calls c = (1/(1+s) − n)/(1−n)**. With n = ½ this becomes **(1−s)/(1+s)**.
- **If n ≥ 1/(1+s), bluff-catchers fold and the bettor stops bluffing.** Example: n = ½ with s ≥ 1 (Brokos ch.3 Q5; MoP p.144).
- With n = ½, Y's ex-showdown value = **s(1−s)/(6(1+s))**. This is maximized at **s = √2 − 1 ≈ 0.414 pot**; there the bluffer bluffs 1 − 1/√2 = 29.3% of his air, the K calls √2 − 1 = 41.4%, and the value is r²/6 = 0.0286 pot (MoP ch.14 p.148–151).
- **Extraction error:** the MoP PDF text prints "0.114". The book's own prose ("a little more than 41%") and the math give 0.414.

### 1.7 Geometric bet sizing across streets
- **s_geo = ((1 + 2S/P)^(1/N) − 1)/2** per street, where N = streets left and S/P = SPR.
- Meaning: the same pot fraction every street, reaching all-in on the river. This is optimal for a perfectly polar range.
- Sources: MoP ch.19 p.231–237 (proof via AM–GM; ex. 19.3: $185 stacks, $10 pot, 3 streets → bets $11.66 / $38.86 / $129.48 and value-hand EV $26.41 vs $19.16 for thirds-of-stack); Janda "Post-flop Bet Sizing at a Glance" (7bb → 200bb in 3 streets, R = 3.06 → 1.03 pot per street); Acevedo p.613.
- Reference values:
  - SPR 3.5 → ½-pot ×3
  - SPR 4 → pot ×2, or 0.54 pot ×3
  - SPR 13 → pot ×3 (MoP p.236; Gaines p.131)
  - SPR 1 → 0.37 pot ×2, 0.22 pot ×3
- **Multi-street bluff multiplier** (MoP p.233, 237):
  - Hands bet on a street = (hands carried to the next street) × (1+2s)/(1+s).
  - The caller folds α on each street independently (MoP p.229: "plays each street independently").
  - Check: at ¾ pot on all three streets, value = 1/1.4286³ = **34.3%** of flop bets. This matches Janda "The Out of Position Value Betting to Bluffing Ratio" exactly.
- **Where the books disagree:** real (non-polar) ranges bet smaller and "merged" on early streets (Acevedo p.614–620; Janda "Bet Sizing at a Glance": descending sizing and multiple sizes; MoP p.268–269 prefers roughly the 3-street geometric size on static boards and the 2-street size on draw-heavy ones).

### 1.8 SPR
- **SPR = effective stack / pot at the flop.**
  - Acevedo p.76 bands: 0–5 favors top pair and overpairs; 6–11 lifts speculative hands; 11+ rewards nuttiness.
  - Course p.77–78: in super-loose games SPR drops below 2, so you're deciding on the flop whether to commit, and big-card and pair hands beat suited connectors.
  - Course p.157–160: SPR ~3 → don't c-bet a miss multiway; SPR ~8 → barrels possible.
  - Gaines p.131: SPR 13 = three pot-size bets.

### 1.9 Implied odds
- The call breaks even if **future winnings F ≥ C(1−E)/E − (P + B)**.
- Meaning: the money you expect to win later when you hit has to cover the shortfall in the direct price.
- Sources: Gaines p.66–68 (Table 6 multipliers (1−E)/E: 35% → "2×" (true 1.86), 25% → 3×, 20% → 4×, 15% → "6×" (5.67), 10% → 9×); MoP p.53–54 ("effective pot"); Sklansky ch.7 p.55 (reverse implied odds).
- **Set-mining:** P(set or better on the flop | pocket pair) = **11.76%**, i.e. 7.5:1.
  - Gaines p.127–129: the naive requirement is about 7.3× the call; assuming ~80% equity when stacks go in, about 10.6×; his recommendation is **~15×**; "some say 25×".
  - The bootcamp's "call and stack him" rule should use ≥15×, not 7.5×.
- **Draw visibility** cuts implied odds (Gaines p.66–67: flush draws are obvious, OESDs are disguised; Janda "hand signaling").

### 1.10 Steal / fold-equity EV
- **EV = F·P + (1−F)·(E·P_final − R)**, where R = amount risked and P_final = pot if called (all-in form).
- Break-even for a pure bluff: **F* = R/(R+P)**.
- Semi-bluff, exact: **F* = (R − E·P_final) / (R − E·P_final + P)**. This is Gaines' "shortcut" (p.101–104); it is exact when equity is realized after a call (all-in).
- **MIT L3 "1.5× rule":** each +1% of equity lowers the needed fold% by about 1.5 points. This is a secant approximation with slope (P+2B)/(P+B): 1.5 for a pot bet, ranging from 1 (tiny bet) to 2 (huge bet). The app should compute the exact formula and can show 1.5× as a heuristic.
- **Multiway:**
  - Needed fold rate per opponent ≈ **α^(1/n)**, assuming independent folds and 0 equity (Acevedo p.118: BTN 2.5bb open with any two needs 62.5% overall, i.e. 79% per blind).
  - If per-player fold rates are known, multiply them: 60% combined < 62.5% → not profitable.
- **Preflop RFI** (Janda "Preflop Raise First In Ranges"): risking 3.5 to win 1.5 needs 70% folds, so if total 3-bet frequency behind reaches ≥30%, the worst opens can't profit.
- **Acevedo's steal example** (p.110–111, tournament, SB vs a tight BB): α = 43% versus BB folds of 49% → 72o steal is +EV.

### 1.11 Equity realization
- **EV(call) ≈ R_eq·E·P_final − C**, so the realization-adjusted required equity is **E ≥ C/(R_eq·P_final)**.
  - R_eq > 1 (over-realize): in position, suited, connected, with range advantage.
  - R_eq < 1: out of position, offsuit or disconnected, low SPR speculative hands.
- Sources: Acevedo p.65–76 (definition, heatmaps, factors). The formula is an image in the PDF; reconstructed from the prose.
- Janda "Understanding Equity" and "Comparing Equity to Expected Value": equity ≠ EV; a hand that is 90% on the flop is worth *more* than 0.9·pot; A9o vs 98s.
- **Related but different:** Course p.45–46 "equity-when-called" is the showdown equity a bluff keeps if called. That is the E in 1.10, not R_eq.

### 1.12 Value-bet threshold, and outs
- **River value bet with no raise risk:** profitable iff more than 50% of *calls* come from worse hands (Gaines p.111).
  - If you can be bluff-raised off the hand, the bar goes up (Gaines p.112).
  - The Course reframes this as "streets of value" (p.97–100).
- **Rule of 2/4** (Gaines p.50): outs×4 on the flop when all-in, outs×2 for one card.
  - Exact values: one card = outs/47 (or /46); two cards = 1 − (47−o)(46−o)/(47·46).
  - The ×4 rule overstates big draws: 15 outs → 60% by the rule vs 54.1% exact. The app should compute exact numbers.

### 1.13 Convention disagreements, collected
1. Bluff share vs bluff:value ratio vs α: the Article's error, and v2's "MDF/α (p/(p+1))" (see 1.4).
2. Limit-unit notation (MoP: P in bets, α = 1/(P+1)) vs NL notation (s = B/P, α = s/(1+s)). They are the same quantity.
3. MDF over bluff-beaters (MoP) vs over the whole range (Janda, Acevedo) (see 1.3).
4. "Pot odds" as a ratio (Gaines 2:1) vs a percentage of the final pot (MIT L3, Acevedo). Both are equivalent; the app should display both.
5. Gaines' rounded Table 5/6 values vs exact values.
6. Acevedo's $83.5 typo (should be $83.33); MoP's "0.114" OCR error (should be 0.414).
7. Acevedo p.77 says "a condensed range is capped" and then gives an example of a condensed range that isn't capped. Use the example: condensed ≠ capped.

---

## 2. Toy games with closed forms, as solver unit tests

**General harness rules.** These rules follow from the solutions and were confirmed with my own CFR runs:
- **River-only trees.** To stop raises, make every bet all-in by setting **effective stack = the bet size**. For half-street games, give OOP **no bet sizes**. Rake = 0.
- Compare the solver's **average strategy** (the one CFR converges on; Zinkevich 2007; Cepheus paper) at exploitability < 0.1% of the pot.
  - Tolerance: frequencies ±0.02, EV ±0.2% of the pot.
- **Only aggregate frequencies are identified** when combos are strategically equivalent. Examples: the defender's calls spread across equivalent bluff-catchers; the bluffer's aggregate bluff mass across interchangeable air combos.
  - **Test aggregate mass, never per-combo frequencies.** Otherwise the tests will be flaky.
- Some games have **families** of equilibria (Kuhn; AKQ with s ≥ 1; bet-size assignment in the ladder game). Test EV plus the identified relations.
- **EV conventions:** "share" means the player's final pot share minus their river investment, so both players' shares sum to the starting pot. The ex-showdown value is share minus the check-down share.
- **Grading implication for one-action answers:** at equilibrium every action in a mixed hand's support has equal EV, so any of them has **0 EV loss versus GTO**. Against a node-locked profile the best response is pure except on measure-zero ties (MoP p.48–49: a 0.002% change in bluff frequency flips calls from 0% to 100%; Gaines p.140). **Grade by EV difference, never by matching the "GTO action label".**

### T1 — Clairvoyance game on a real board (Acevedo p.98–104; MoP 11.1/14.1)
- **Cards:**
  - Board **3♠ 3♥ 3♣ 2♦ 2♠**.
  - OOP (polar) range {**A♠A♥** (nuts, 333AA), **Q♣Q♦** (air, 333QQ)}, weight 1 each.
  - IP range {**K♣K♦**} (bluff-catcher, 333KK).
  - No card conflicts; no ties.
- **Tree:** pot 100, effective stack 100 (pot-size all-in). OOP: check or all-in. IP after a check: may bet all-in (betting KK is dominated). IP facing the bet: call or fold.
- **Expected:**
  - OOP bets AA 100% and QQ **50%**.
  - IP calls KK **50%**; after a check, IP checks back 100%.
  - **EV:** OOP 75, IP 25. Per hand: AA 150, QQ 0.
- **Parameter sweep** (stack = s·100):
  - OOP EV = 50(1+2s)/(1+s): s = 0.1 → 54.55; 0.5 → 66.67; 1 → 75; 2 → 83.33; 10 → 95.45.
  - IP calls 1/(1+s); QQ bluffs s/(1+s).
- **Ratio variants via range weights:**
  - AA:1, QQ:3 (v = ¼; Rose–Colin analogue, MIT L7): QQ bluffs 1/6, KK calls ½, OOP EV **37.5** (i.e. "$12.50 to Colin").
  - AA:0.7, QQ:0.3 at s = 1: v > 2/3, so OOP bets 100% of hands, **KK folds 100%**, OOP EV = 100.
  - Sklansky ch.19: v = 18/42, s = ½ → bluffs 25% of air, IP calls ⅔, OOP share 57.14.
- **Position swap:** give the polar range to IP → identical numbers (my CFR: 0.25/0.75).
- **Size menu** {⅓, ½, pot, all-in = 2 pot} with stack 200: the polar player should concentrate on the **largest** size (EV 83.33).
- **Node-lock / exploit tests** (these match Acevedo's MinES example, p.124–128):

| Lock | Best response (pure) | EV to OOP | Error to grade |
|---|---|---|---|
| KK calls 55% (station-lite) | QQ never bluffs | 77.5 | bluffing QQ costs 10 |
| KK calls 45% (folds too much) | QQ always bluffs | 77.5 | checking QQ costs 10 |
| KK calls 100% (Station) | QQ never bluffs | 100 | bluffing QQ costs **100 (1 pot)** |
| KK calls 0% (Nit) | QQ always bluffs | 100 | checking QQ costs 100 |
| OOP bluffs QQ 100% (Maniac) | KK always calls (bluff share ½ > ⅓) | IP 50 | folding costs 50 |
| OOP never bluffs | KK always folds | IP 50 (vs 25 at GTO: QQ now checks and loses to KK) | calling costs 100 per bet faced |

  - General rule: IP's call is profitable iff OOP's bluffs/bets > ½ at a pot-size bet; bluffing QQ is profitable iff KK calls < ½.

### T2 — AKQ game on real cards (MoP ch.13 p.138–145; Brokos ch.3; MIT L8)
- **Cards:**
  - Board **3♠ 3♥ 3♣ 2♦ 2♠**.
  - **Both** players get the identical range {**A♣A♦, K♣K♦, Q♣Q♦**}, weight 1 each.
  - The combos are pairwise disjoint. Because identical combos conflict, the solver's card removal reproduces the AKQ deal exactly: the six ordered (X,Y) pairs are equally likely and the two players never hold the same "card".
  - If the range parser lacks single-combo syntax, set per-combo weights instead.
- **T2a — limit-style half street** (MoP 13.1; Brokos "Reciprocal Ranges, Half-Street"):
  - Tree: pot 100, stack **50**, IP bet 50 (s = ½), OOP has no bet option.
  - **Expected:**
    - IP bets AA 100%, bluffs **QQ 1/3**, checks KK.
    - OOP calls AA 100%, **KK 1/3**, folds QQ.
  - **EV:** IP share **52.78** (= 50 + 50/18; ex-showdown = 1/18 bet). OOP 47.22.
    - IP per hand: AA 108.33, KK 50, QQ 0.
    - OOP per hand: AA 108.33, KK 33.33, QQ 0.
  - (Brokos: $1.06 on a $2 pot. The CFR check gave 1.05556.)
- **T2b — no-limit optimum:**
  - Pot 100, stack 41.42 (s = √2 − 1).
  - QQ bluffs **29.3%**, KK calls **41.4%**, IP share **52.860** (= 50 + 100·r²/6).
  - With s = ½ instead: 52.78; with s = ¼: 52.50. General ex-showdown value: 100·s(1−s)/(6(1+s)).
- **T2c — degenerate case (s ≥ 1; use s = 1.5 to avoid a knife edge):**
  - IP never bluffs, KK never calls, IP share = **50** (AA's betting frequency is undetermined).
  - Brokos ch.3: at bet ≥ pot, the half of bluffs that run into aces kill bluffing.
- **T2d — size menu** {25%, 33%, 41.4%, 50%, 75%, 100%}:
  - Value = 52.860.
  - The average strategy **converges slowly** onto 41.4% (my CFR+: 98.7% of AA at 41.4% after 100k iterations, but 94% at 50% after 40k), because f(s) is flat near the optimum.
  - **Assert on EV, not on size choice**, unless the solver is run to very low exploitability.
- **Node-locks:**
  - Lock OOP KK call = c. IP's QQ bluff EV = 25 − 75c, so bluff iff c < ⅓. AA betting gains 25c.
  - c = 0 (Nit) → IP bluffs all QQ, IP share **58.33**.
  - c = 1 (Station) → IP never bluffs, IP share **58.33** (AA 125, KK 50, QQ 0).

### T3 — Kuhn poker (full street; the Article; Brokos "Reciprocal Ranges, Full Street")
- **Cards and tree:** same as T2a, but **OOP may also bet 50**.
- **Equilibrium family, a ∈ [0, ⅓]:**
  - OOP bets QQ with frequency a and AA with **3a**, and always checks KK.
  - OOP check-calls KK with **a + ⅓**; always calls AA; folds QQ.
- **IP (unique):**
  - AA: bet when checked to, call when bet into.
  - KK: check back; call **⅓**.
  - QQ: bluff **⅓** when checked to; fold to a bet.
- **Value:** OOP share **47.22** (net −1/18 bet = −2.78), IP 52.78, identical to T2a.
  - My CFR hit the a ≈ 0.26 member of the family: AA bet 0.78, QQ 0.26, KK call 0.594.
  - The Article presents only the a = ⅓ endpoint. That's correct but not unique.

### T4 — Discrete [0,1] "ladder" game on real cards (MoP ex. 11.3 p.115–120; Acevedo p.604–610)
- **Cards:**
  - Board **2♥ 2♠ 2♦ 3♠ 3♥**.
  - IP {A♣A♦, K♣K♦, … , 5♣5♦}; OOP {A♠A♥, … , 5♠5♥}. Ten pairs each.
  - Hand value is 222 plus the pocket pair. No blockers; equal ranks tie (split).
- **T4a — single pot-size bet** (pot 100, stack 100, OOP checks):
  - **IP bets AA, KK for value, bluffs 55, checks QQ–66.**
  - OOP always calls AA and KK. Its calls with QQ–66 are indeterminate per hand; the **aggregate is ≈ 2.59 of 7**.
  - IP share **55.50**.
  - This is the discrete analogue of the continuum solution: y1 = 2/9 value, 1−y0 = 1/9 bluffs, x1* = 4/9 calls, value **1/18** bet (MoP p.119; my N=45 discretization gives 0.05555).
- **T4b — sizes {⅓, ⅔, pot}**, stack 200, no check-raise:
  - IP share **56.11%**. This exactly matches Acevedo's Toy Game A (p.604–605) and was independently reproduced (0.56108).
  - AA uses the largest size; JJ–77 always check; 55 is the main bluff (66 tops it up).
  - The size assignment of KK and QQ is **not unique**: Acevedo's solver put KK on ⅔ and QQ on ⅓, mine the reverse, with the same EV. **Assert EV and the structural facts only.**
- **T4c — Acevedo's variants (qualitative):**
  - Allowing OOP to check-raise against small sizes kills them (B: 54.98%; C: pot-size only, KK+ value).
  - With SPR ≤ 1 the optimal size is all-in.

### T5 — Abstract (non-card) tests for a generic CFR engine
- **[0,1] game #2 continuum**, P bets, bet 1:
  - y1 = (1−α)/((2−α)(1+α)), x1* = 2y1, 1−y0 = α·y1.
  - At P = 1: 2/9, 4/9, 1/9, value 1/18.
- **MoP ex. 19.3 (geometric sizing):**
  - Clairvoyant Y wins with an A or K (2/13); antes 5+5; stacks 185; three streets.
  - Geometric bets 11.66 / 38.86 / 129.48; X calls 46.2% on each street; value-hand EV **$26.41** vs **$19.16** for $60×3.
  - Testing geometric sizing on real cards is hard: every river card that pairs a hole card breaks the "static" assumption. Keep this test abstract.
- **MoP 19.1 (two-street limit static clairvoyant):**
  - X folds α on street 1 and α₂ = 1/(P+3) on street 2.
  - Y bluffs y1 = α·y2 on street 1, and y_b = α₂·y_v on street 2.

---

## 3. Exploitative adjustments, as testable directional claims

**Meta-principles:**
- **Maximal exploitation is bang-bang.** Past the indifference point, switch 0% → 100% (MoP p.48–49; Gaines p.140–141).
- **Humans should exploit at the margins**, in proportion to confidence in the read (MIT L8; Brokos ch.5 step 4 "Determine the Degree of Deviation"; Acevedo MinES p.124: MES gains 2.5 per hand but can be counter-exploited for about 10× that).
- **Brokos' four-step process** (ch.5): envision the equilibrium → make a specific read → identify the exploits → size the deviation. This maps exactly onto LiveGTO: DCFR → node-lock → best response → confidence blend.
- **Recommendation:** let a profile's lock be a mixture (w·profile + (1−w)·GTO) so "confidence" is a parameter, and warn when a pure best response is far from GTO.

In the table below, **[LIVE]** marks advice framed specifically for live low-stakes play.

| Leak (profile) | Directional claim to test (via node-lock → best response) | Sources |
|---|---|---|
| Calls too much (**Station/Whale**) | Bluff less (drop every hand that is mixed at equilibrium); value-bet thinner and bigger; three streets with top pair; hands mixed between betting and checking become pure bets; the very weakest river hands (missed draws) can still bluff; don't bluff-raise | Brokos "Summary of Exploits"; Gaines p.139; SS p.53 (never bluff a station); MIT L3; Course p.113–117 [LIVE] |
| Folds too much (**Nit**, over-folder) | Bluff more (hands mixed between bluffing and checking become pure bluffs); fewer thin value bets (make them checks); steal and isolate wider; attack spots where he can't have the nuts; when he calls twice, he's strong by the river → give up | Brokos; Gaines; Acevedo p.110 (steal), p.185 (open the BTN 55–60% vs over-folding blinds); Course p.40, p.171, p.178 (dry boards: bet once, give up) [LIVE] |
| Bluffs too little (**live population default**) | Fold pure bluff-catchers to big turn and river bets and raises; in extreme cases fold stronger hands too; don't pay off; value-bet and fold to a raise ("bet until raised"); don't bluff-raise him | Course Skill #2 p.81–91 (large late bets "they aren't bluffing"; applies to turn/river and not to small flop bets) [LIVE]; Negreanu p.342 ("people don't bluff nearly as much as you think"); Brokos; Janda cautionary note |
| Bluffs too much (**Maniac/LAG**) | Call wider with bluff-catchers; check strong hands to induce; don't check-raise him off his bluffs; small bluff-raises; widen value raises; float or raise automatic 100% c-bets when your range is stronger; **but** a big river bet after a two-barrel give-up pattern = value | Brokos; SS p.53–54; Course Skill #8 p.255–264 [LIVE 5-10]; MIT L8 |
| Over-traps / doesn't trap | Trappy: bluff and thin-value less, take free cards with draws in position. Non-trapper: thin value and overbet bluffs after he checks; respect his bets | Brokos "Opponent is Excessively Trappy / Doesn't Trap Enough" |
| Loose preflop, folds post-flop (the "2-5 reg") | "You check, I bet": barrel the turn with weak hands; c-bet dry, missed boards; barreling profits when >½ of flops go multiway but ≤4 in 20 reach a real showdown | Course Skill #4 p.145–164 (half-pot → about 33% folds needed) [LIVE] |
| Opens wide, c-bets 100% | Call or raise with a stronger range (even with nothing); watch for give-ups | Course p.258–262 [LIVE] |
| Multiway / loose-passive tables | Tighten value, cut bluffs; don't c-bet misses into 4+ players unless deep with equity-when-called; flop bets > ½ pot into 3+ players mean strong made hands; raise bigger over limpers | Course p.76–80, p.89, p.157–163 [LIVE]; MoP ch.29 p.358 (no "optimal" multiway; disturbing the equilibrium favors more bluffing); Acevedo p.134–135 (Nash guarantees only hold heads-up) |
| Sizing thresholds | Players have a never-fold threshold and a never-call threshold → small bluffs vs the "can't call" range, and no big bluffs vs the "never fold" range; bigger bets than the opponents' "standard"; don't bet bigger with vulnerable hands; size so draws call at −EV | Course p.109–113 [LIVE]; Gaines p.131–137; Janda "Bet Sizing at a Glance" (small bets keep ranges wide, big bets narrow them) |

**Disagreements to surface in-app:**
- **C-bets on K-high vs low dry flops.** Course p.150–152 prefers c-betting 8-4-2 over K-4-2 against 2-5 pools, even checking K-4-2 back. Solvers, and Acevedo's range/nut-advantage logic (ch.11 flop examples, p.684–686: the raiser c-bets high-card flops like A♥Q♦3♠ heavily), c-bet K-high dry boards very often. This is an **exploit claim about a population, not GTO**.
- **Slowplaying.** Course p.106: don't slowplay at 1-2. Janda "Understanding Polarized and Condensed Ranges": against skilled players, slowplay some to protect condensed ranges. SS p.53 checks sets against weak aggressive players.
- **Hiding bet size.** Course p.113: don't worry about size tells at 1-2. Negreanu p.306, Acevedo p.177: never size by hand strength.
- **Open size vs skill.** Negreanu p.306: raise smaller against weak players, 4–5× against tough ones (tournament context). Course p.76–77: raise to $15–20 over limpers.
- **Is over-folding preflop exploitable live?** Course p.36 says it's never profitable enough in practice. Acevedo p.110 and p.185 profit from over-folding blinds.
- **Rake.** Course p.35 says ignore rake in decisions and treat it as ~$10/hr. Bootcamp v2 makes rake drag its own concept. Acevedo notes rake makes open-limping worse and matters less in 3-bet pots.

**Live-specific flags:** Course (entire book: 9-10 handed live 1-2/2-5/5-10), Negreanu (live tournament), SS (1970s deep, ante games), and the Malmuth/Sklansky note. Janda and Acevedo are online 6-max 100bb baselines.

---

## 4. Preflop

**Course, live 9–10 handed 1-2** (p.43–75). Positions: early (every seat up to two off the button), cutoff, button, blinds. **Raise every hand you play; no open limps.**
- **Unopened pot:**
  - **EP ~14%:** 22+, A2s+, KTs+, QTs+, JTs–76s, AKo, AQo.
  - **CO ~22%:** 22+, A2s+, K7s+, Q9s+, JTs–43s, J9s–53s, ATo+, KJo+.
  - **BTN ~33%:** 22+, A2s+, K2s+, Q5s+, J7s+, T9s–43s, T8s–53s, T7s–96s, A7o+, K9o+, QTo+, JTo.
- **Versus a strong (tight) raise:** 3-bet AA–KK plus A5s; call QQ–22, ATs+, KTs+, QTs+, JTs–76s, AKo.
- **Versus a loose raise (EP):** 3-bet AA–QQ, AKs, A5s–A2s, T9s, 87s, AKo; call JJ–22, AQs–A6s, KTs+, QTs+, JTs, 98s, 76s, AQo. The CO and BTN versions are wider (p.64, p.66).
- **Blinds:**
  - In limped pots, raise 99+, ATs+, KJs+, AQo+.
  - Defend only against small raises (< 3bb) or steals; most live raises are "big" (p.69).
  - **Versus a steal:** 3-bet ~16% (99+, 44–22, A2s+, KJs+, K7s–K5s, Q9s, 98s–54s, J9s–86s, AJo+, KQo) and call more, for about **36% total defense** (p.71–73).
- **Limpers** (p.76–79): ignore the limps for hand selection and raise to $15–20. In "call-everything" games, SPR < 2, so prefer pairs and big cards over small suited connectors; drop 3-bet bluffs only if you're **sure** you'll be called.
- 9-handed preflop is unsolved (p.58); the frequencies matter more than the exact hands.

**Online 6-max 100bb baselines:**
- **Janda** "Recommended Hand Chart": UTG 13.9%, MP 17.9%, CO 23.7%, BTN 47.5%. Opens are 3.5bb (BTN 2.5bb).
- **Acevedo ch.5** (solver, 5% rake capped at $3):
  - Opens 2.5bb; SB 3bb. 3-bet 8.5bb in position / 10bb out of position (+2–3 when squeezing); 4-bet 23bb.
  - RFI: **LJ 17.1%, HJ 21.4%, CO 27.8%, BTN 43.4%, SB raise 24.4% + limp 37.7%** (p.180–200).
  - Versus a 5-bet, get in with TT+/AK.
  - Exploit heuristics (p.177): widen with **threshold (mixed) hands first**; when opening off-range, over-fold to 3-bets; the blinds' tightness decides marginal opens.
- **Map to 9-max live** (my inference, not in the sources): Course EP ≈ Acevedo LJ, Course CO/BTN tighter than 6-max. Flag any LiveGTO preflop chart that is *looser* than Course's EP range from UTG–MP2 at 9-handed.

**Steal / isolation math:**
- Break-even steal fold rate = R/(R+P), per 1.10. Janda's RFI rule: ≤30% total 3-bet frequency behind.
- Negreanu p.305–306 (tournament): 2.5× opens need ~50% folds; bigger raises to isolate or define tough players.
- Set-mining ≥15× (Gaines).
- Push/fold (MoP ch.12) is only relevant to short stacks. Brunson's SS NLHE chapter (ante-structure era) is low-relevance for blinds-only $1/$2.

---

## 5. Hand-class and range vocabulary (align app language)

| Term | Definition (paraphrased) | Source |
|---|---|---|
| Value bet / bluff / semi-bluff | Bet expecting to be called by worse / to fold better / a bluff with meaningful equity-when-called. The terms are clean only on the river; flop bets mix both | Janda "Grey Area"; MoP p.55; Gaines p.99 |
| Bluff-catcher | A hand that beats only bluffs | Acevedo p.21; Brokos ch.2 |
| Air | No showdown value and no draw; wins only by bluffing | Acevedo p.21 |
| Nuts / effective nuts | Best possible hand / a hand to play as if it were the nuts | Acevedo p.21 |
| Showdown value | Can realistically win at showdown against the villain's range | Acevedo p.21 |
| Polarized | Strong + weak, no middle; betting ranges, more so for larger bets | Brokos ch.2; Janda; Acevedo p.77 |
| Condensed / depolarized | Mostly medium hands (a bluff-catching range); check-call ranges | Brokos ch.2; Janda; Acevedo p.77 |
| Linear / merged | The top X% without gaps; "merged" = betting polar and medium hands together small, at high frequency | Acevedo p.77, p.619 |
| Capped / uncapped | Missing / containing the top hands (condensed ≠ capped; see 1.13 item 7) | Acevedo p.77; Brokos ch.3 |
| Range advantage | Higher overall equity than the opponent's range | Acevedo p.76 |
| Nut advantage | More effective-nut combos than the opponent's range | Acevedo p.21 |
| Equity / EV / equity realization | Win probability vs EV; realized share of the pot vs raw equity | Janda Pt.1; Acevedo p.65 |
| Equity-when-called; fold equity | Equity left after a bluff is called; value from folds | Course p.45–46 |
| Streets of value | How many bets worse hands will call (0–3) | Course p.97–102 |
| Static vs dynamic; dry vs wet; monochrome; key cards | Hand values stable vs volatile; few vs many draws; three-flush boards; cards that pair the preflop raiser's range | Course Skill #5 p.166–187; Acevedo ch.11 |
| Blockers / card removal | Your cards change the combos the villain can hold | MoP ch.13; Brokos ch.8 |
| Indifference; MES / MinES; node-locking | Equal-EV mixing; maximal vs minimal exploitation; fixing one player's strategy to find a best response | Acevedo p.97, p.122–128; Brokos ch.5 |
| **Equity buckets** | **Strong ≥75%, Good 50–75%, Weak 33–50%, Trash <33%** hand-vs-range equity | Acevedo p.597 |
| Draw (MoP usage) | Currently the worse 5-card hand, needing outs. **It can be the equity favorite** (Q♣J♣ vs A3 on T♣9♣2♦ ≈ 70%) | MoP p.49–50 |

**Suggested mapping for LiveGTO's six classes** (my proposal, grounded in the above):

| LiveGTO class | Acevedo bucket | Course streets of value | Brokos role |
|---|---|---|---|
| **monster** | effective nuts / strong | 3 streets | pure value |
| **strong** | Strong ≥75% | 2–3 streets | value |
| **medium** | Good 50–75% | 1 street / showdown | condensed, bluff-catcher |
| **weak** | Weak 33–50% | 0 streets, some showdown value | bluff-catcher / give-up |
| **draw** | Weak or Trash made hand, but equity from outs (flag, not a strength bucket) | equity-when-called | semi-bluff candidate |
| **air** | Trash <33%, no outs | none | bluff candidate |

- Define the classes **relative to the villain's continuing range on the current board**, not by absolute hand rank (Acevedo Table 88: top pair is 82% on AQT but 60% on T98).
- On the river, "draw" collapses into "air" (missed draw).

---

## 6. Bootcamp plans and the Article: summary and conflicts

**POKER_BOOTCAMP_PLAN.md (v1, 2026-07-17)**
- Scope: upgrade the offline single-file `Poker_Boot_Camp.html` into an **exploitative live 1/2–2/5 toolbox**.
- Three teaching tiers: 💡 Feel / 📐 Formula / 🎓 Proof, with a `concept` step schema and the tier persisted in localStorage.
- Content areas:
  - **A — Exploit:** player types, limpers, stations, nits, maniacs, exploit vs baseline.
  - **B — Postflop:** texture, c-bets, barreling, sizing, SPR, multiway, implied odds.
  - **C — Table math:** pot odds, 2&4, combos and blockers, break-even and α, MDF, one-line EV.
- **Four drill engines:** timed generators, 13×13 range builder, SVG scenario drills with a villain tag, SM-2 spaced repetition.
- Architecture: `app-src/` plus an inline build; KaTeX for proofs. Solvers and CFR were explicitly **non-goals**.
- Open questions for Elijah: (1) architecture A vs B; (2) KaTeX or library-free; (3) output location; (4) paste in the Medium article; (5) first slice = Pot Odds?

**POKER_BOOTCAMP_PLAN_v2.md**
- Verdict: the app is ~80% preflop and has no postflop or exploit depth.
- Proposes **32 concepts in six tracks**: A Math & bankroll/rake; B Preflop; C Postflop (the priority); D Exploit (the MIT L8 "four-leak table"); E Game-theory deep end (Rose–Colin, clairvoyance/AKQ, Hawrilenko's AA fold, CFR appreciation); F Mental game.
- **Replaces runtime KaTeX with LaTeX→SVG pre-rendered at build time.**
- Lists 12 "gems". Build order: postflop → exploit → drills → deep end.
- Open questions: (1) publish or personal (MIT content is CC BY-NC-SA); (2) fetch the article; (3) postflop before preflop polish?; (4) three tiers for everything?

**The Article:** game-theory primer. Covers payoff matrices, minimax and Nash, the prisoner's dilemma, RPS indifference, the one-street polar river game, Kuhn poker (value −1/18, the "medium hands check" lesson), and CFR/average-strategy convergence (correct for 2-player zero-sum).

**Where the plans or Article disagree with the books, or need correction:**
1. **Article, polar river game:** bluff share is f = B/(P+2B), not B/(P+B); "f + α = 1" is wrong (see 1.4). The qualitative lessons stand.
2. **Article, Kuhn:** it presents one member (a = ⅓) of a family; P1's AA/QQ betting and KK calls are not unique (see T3).
3. **v2 "MDF/α (p/(p+1))"** conflates MDF = P/(P+1) with α = 1/(P+1) in limit units.
4. **v2 gem #10** ("Hawrilenko's AA fold — not exploited even vs a 90% bluffer"): true in the unexploitable sense only. Against a node-locked 90% bluffer, folding AA is a large EV loss (MIT L8 transcript).
5. **v2 "semi-bluff 1.5× rule":** a secant approximation that is valid near pot-size bets (the coefficient runs 1→2 with size) and assumes equity is realized when called. Gaines' shortcut is exact (see 1.10).
6. **v2 AKQ "call aces + ⅓ of kings":** only for pot = 2 bets (s = ½). In general, K calls (P−1)/(P+1) = (1−s)/(1+s), and 0 for s ≥ 1.
7. **v1 A2 iso sizing "3–4bb + 1bb per limper":** the Course (p.76–77) says $15–20 (7.5–10bb) over multiple limpers in limp-heavy live games, and ignoring the limps for hand selection. Acevedo (p.177) says tighten against a limper, a GTO-ish view that disagrees with Miller's live exploit.
8. **v1/v2 set-mining "call and stack him":** Gaines requires ~15× the call, not the naive 7.5:1.
9. **v2 rake-drag concept vs Course p.35** (ignore rake in in-hand decisions).
10. **v1 C4/C5 and B-track MDF drills:** add the Acevedo p.603 and Malmuth/Sklansky caveats so MDF isn't taught as mandatory flop or live defense.
11. **Both plans list solvers/CFR as non-goals.** LiveGTO now puts DCFR at the core. That's philosophically consistent with Brokos' four-step process, but the bootcamp's Feel/Formula answers must match solver EVs wherever both exist.
12. **Housekeeping:** the MIT index and v1 reference `notes/` slide PDFs and `.md` transcripts that aren't in the folder (only transcript PDFs are). The v1 paths (`~/Desktop/...`) are stale.

---

### Appendix: verification artifacts
- `scratchpad/toycfr.py`: a minimal CFR+ for half- and full-street river games (no raises). It reproduced T1, T2a/b, T3, the clairvoyant variants (v = ¼, ½, 0.7, 18/42) and the position swap to ≤1e-4 of the closed forms.
- `ladder.py`: T4a (55.50) and T4b (56.108 = Acevedo's 56.11%).
- `zo.py`: [0,1] game #2 with N=45 (value 2/9, bluffs 1/9, calls 0.443, value 0.05555 ≈ 1/18).
- `nlakq.py`: the NL AKQ size menu (value 52.8595; slow convergence of size choice).
- Extracted text: `scratchpad/textbooks/*.txt`. Negreanu was OCR'd to `negreanu.txt`; Janda was converted from the epub to `janda.txt`.
