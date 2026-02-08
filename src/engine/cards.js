/**
 * Card display utilities — converts string cards to display objects.
 */
import { createDeck, drawCards, rankInt } from './evaluator.js';

const SUIT_SYMBOLS = { s: '\u2660', h: '\u2665', d: '\u2666', c: '\u2663' };
const SUIT_COLORS  = { s: 'black', h: 'red', d: 'red', c: 'black' };

/** Convert card string ('Ah') to display object for rendering */
export function cardToDisplay(cardStr) {
  const rank = cardStr[0];
  const suit = cardStr[1];
  return {
    rank,
    suit,
    suit_symbol: SUIT_SYMBOLS[suit],
    color: SUIT_COLORS[suit],
    str: cardStr,
  };
}

/** Convert two hole card strings to canonical preflop key like 'AKs', 'QJo', '88' */
export function handToKey(card1, card2) {
  const RANK_ORDER = '23456789TJQKA';
  const r1 = RANK_ORDER.indexOf(card1[0]);
  const r2 = RANK_ORDER.indexOf(card2[0]);
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);
  const highC = RANK_ORDER[high];
  const lowC = RANK_ORDER[low];
  if (high === low) return `${highC}${lowC}`;
  if (card1[1] === card2[1]) return `${highC}${lowC}s`;
  return `${highC}${lowC}o`;
}

/** Deal hole cards and optional board cards. Returns {hand, board, deck} */
export function dealHand(numBoard = 0) {
  const deck = createDeck();
  const hand = drawCards(deck, 2);
  const board = numBoard > 0 ? drawCards(deck, numBoard) : [];
  return { hand, board, deck };
}
