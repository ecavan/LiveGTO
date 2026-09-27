/**
 * Corrections applied to the Boot Camp course when it is imported (scripts/build-course.mjs).
 * Each entry appends a short "Correction" note to a step; sources in docs/theory-audit.md §6.
 * Keyed by module index, then by the step's title or prompt (robust to reordering).
 */
export const ERRATA = [
  {
    module: 4, match: 'Toy game #2 — Ace-King-Queen', field: 'proof',
    note: 'The bet in this game is $1 into a $2 pot: a <b>half-pot</b> bet, so MDF = P/(P+B) = 2/(2+1) = 2/3. Against a true pot-sized bet MDF is 1/2, which the aces alone supply, and kings never call. In general kings call (1 − s)/(1 + s) of the time for a bet of s × pot.',
  },
  {
    module: 4, match: 'In the AKQ game you must defend 2/3', field: 'explain',
    note: 'The 2/3 comes from the half-pot bet ($1 into $2). Against a pot-sized bet you defend 1/2: aces only.',
  },
  {
    module: 2, match: "Matt Hawrilenko's MIT lecture: read your OWN distribution first", field: 'proof',
    note: '"Not exploited even by a 90% bluffer" is true only in the unexploitable sense. Against a villain you <i>know</i> bluffs 90% of the time, folding aces is a large EV loss: exploit him and call.',
  },
  {
    module: 2, match: 'Semi-Bluff & the 1.5× Shortcut', field: 'proof',
    note: 'The 1.5 multiplier is an approximation valid near pot-sized bets; it runs from about 1 (small bets) to 2 (big overbets) and assumes your equity is realised when called. Gaines\' exact form: needed folds = (B − e·(P + 2B)) / (P + B − e·(P + 2B)).',
  },
  {
    module: 3, match: 'Size it to end the hand, not to invite a crowd', field: 'proof',
    note: 'Ed Miller (<i>The Course</i>, pp. 76–77) goes bigger in limp-heavy live games: about $15–20 (7.5–10bb) over multiple limpers, and choose your hands as if the limps were not there.',
  },
  {
    module: 3, match: 'Two players limp for $2', field: 'explain',
    note: 'In limp-heavy games The Course uses $15–20 over two or more limpers.',
  },
  {
    module: 1, match: 'Two limpers (UTG and HJ)', field: 'explain',
    note: 'The Course: $15–20 (7.5–10bb) over two or more limpers in live games.',
  },
  ...['MDF and Alpha: One Coin, Two Sides', 'Minimum defense frequency', 'Minimum Defense Frequency'].map((t, i) => ({
    module: [0, 1, 4][i], match: t, field: 'proof',
    note: 'MDF is a benchmark against an opponent whose bluffing you cannot read, not a rule. Live players under-bluff big bets and rivers, so against most of them you should fold more than MDF says (Acevedo, <i>Modern Poker Theory</i> p. 603). Against a maniac, defend more.',
  })),
];
