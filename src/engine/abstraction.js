/**
 * Context-aware hand bucketing using poker evaluator + board texture.
 * Classifies hands into 9 strength buckets.
 */
import { rankInt, suitChar, evaluate, getRankClass } from './evaluator.js';
import { classifyTexture } from './postflop.js';

export const PREMIUM = 'premium';
export const NUT = 'nut';
export const STRONG = 'strong';
export const GOOD = 'good';
export const MEDIUM = 'medium';
export const DRAW = 'draw';
export const WEAK_MADE = 'weak_made';
export const WEAK_DRAW = 'weak_draw';
export const AIR = 'air';

export const BUCKETS = [PREMIUM, NUT, STRONG, GOOD, MEDIUM, DRAW, WEAK_MADE, WEAK_DRAW, AIR];

export const BUCKET_LABELS = {
  [PREMIUM]: 'Premium (top set dry, nut flush, full house+)',
  [NUT]: 'Nut (set, flush, top two, combo draw)',
  [STRONG]: 'Strong (overpair QQ+, TPTK, straight)',
  [GOOD]: 'Good (overpair TT-JJ, TP good kicker)',
  [MEDIUM]: 'Medium (low overpair, TP weak kicker, mid pair)',
  [DRAW]: 'Draw (flush draw, OESD)',
  [WEAK_MADE]: 'Weak made (bottom pair, underpair)',
  [WEAK_DRAW]: 'Weak draw (gutshot, backdoor)',
  [AIR]: 'Air (nothing)',
};

export const BUCKET_EXAMPLES = {
  [PREMIUM]: ['AA on A72r', 'KK on K83r', 'Full house+', 'Nut flush (Ah on 3-flush)'],
  [NUT]: ['Set (e.g. 77 on 7T2)', 'Non-nut flush', 'Top two pair', 'Combo draw (FD+OESD)'],
  [STRONG]: ['QQ+ overpair on wet', 'TPTK (e.g. AK on K94)', 'Straight using both cards'],
  [GOOD]: ['TT-JJ overpair', 'TP good kicker (e.g. KQ on K85)', 'One-card straight'],
  [MEDIUM]: ['Low overpair (88-99)', 'TP weak kicker (e.g. K7 on K94)', 'Middle pair'],
  [DRAW]: ['Flush draw (4 to flush)', 'Open-ended straight draw (8 outs)'],
  [WEAK_MADE]: ['Bottom pair', 'Underpair below 2nd board card', 'Pocket pair < board'],
  [WEAK_DRAW]: ['Gutshot (4 outs)', 'Backdoor flush draw', 'A/K overcard'],
  [AIR]: ['No pair, no draw', 'Missed completely'],
};

function countBy(arr) {
  const counts = {};
  for (const item of arr) counts[item] = (counts[item] || 0) + 1;
  return counts;
}

/**
 * Classify hand into one of 9 buckets.
 * @param {string[]} hand - 2 card strings
 * @param {string[]} board - 3-5 card strings
 * @param {string} [texture] - board texture (computed if not provided)
 */
export function classifyHand(hand, board, texture) {
  if (!texture) texture = classifyTexture(board);

  const solved = evaluate(hand, board);
  const rankClass = getRankClass(solved);

  if (rankClass <= 1) return PREMIUM; // Royal/straight flush
  if (rankClass === 2) return PREMIUM; // Quads
  if (rankClass === 3) return PREMIUM; // Full house
  if (rankClass === 4) return _classifyFlush(hand, board, texture);
  if (rankClass === 5) return _classifyStraight(hand, board, texture);
  if (rankClass === 6) return _classifyTrips(hand, board, texture);
  if (rankClass === 7) return _classifyTwoPair(hand, board, texture);
  if (rankClass === 8) return _classifyPair(hand, board, texture);
  return _classifyUnmade(hand, board, texture);
}

function _classifyFlush(hand, board, texture) {
  const allCards = [...hand, ...board];
  const suits = allCards.map(c => suitChar(c));
  const suitCounts = countBy(suits);
  const flushSuit = Object.entries(suitCounts).reduce((a, b) => b[1] > a[1] ? b : a)[0];

  const heroFlushRanks = hand
    .filter(c => suitChar(c) === flushSuit)
    .map(c => rankInt(c));

  if (heroFlushRanks.length === 0) return GOOD; // Board flush

  const bestHero = Math.max(...heroFlushRanks);
  if (bestHero === 12) return PREMIUM; // Ace-high flush
  if (bestHero >= 10) return NUT;      // King/Queen-high flush
  return STRONG;                        // Low flush
}

function _classifyStraight(hand, board, texture) {
  const handRanks = hand.map(c => rankInt(c)).sort((a, b) => b - a);
  const boardRanks = board.map(c => rankInt(c)).sort((a, b) => b - a);
  const usesBoth = _straightUsesBoth(handRanks, boardRanks);
  const isWet = texture === 'wet' || texture === 'monotone';

  if (usesBoth) return isWet ? STRONG : NUT;
  return isWet ? GOOD : STRONG;
}

function _straightUsesBoth(handRanks, boardRanks) {
  return !handRanks.some(hr => boardRanks.includes(hr));
}

function _classifyTrips(hand, board, texture) {
  const handRanks = hand.map(c => rankInt(c));
  const boardRanks = board.map(c => rankInt(c)).sort((a, b) => b - a);
  const topBoard = boardRanks[0];
  const isSet = handRanks[0] === handRanks[1];
  const isScary = texture === 'wet' || texture === 'monotone';

  let tripRank = null;
  if (isSet) {
    tripRank = handRanks[0];
  } else {
    const boardRankCounts = countBy(boardRanks);
    for (const [r, cnt] of Object.entries(boardRankCounts)) {
      if (cnt >= 2 && handRanks.includes(Number(r))) { tripRank = Number(r); break; }
      if (cnt >= 2) { tripRank = Number(r); break; }
    }
  }

  if (isSet) {
    if (tripRank === topBoard) return isScary ? NUT : PREMIUM;
    return isScary ? STRONG : NUT;
  }
  return isScary ? GOOD : STRONG;
}

function _classifyTwoPair(hand, board, texture) {
  const handRanks = hand.map(c => rankInt(c)).sort((a, b) => b - a);
  const boardRanks = board.map(c => rankInt(c)).sort((a, b) => b - a);
  const topBoard = boardRanks[0];
  const secondBoard = boardRanks.length > 1 ? boardRanks[1] : 0;
  const isScary = texture === 'wet' || texture === 'monotone';

  const heroPaired = handRanks.filter(hr => boardRanks.includes(hr));

  if (heroPaired.length >= 2) {
    if (handRanks[0] === topBoard && handRanks[1] === secondBoard) {
      return isScary ? STRONG : NUT;
    }
    if (handRanks[0] === topBoard || handRanks[1] === topBoard) {
      return isScary ? GOOD : STRONG;
    }
    return isScary ? GOOD : STRONG;
  }
  return isScary ? GOOD : STRONG;
}

function _classifyPair(hand, board, texture) {
  const handRanks = hand.map(c => rankInt(c)).sort((a, b) => b - a);
  const boardRanks = board.map(c => rankInt(c)).sort((a, b) => b - a);
  const topBoard = boardRanks[0];
  const secondBoard = boardRanks.length > 1 ? boardRanks[1] : -1;
  const thirdBoard = boardRanks.length > 2 ? boardRanks[2] : -1;
  const isScary = texture === 'wet' || texture === 'monotone';

  // Overpair
  if (handRanks[0] === handRanks[1] && handRanks[0] > topBoard) {
    const pairRank = handRanks[0];
    if (pairRank >= 10) return isScary ? GOOD : STRONG;      // QQ, KK, AA
    if (pairRank >= 8)  return isScary ? MEDIUM : GOOD;       // TT, JJ
    return MEDIUM;                                              // 99 and below
  }

  // Top pair
  if (handRanks[0] === topBoard || handRanks[1] === topBoard) {
    const kicker = handRanks[1] === topBoard ? handRanks[0] : handRanks[1];
    if (kicker >= 12) return isScary ? GOOD : STRONG;         // TPTK
    if (kicker >= 9)  return isScary ? MEDIUM : GOOD;          // TP good kicker
    return MEDIUM;                                              // TP weak kicker
  }

  // Middle pair
  if (handRanks[0] === secondBoard || handRanks[1] === secondBoard) {
    const draw = _checkDraws(hand, board);
    if (draw === DRAW) return DRAW;
    return isScary ? WEAK_MADE : MEDIUM;
  }

  // Bottom pair
  if (handRanks[0] === thirdBoard || handRanks[1] === thirdBoard) {
    return WEAK_MADE;
  }

  // Underpair
  if (handRanks[0] === handRanks[1] && handRanks[0] < topBoard) {
    if (handRanks[0] > secondBoard) return MEDIUM;
    return WEAK_MADE;
  }

  // Small pair with a draw
  const draw = _checkDraws(hand, board);
  if (draw) return draw;
  return WEAK_MADE;
}

function _classifyUnmade(hand, board, texture) {
  const draw = _checkDraws(hand, board);
  if (draw) return draw;

  const handRanks = hand.map(c => rankInt(c)).sort((a, b) => b - a);
  const boardRanks = board.map(c => rankInt(c)).sort((a, b) => b - a);
  if (handRanks[0] > boardRanks[0]) {
    return handRanks[0] >= 11 ? WEAK_DRAW : AIR; // K+ overcards
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

  if (hasFlushDraw && (hasOesd || hasGutshot)) return NUT; // Combo draw
  if (hasFlushDraw) return DRAW;
  if (hasOesd) return DRAW;
  if (hasGutshot) return WEAK_DRAW;

  // Backdoor flush (flop only)
  if (board.length === 3) {
    if (Object.values(suitCounts).some(c => c === 3)) return WEAK_DRAW;
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
