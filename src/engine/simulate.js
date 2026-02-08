/**
 * Simulate mode — heads-up session with imperfect AI villain.
 */
import { createDeck, drawCards, compareHands } from './evaluator.js';
import { handToKey, cardToDisplay } from './cards.js';
import { RFI_RANGES, FACING_OPEN, FACING_OPEN_KEYS } from './ranges.js';
import { classifyHand } from './abstraction.js';
import { classifyTexture, getStrategy, getCorrectActions } from './postflop.js';

export const OPEN_RAISE = 2.5;
export const THREE_BET = 8.0;
export const BET_SIZES = { bet_s: 0.33, bet_m: 0.66, bet_l: 1.0 };

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function weightedChoice(actions, probs) {
  const total = probs.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < actions.length; i++) {
    r -= probs[i];
    if (r <= 0) return actions[i];
  }
  return actions[actions.length - 1];
}

export function generateSimHand(heroStack, villainStack, handNumber, heroIsSb) {
  const deck = createDeck();
  const heroHand = drawCards(deck, 2);
  const villainHand = drawCards(deck, 2);
  const board = drawCards(deck, 5);

  const heroHandCards = heroHand.map(cardToDisplay);
  const villainHandCards = villainHand.map(cardToDisplay);
  const boardCards = board.map(cardToDisplay);

  const heroHandKey = handToKey(heroHand[0], heroHand[1]);
  const villainHandKey = handToKey(villainHand[0], villainHand[1]);

  const sbAmount = 0.5, bbAmount = 1.0;
  let heroInvested, villainInvested, heroPosition, villainPosition;
  if (heroIsSb) {
    heroInvested = sbAmount; villainInvested = bbAmount;
    heroPosition = 'SB'; villainPosition = 'BB';
  } else {
    heroInvested = bbAmount; villainInvested = sbAmount;
    heroPosition = 'BB'; villainPosition = 'SB';
  }

  return {
    hero_stack: heroStack - heroInvested,
    villain_stack: villainStack - villainInvested,
    pot: sbAmount + bbAmount,
    hand_number: handNumber,
    hero_is_sb: heroIsSb,
    hero_position: heroPosition,
    villain_position: villainPosition,
    hero_hand_strs: heroHand,
    villain_hand_strs: villainHand,
    board_strs: board,
    hero_hand: heroHandCards,
    villain_hand: villainHandCards,
    board_cards: boardCards,
    hero_hand_key: heroHandKey,
    villain_hand_key: villainHandKey,
    street: 'preflop',
    board_visible: 0,
    street_to_act: heroIsSb ? 'hero' : 'villain',
    street_bet: 0.0,
    hero_street_invested: 0.0,
    villain_street_invested: 0.0,
    hero_total_invested: heroInvested,
    villain_total_invested: villainInvested,
    sim_phase: 'preflop_decision',
    villain_last_action: null,
    session_log: [],
    current_hand_actions: [],
    hand_over: false,
    winner: null,
  };
}

export function villainPreflopAct(handKey, position, facingRaise = false, noise = 0.30) {
  if (Math.random() < noise) {
    return facingRaise ? pick(['call', 'fold', 'raise']) : pick(['raise', 'fold']);
  }
  if (facingRaise) {
    const matchups = FACING_OPEN_KEYS.filter(([h]) => h === position);
    if (matchups.length) {
      const [heroP, openerP] = matchups[0];
      const key = `${heroP}|${openerP}`;
      const ranges = FACING_OPEN[key];
      if (ranges.raise.has(handKey)) return 'raise';
      if (ranges.call.has(handKey)) return 'call';
    }
    return 'fold';
  }
  const rfiPos = RFI_RANGES[position] ? position : 'BTN';
  return RFI_RANGES[rfiPos].has(handKey) ? 'raise' : 'fold';
}

export function villainPostflopAct(handStrs, boardStrs, position, facingBet = false, noise = 0.30) {
  const texture = classifyTexture(boardStrs);
  const bucket = classifyHand(handStrs, boardStrs, texture);
  const strategy = getStrategy(position, texture, bucket, facingBet);

  if (Math.random() < noise) {
    return facingBet ? pick(['call', 'fold', 'raise']) : pick(['check', 'bet_m']);
  }

  const actions = Object.keys(strategy);
  const probs = Object.values(strategy);
  const total = probs.reduce((a, b) => a + b, 0);
  if (total === 0) return facingBet ? 'fold' : 'check';

  return weightedChoice(actions, probs);
}

export function resolveShowdown(heroHandStrs, villainHandStrs, boardStrs) {
  const result = compareHands(heroHandStrs, boardStrs, villainHandStrs, boardStrs);
  if (result === 'first') return 'hero';
  if (result === 'second') return 'villain';
  return 'split';
}

export function getHeroGtoAction(handKey, position, street, handStrs = null, boardStrs = null, facingBet = false) {
  if (street === 'preflop') {
    if (facingBet) {
      const matchups = FACING_OPEN_KEYS.filter(([h]) => h === position);
      if (matchups.length) {
        const [, opener] = matchups[0];
        const key = `${position}|${opener}`;
        const ranges = FACING_OPEN[key];
        if (ranges.raise.has(handKey)) return 'raise';
        if (ranges.call.has(handKey)) return 'call';
      }
      return 'fold';
    }
    const rfiPos = RFI_RANGES[position] ? position : 'BTN';
    return RFI_RANGES[rfiPos].has(handKey) ? 'raise' : 'fold';
  }
  if (handStrs && boardStrs) {
    const postflopPos = (position === 'SB' || position === 'BTN') ? 'IP' : 'OOP';
    const texture = classifyTexture(boardStrs);
    const bucket = classifyHand(handStrs, boardStrs, texture);
    const strategy = getStrategy(postflopPos, texture, bucket, facingBet);
    const correct = getCorrectActions(strategy);
    return correct[0] || 'check';
  }
  return 'check';
}

export function computeDeviation(heroAction, gtoAction, strategy = null) {
  if (heroAction === gtoAction) return 0.0;
  if (strategy) {
    const heroFreq = strategy[heroAction] || 0;
    const maxFreq = Math.max(...Object.values(strategy));
    if (maxFreq > 0) return 1.0 - (heroFreq / maxFreq);
  }
  return 1.0;
}

export function computeSessionReview(sessionLog) {
  if (!sessionLog.length) {
    return { total_pl: 0, hands_played: 0, bb_per_hand: 0, biggest_win: 0, biggest_loss: 0, top_mistakes: [] };
  }
  const totalPl = sessionLog.reduce((sum, h) => sum + (h.result_bb || 0), 0);
  const handsPlayed = sessionLog.length;
  const bbPerHand = totalPl / handsPlayed;
  const results = sessionLog.map(h => h.result_bb || 0);

  const allDeviations = [];
  for (const hand of sessionLog) {
    for (const rec of (hand.actions || [])) {
      if ((rec.deviation || 0) > 0.3) {
        allDeviations.push({
          hand_num: hand.hand_num || 0,
          hero_hand: hand.hero_hand_key || '?',
          street: rec.street || '?',
          hero_action: rec.action || '?',
          gto_action: rec.gto_action || '?',
          deviation: rec.deviation,
        });
      }
    }
  }
  allDeviations.sort((a, b) => b.deviation - a.deviation);

  return {
    total_pl: Math.round(totalPl * 10) / 10,
    hands_played: handsPlayed,
    bb_per_hand: Math.round(bbPerHand * 100) / 100,
    biggest_win: Math.round(Math.max(...results) * 10) / 10,
    biggest_loss: Math.round(Math.min(...results) * 10) / 10,
    top_mistakes: allDeviations.slice(0, 5),
  };
}

export function applyBetAmount(pot, action) {
  if (action in BET_SIZES) return Math.round(pot * BET_SIZES[action] * 10) / 10;
  if (action === 'raise') return Math.round(pot * 0.75 * 10) / 10;
  return 0;
}
