/**
 * Pot math, exactly as the textbooks define it. One home for every formula the UI shows.
 *
 * Notation (docs/THEORY.md §1): P = pot before the bet, B = bet, s = B/P.
 * Sources: Mathematics of Poker (Chen & Ankenman) ch.4, 11, 14, 19; Gaines, Poker Math That
 * Matters; Acevedo, Modern Poker Theory; Janda, Applications of NLHE.
 */

/**
 * Equity needed to call: your call over the final pot.
 *   E_req = C / (P + B + C)          (facing a bet with C = B: s / (1 + 2s))
 * @param {number} potWithBet  pot including villain's bet (P + B)
 * @param {number} toCall      amount you must put in (C)
 */
export function requiredEquity(potWithBet, toCall) {
  if (toCall <= 0) return 0;
  return toCall / (potWithBet + toCall);
}

/**
 * α: how often a pure bluff must work to break even.  α = B / (P + B) = s / (1 + s)
 */
export function alpha(pot, bet) {
  return bet / (pot + bet);
}

/**
 * Minimum defence frequency: 1 − α = P / (P + B).
 * Applies to the hands that beat a bluff (MoP p.119), not the whole range, and is a guide
 * rather than a rule before the river (Acevedo p.603).
 */
export function mdf(pot, bet) {
  return pot / (pot + bet);
}

/**
 * Share of a polarised betting range that should be bluffs: B / (P + 2B) = s / (1 + 2s).
 * (Equal to the caller's required equity: the bluff-catcher is made indifferent.)
 * NB: not B / (P + B) — that credits the caller with P instead of P + B.
 */
export function bluffShare(pot, bet) {
  return bet / (pot + 2 * bet);
}

/** Bluffs per value bet: α = s / (1 + s). Pot-size bet → 1 bluff per 2 value bets. */
export function bluffsPerValue(pot, bet) {
  return bet / (pot + bet);
}

/**
 * Geometric bet fraction: the same pot fraction every street that gets all-in by the river.
 *   s = ((1 + 2·S/P)^(1/N) − 1) / 2
 */
export function geometricFraction(pot, stack, streets) {
  return (Math.pow(1 + (2 * stack) / pot, 1 / streets) - 1) / 2;
}

/** Pot odds as a ratio "X : 1" (what the pot pays : what you pay). */
export function potOddsRatio(potWithBet, toCall) {
  return potWithBet / toCall;
}

/** Exact chance to hit with `outs` over one or two cards (the rule of 2/4 approximates this). */
export function hitChance(outs, cardsToCome, unseen = 47) {
  if (cardsToCome === 1) return outs / unseen;
  return 1 - ((unseen - outs) * (unseen - 1 - outs)) / (unseen * (unseen - 1));
}

export const pct = (x, digits = 0) => `${(100 * x).toFixed(digits)}%`;
