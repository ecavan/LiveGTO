/**
 * Context-aware hand bucketing using poker evaluator + board texture.
 * Classifies hands into 13 strength buckets.
 */
import { rankInt, suitChar, evaluate, getRankClass } from './evaluator.js';
import { classifyTexture } from './postflop.js';

export const PREMIUM = 'premium';
export const NUT = 'nut';
export const STRONG = 'strong';
export const TWO_PAIR = 'two_pair';
export const TOP_PAIR = 'top_pair';
export const OVERPAIR = 'overpair';
export const MID_PAIR = 'mid_pair';
export const UNDERPAIR = 'underpair';
export const NUT_DRAW = 'nut_draw';
export const DRAW = 'draw';
export const WEAK_MADE = 'weak_made';
export const GUTSHOT = 'gutshot';
export const AIR = 'air';

export const BUCKETS = [PREMIUM, NUT, STRONG, TWO_PAIR, TOP_PAIR, OVERPAIR,
  MID_PAIR, UNDERPAIR, NUT_DRAW, DRAW, WEAK_MADE, GUTSHOT, AIR];

export const BUCKET_LABELS = {
  [PREMIUM]: 'Premium (full house+, nut flush, top set dry)',
  [NUT]: 'Nut (set, K/Q-high flush)',
  [STRONG]: 'Strong (overpair QQ+, TPTK, straight)',
  [TWO_PAIR]: 'Two pair',
  [TOP_PAIR]: 'Top pair good kicker',
  [OVERPAIR]: 'Overpair (TT-JJ)',
  [MID_PAIR]: 'Mid pair / TP weak kicker',
  [UNDERPAIR]: 'Underpair (88-99, pocket pair < board)',
  [NUT_DRAW]: 'Nut draw (combo draw, nut FD)',
  [DRAW]: 'Draw (flush draw, OESD)',
  [WEAK_MADE]: 'Weak made (bottom pair)',
  [GUTSHOT]: 'Gutshot / backdoor / overcards',
  [AIR]: 'Air (nothing)',
};

export const BUCKET_EXAMPLES = {
  [PREMIUM]: ['AA on A72r', 'Full house+', 'Nut flush (Ah on 3-flush)', 'Top set on dry'],
  [NUT]: ['Non-top set (e.g. 77 on K72)', 'K/Q-high flush', 'Top set on wet'],
  [STRONG]: ['QQ+ overpair', 'TPTK (e.g. AK on K94)', '2-card straight', 'Trips'],
  [TWO_PAIR]: ['Top two pair', 'Bottom two pair', 'One-card straight'],
  [TOP_PAIR]: ['TP + J+ kicker (e.g. KJ on K85)', 'TP + A kicker'],
  [OVERPAIR]: ['TT-JJ overpair'],
  [MID_PAIR]: ['Second pair', 'TP weak kicker (e.g. K7 on K94)', 'Middle pair'],
  [UNDERPAIR]: ['88-99 overpair below QQ', 'Pocket pair < top board card'],
  [NUT_DRAW]: ['Combo draw (FD+OESD)', 'Nut flush draw + gutshot'],
  [DRAW]: ['Flush draw (4 to flush)', 'Open-ended straight draw (8 outs)'],
  [WEAK_MADE]: ['Bottom pair', 'Underpair below 2nd board card'],
  [GUTSHOT]: ['Gutshot (4 outs)', 'Backdoor flush draw', 'K+ overcard'],
  [AIR]: ['No pair, no draw', 'Missed completely'],
};

function countBy(arr) {
  const counts = {};
  for (const item of arr) counts[item] = (counts[item] || 0) + 1;
  return counts;
}

/**
 * Classify hand into one of 13 buckets.
 * @param {string[]} hand - 2 card strings
 * @param {string[]} board - 3-5 card strings
 * @param {string} [texture] - board texture (computed if not provided)
 */
export function classifyHand(hand, board, texture) {
  if (!texture) texture = classifyTexture(board);

  const solved = evaluate(hand, board);
  const rankClass = getRankClass(solved);

  if (rankClass <= 1) return PREMIUM;
  if (rankClass === 2) return PREMIUM;
  if (rankClass === 3) return PREMIUM;
  if (rankClass === 4) return _classifyFlush(hand, board);
  if (rankClass === 5) return _classifyStraight(hand, board);
  if (rankClass === 6) return _classifyTrips(hand, board);
  if (rankClass === 7) return TWO_PAIR;
  if (rankClass === 8) return _classifyPair(hand, board);
  return _classifyUnmade(hand, board);
}

function _classifyFlush(hand, board) {
  const allCards = [...hand, ...board];
  const suits = allCards.map(c => suitChar(c));
  const suitCounts = countBy(suits);
  const flushSuit = Object.entries(suitCounts).reduce((a, b) => b[1] > a[1] ? b : a)[0];

  const heroFlushRanks = hand
    .filter(c => suitChar(c) === flushSuit)
    .map(c => rankInt(c));

  if (heroFlushRanks.length === 0) return MID_PAIR;

  const bestHero = Math.max(...heroFlushRanks);
  if (bestHero === 12) return PREMIUM;
  if (bestHero >= 10) return NUT;
  return STRONG;
}

function _classifyStraight(hand, board) {
  const handRanks = hand.map(c => rankInt(c)).sort((a, b) => b - a);
  const boardRanks = board.map(c => rankInt(c)).sort((a, b) => b - a);
  const usesBoth = !handRanks.some(hr => boardRanks.includes(hr));

  if (usesBoth) return STRONG;
  return TWO_PAIR;
}

function _classifyTrips(hand, board) {
  const handRanks = hand.map(c => rankInt(c));
  const boardRanks = board.map(c => rankInt(c)).sort((a, b) => b - a);
  const topBoard = boardRanks[0];
  const isSet = handRanks[0] === handRanks[1];

  if (isSet) {
    const tripRank = handRanks[0];
    if (tripRank === topBoard) return PREMIUM;
    return NUT;
  }
  return STRONG;
}

function _classifyPair(hand, board) {
  const handRanks = hand.map(c => rankInt(c)).sort((a, b) => b - a);
  const boardRanks = board.map(c => rankInt(c)).sort((a, b) => b - a);
  const topBoard = boardRanks[0];
  const secondBoard = boardRanks.length > 1 ? boardRanks[1] : -1;
  const thirdBoard = boardRanks.length > 2 ? boardRanks[2] : -1;

  // Overpair
  if (handRanks[0] === handRanks[1] && handRanks[0] > topBoard) {
    const pairRank = handRanks[0];
    if (pairRank >= 10) return STRONG;    // QQ, KK, AA
    if (pairRank >= 8)  return OVERPAIR;  // TT, JJ
    return UNDERPAIR;                      // 99 and below
  }

  // Top pair
  if (handRanks[0] === topBoard || handRanks[1] === topBoard) {
    const kicker = handRanks[1] === topBoard ? handRanks[0] : handRanks[1];
    if (kicker >= 9) return TOP_PAIR;     // J+ kicker
    return MID_PAIR;                       // Weak kicker
  }

  // Middle pair
  if (handRanks[0] === secondBoard || handRanks[1] === secondBoard) {
    const draw = _checkDraws(hand, board);
    if (draw === DRAW || draw === NUT_DRAW) return draw;
    return MID_PAIR;
  }

  // Bottom pair
  if (handRanks[0] === thirdBoard || handRanks[1] === thirdBoard) {
    return WEAK_MADE;
  }

  // Underpair
  if (handRanks[0] === handRanks[1] && handRanks[0] < topBoard) {
    if (handRanks[0] > secondBoard) return UNDERPAIR;
    return WEAK_MADE;
  }

  // Small pair with a draw
  const draw = _checkDraws(hand, board);
  if (draw) return draw;
  return WEAK_MADE;
}

function _classifyUnmade(hand, board) {
  const draw = _checkDraws(hand, board);
  if (draw) return draw;

  const handRanks = hand.map(c => rankInt(c)).sort((a, b) => b - a);
  const boardRanks = board.map(c => rankInt(c)).sort((a, b) => b - a);
  if (handRanks[0] > boardRanks[0]) {
    return handRanks[0] >= 11 ? GUTSHOT : AIR;
  }
  return AIR;
}

function _checkDraws(hand, board) {
  const allCards = [...hand, ...board];
  const suits = allCards.map(c => suitChar(c));
  const ranks = [...new Set(allCards.map(c => rankInt(c)))].sort((a, b) => a - b);

  const suitCounts = countBy(suits);
  const hasFlushDraw = Object.values(suitCounts).some(c => c === 4);
  const hasOesd = _hasOpenEnded(ranks);
  const hasGutshot = _hasGutshot(ranks);

  if (hasFlushDraw && (hasOesd || hasGutshot)) return NUT_DRAW;
  if (hasFlushDraw) return DRAW;
  if (hasOesd) return DRAW;
  if (hasGutshot) return GUTSHOT;

  // Backdoor flush (flop only)
  if (board.length === 3) {
    if (Object.values(suitCounts).some(c => c === 3)) return GUTSHOT;
  }

  return null;
}

function _hasOpenEnded(sortedRanks) {
  const extended = [...sortedRanks];
  if (extended.includes(12)) extended.unshift(-1);
  for (let i = 0; i <= extended.length - 4; i++) {
    if (extended[i + 3] - extended[i] === 3) {
      const low = extended[i], high = extended[i + 3];
      if (low > -1 && high < 12) return true;
    }
  }
  return false;
}

function _hasGutshot(sortedRanks) {
  const extended = [...sortedRanks];
  if (extended.includes(12)) extended.unshift(-1);
  for (let i = 0; i <= extended.length - 4; i++) {
    if (extended[i + 3] - extended[i] === 4) return true;
  }
  return false;
}
