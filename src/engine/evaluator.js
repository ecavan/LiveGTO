/**
 * Poker hand evaluation — wraps pokersolver to replace Python's treys library.
 * Card representation: 2-char strings like 'Ah', 'Ks', '2d'.
 */
import { Hand } from 'pokersolver';

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

/** Get rank as 0-12 (2=0, A=12) */
export function rankInt(cardStr) {
  return RANKS.indexOf(cardStr[0]);
}

/** Get suit character */
export function suitChar(cardStr) {
  return cardStr[1];
}

/** Evaluate a hand (2 cards) + board (3-5 cards) using pokersolver */
export function evaluate(hand, board) {
  const cards = [...hand, ...board].map(c => {
    // pokersolver wants 'Ah' format — same as ours, but lowercase suit
    const r = c[0];
    const s = c[1];
    return r + s;
  });
  return Hand.solve(cards);
}

/**
 * Map pokersolver hand name to rank class 0-9 matching treys convention.
 * 0=Royal/Straight Flush, 1=Straight Flush, 2=Four of a Kind, 3=Full House,
 * 4=Flush, 5=Straight, 6=Three of a Kind, 7=Two Pair, 8=Pair, 9=High Card
 */
export function getRankClass(solved) {
  const name = solved.name || solved.descr;
  if (name === 'Royal Flush') return 0;
  if (name === 'Straight Flush') return 1;
  if (name === 'Four of a Kind') return 2;
  if (name === 'Full House') return 3;
  if (name === 'Flush') return 4;
  if (name === 'Straight') return 5;
  if (name === 'Three of a Kind') return 6;
  if (name === 'Two Pair') return 7;
  if (name === 'Pair') return 8;
  return 9; // High Card
}

/**
 * Compare two hands at showdown.
 * Returns 'first', 'second', or 'split'.
 */
export function compareHands(hand1, board1, hand2, board2) {
  const s1 = evaluate(hand1, board1);
  const s2 = evaluate(hand2, board2);
  const winners = Hand.winners([s1, s2]);
  if (winners.length === 2) return 'split';
  return winners[0] === s1 ? 'first' : 'second';
}

/** Create a shuffled 52-card deck (Fisher-Yates) */
export function createDeck() {
  const deck = [];
  for (const r of RANKS) {
    for (const s of SUITS) {
      deck.push(r + s);
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Draw n cards from a deck (mutates the deck) */
export function drawCards(deck, n) {
  return deck.splice(0, n);
}
