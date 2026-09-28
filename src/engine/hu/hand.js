/**
 * Cards, exact hand evaluation and live-player hand classes.
 * A port of solver/crates/ps-core (same encoding, same rules, same tests), so the bots, the
 * coach and the solver all agree on what "top pair" or "a draw" means.
 *
 * Card ids: card = 4·rank + suit, rank 0 = deuce … 12 = ace, suit order c d h s.
 * Strings: "Ah", "Td".
 */

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';

export const rank = (c) => c >> 2;
export const suit = (c) => c & 3;
export const cardId = (s) => 4 * RANKS.indexOf(s[0]) + SUITS.indexOf(s[1]);
export const cardStr = (c) => RANKS[c >> 2] + SUITS[c & 3];
export const ids = (arr) => arr.map(cardId);

// ------------------------------------------------------------------ evaluation

export const CAT = { HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8 };

/** Highest straight in a 13-bit rank mask (bit 0 = deuce), as a rank, or -1. Handles the wheel. */
export function straightHigh(mask) {
  const m = ((mask << 1) | ((mask >> 12) & 1)) >>> 0; // ace also low
  for (let lo = 9; lo >= 0; lo--) {
    if (((m >> lo) & 0x1f) === 0x1f) return lo + 3;
  }
  return -1;
}

function pack(cat, kickers) {
  let v = cat << 20;
  for (let i = 0; i < Math.min(5, kickers.length); i++) v |= kickers[i] << (16 - 4 * i);
  return v;
}

/** Strength of the best 5-card hand in 3–7 cards (bigger is better). */
export function evaluate(cards) {
  const counts = new Array(13).fill(0);
  const suitMask = [0, 0, 0, 0];
  for (const c of cards) {
    counts[c >> 2]++;
    suitMask[c & 3] |= 1 << (c >> 2);
  }
  const rankMask = suitMask[0] | suitMask[1] | suitMask[2] | suitMask[3];
  let flush = -1;
  for (const m of suitMask) {
    if (popcount(m) >= 5) {
      const h = straightHigh(m);
      if (h >= 0) return pack(CAT.STRAIGHT_FLUSH, [h]);
      flush = m;
    }
  }
  const by = (n) => { const out = []; for (let r = 12; r >= 0; r--) if (counts[r] === n) out.push(r); return out; };
  const quads = by(4), trips = by(3), pairs = by(2), singles = by(1);
  const descExcept = (skip) => { const out = []; for (let r = 12; r >= 0; r--) if (counts[r] > 0 && !skip.includes(r)) out.push(r); return out; };

  if (quads.length) return pack(CAT.QUADS, [quads[0], descExcept([quads[0]])[0] ?? 0]);
  if (trips.length) {
    const pairCands = [...trips.slice(1), ...pairs];
    if (pairCands.length) return pack(CAT.FULL_HOUSE, [trips[0], Math.max(...pairCands)]);
  }
  if (flush >= 0) {
    const top = [];
    for (let r = 12; r >= 0 && top.length < 5; r--) if (flush & (1 << r)) top.push(r);
    return pack(CAT.FLUSH, top);
  }
  const sh = straightHigh(rankMask);
  if (sh >= 0) return pack(CAT.STRAIGHT, [sh]);
  if (trips.length) return pack(CAT.TRIPS, [trips[0], ...descExcept([trips[0]]).slice(0, 2)]);
  if (pairs.length >= 2) return pack(CAT.TWO_PAIR, [pairs[0], pairs[1], ...descExcept([pairs[0], pairs[1]]).slice(0, 1)]);
  if (pairs.length) return pack(CAT.PAIR, [pairs[0], ...descExcept([pairs[0]]).slice(0, 3)]);
  return pack(CAT.HIGH, singles.slice(0, 5));
}

export const category = (v) => v >> 20;

function popcount(x) {
  let n = 0;
  while (x) { x &= x - 1; n++; }
  return n;
}

// ------------------------------------------------------------------ live-player classes

export const CLASSES = ['monster', 'strong', 'medium', 'weak', 'draw', 'air'];

/**
 * What kind of hand `hole` (two card ids) is on `board` (3–5 ids), in live-player terms.
 * Same rules as ps-core::classify.
 */
export function classify(hole, board) {
  const [h1, h2] = hole;
  const vAll = evaluate([...board, h1, h2]);
  const vBoard = evaluate(board);
  const cat = category(vAll);
  if (board.length === 5 && vAll === vBoard) return 'air';

  const boardRanks = [...new Set(board.map(rank))].sort((a, b) => b - a);
  const boardCount = (r) => board.filter(c => rank(c) === r).length;
  const r1 = rank(h1), r2 = rank(h2);
  const pocket = r1 === r2;
  const boardPaired = boardRanks.length < board.length;

  // quads on the board: only the kicker plays (an ace is as good as it gets)
  if (category(vBoard) === CAT.QUADS) {
    const quad = rank(board.find(c => board.filter(x => rank(x) === rank(c)).length === 4));
    const topKicker = quad === 12 ? 11 : 12;
    return Math.max(rank(h1), rank(h2)) === topKicker && vAll > vBoard ? 'strong' : 'air';
  }
  if (cat >= CAT.STRAIGHT && vAll > vBoard) return 'monster';
  if (cat >= CAT.TRIPS) {
    if (pocket && boardCount(r1) >= 1) return 'monster';
    if (boardCount(r1) >= 2 || boardCount(r2) >= 2) return 'strong';
  }
  if (!pocket && !boardPaired && boardCount(r1) === 1 && boardCount(r2) === 1) {
    const topTwo = boardRanks.length >= 2 && Math.max(r1, r2) === boardRanks[0] && Math.min(r1, r2) === boardRanks[1];
    return topTwo ? 'monster' : 'strong';
  }
  const top = boardRanks[0];
  const second = boardRanks[1];
  if (pocket) {
    if (boardCount(r1) === 0) {
      if (r1 > top) return 'strong';
      if (second === undefined || r1 > second) return 'medium';
      return 'weak';
    }
  } else {
    const paired = [[r1, r2], [r2, r1]].filter(([r]) => boardCount(r) === 1);
    if (paired.length) {
      const [r, kicker] = paired.sort((a, b) => b[0] - a[0])[0];
      if (r === top) return kicker >= 8 ? 'strong' : 'medium';
      if (r === second) return 'medium';
      return 'weak';
    }
  }
  if (board.length < 5 && (hasFlushDraw(hole, board) || straightOuts(hole, board) >= 2)) return 'draw';
  return 'air';
}

function hasFlushDraw(hole, board) {
  for (let s = 0; s < 4; s++) {
    const onBoard = board.filter(c => suit(c) === s).length;
    const inHand = hole.filter(c => suit(c) === s).length;
    if (inHand >= 1 && onBoard + inHand === 4) return true;
  }
  return false;
}

const rankMaskOf = (cards) => cards.reduce((m, c) => m | (1 << rank(c)), 0);

function straightOuts(hole, board) {
  const boardMask = rankMaskOf(board);
  const allMask = rankMaskOf([...board, ...hole]);
  if (straightHigh(allMask) >= 0) return 0;
  let outs = 0;
  for (let r = 0; r < 13; r++) {
    if (allMask & (1 << r)) continue;
    const h = straightHigh(allMask | (1 << r));
    if (h >= 0 && straightHigh(boardMask | (1 << r)) !== h) outs++;
  }
  return outs;
}

/** "AKs" / "QQ" / "T9o" for two card ids. */
export function handType([a, b]) {
  const hi = rank(a) >= rank(b) ? a : b;
  const lo = hi === a ? b : a;
  const R = RANKS;
  if (rank(hi) === rank(lo)) return R[rank(hi)] + R[rank(lo)];
  return R[rank(hi)] + R[rank(lo)] + (suit(hi) === suit(lo) ? 's' : 'o');
}

/** All 1326 two-card combos as [c1, c2] (c1 > c2). */
export const ALL_COMBOS = (() => {
  const out = [];
  for (let a = 51; a >= 0; a--) for (let b = a - 1; b >= 0; b--) out.push([a, b]);
  return out;
})();
