/**
 * Blocker analysis — detects when hero's cards block key villain holdings.
 */
import { rankInt, suitChar } from './evaluator.js';

const RANK_NAMES = { 12: 'A', 11: 'K', 10: 'Q', 9: 'J', 8: 'T', 7: '9', 6: '8', 5: '7', 4: '6', 3: '5', 2: '4', 1: '3', 0: '2' };
const PAIR_NAMES = { 12: 'AA', 11: 'KK', 10: 'QQ', 9: 'JJ' };

/**
 * Analyze blocker effects of hero's hand against the board.
 * @param {string[]} handStrs - Hero's 2 card strings (e.g. ['Ah', 'Kd'])
 * @param {string[]} boardStrs - Board card strings (3-5 cards)
 * @returns {Array<{type: string, text: string, impact: string}>}
 */
export function analyzeBlockers(handStrs, boardStrs) {
  if (!handStrs || !boardStrs || boardStrs.length < 3) return [];

  const insights = [];
  const handRanks = handStrs.map(c => rankInt(c));
  const handSuits = handStrs.map(c => suitChar(c));
  const boardRanks = boardStrs.map(c => rankInt(c));
  const boardSuits = boardStrs.map(c => suitChar(c));

  // 1. Flush / flush draw blockers
  const suitCounts = {};
  for (const s of boardSuits) suitCounts[s] = (suitCounts[s] || 0) + 1;
  for (const [suit, count] of Object.entries(suitCounts)) {
    if (count >= 2) {
      for (let h = 0; h < 2; h++) {
        if (handSuits[h] === suit) {
          const rank = handRanks[h];
          const cardStr = handStrs[h];
          if (rank === 12) {
            if (count >= 3) {
              insights.push({ type: 'flush', text: `Nut flush (${cardStr})`, impact: 'positive' });
            } else {
              insights.push({ type: 'flush_draw', text: `Block nut flush draw (${cardStr})`, impact: 'positive' });
            }
          } else if (rank === 11) {
            insights.push({ type: 'flush_draw', text: `Block K-high flush draw (${cardStr})`, impact: 'positive' });
          }
        }
      }
    }
  }

  // 2. Set blockers — hero holds a card matching a board rank
  const topBoardRank = Math.max(...boardRanks);
  for (let h = 0; h < 2; h++) {
    if (boardRanks.includes(handRanks[h])) {
      const pairName = PAIR_NAMES[handRanks[h]];
      if (pairName) {
        const isTop = handRanks[h] === topBoardRank;
        insights.push({
          type: 'set',
          text: `Block ${isTop ? 'top ' : ''}set (${pairName})`,
          impact: 'positive',
        });
      }
    }
  }

  // 3. Overpair blockers — hero holds an A or K above the board
  for (let h = 0; h < 2; h++) {
    const rank = handRanks[h];
    if (rank >= 11 && rank > topBoardRank && !boardRanks.includes(rank)) {
      const pairName = PAIR_NAMES[rank];
      if (pairName) {
        insights.push({ type: 'overpair', text: `Block ${pairName}`, impact: 'positive' });
      }
    }
  }

  // 4. Straight blockers — on connected boards, hero holds cards that block straights
  const sortedBoardRanks = [...boardRanks].sort((a, b) => a - b);
  const span = sortedBoardRanks[sortedBoardRanks.length - 1] - sortedBoardRanks[0];
  if (span <= 4 && boardStrs.length >= 3) {
    for (let h = 0; h < 2; h++) {
      const rank = handRanks[h];
      if (rank > topBoardRank && rank <= topBoardRank + 2 && rank >= 8) {
        insights.push({
          type: 'straight',
          text: `Block straight (${RANK_NAMES[rank]})`,
          impact: 'positive',
        });
      }
    }
  }

  // 5. Unblockers — hero does NOT block villain's strong hands

  // 5a. Flush draw unblock: two-tone+ board and hero has NO cards of flush suit
  for (const [suit, count] of Object.entries(suitCounts)) {
    if (count >= 2) {
      const heroHasSuit = handSuits[0] === suit || handSuits[1] === suit;
      if (!heroHasSuit) {
        if (count >= 3) {
          insights.push({ type: 'unblock_flush', text: `Don't block villain flushes (no ${suit})`, impact: 'negative' });
        } else {
          insights.push({ type: 'unblock_flush_draw', text: `Don't block flush draws (no ${suit})`, impact: 'negative' });
        }
      }
    }
  }

  // 5b. Set unblock: hero doesn't hold a card matching top board rank (J+)
  if (topBoardRank >= 9) {
    const heroMatchesTop = handRanks[0] === topBoardRank || handRanks[1] === topBoardRank;
    if (!heroMatchesTop) {
      const topName = RANK_NAMES[topBoardRank];
      insights.push({ type: 'unblock_set', text: `Don't block top set (${topName}${topName})`, impact: 'negative' });
    }
  }

  // 5c. Overpair unblock: board is 9-high or lower where overpairs dominate
  if (topBoardRank <= 7) {
    const heroHasA = handRanks[0] === 12 || handRanks[1] === 12;
    const heroHasK = handRanks[0] === 11 || handRanks[1] === 11;
    if (!heroHasA) {
      insights.push({ type: 'unblock_overpair', text: `Don't block AA`, impact: 'negative' });
    }
    if (!heroHasK) {
      insights.push({ type: 'unblock_overpair', text: `Don't block KK`, impact: 'negative' });
    }
  }

  // Deduplicate by type+text
  const seen = new Set();
  return insights.filter(i => {
    const key = i.type + i.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
