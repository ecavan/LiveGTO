/**
 * Random scenario generators for all game modes.
 */
import { createDeck, drawCards, rankInt } from './evaluator.js';
import { cardToDisplay, handToKey } from './cards.js';
import { POSITIONS, RFI_RANGES, FACING_OPEN, FACING_OPEN_KEYS } from './ranges.js';
import { classifyHand, BUCKET_LABELS, BUCKETS } from './abstraction.js';
import { classifyTexture, getStrategy, getCorrectActions, ACTION_LABELS, TEXTURE_LABELS } from './postflop.js';

const POSITION_ORDER = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB'];
const IP_POSITIONS = new Set(['BTN', 'CO']);

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export function buildSeats(heroPosition, heroHandCards = null, activePositions = null) {
  const heroIdx = POSITION_ORDER.indexOf(heroPosition);
  const seats = [];
  let dealerSeat = 0;
  for (let i = 0; i < 6; i++) {
    const pos = POSITION_ORDER[(heroIdx + i) % 6];
    const isHero = i === 0;
    const isActive = activePositions ? activePositions.has(pos) || isHero : true;
    seats.push({
      position: pos,
      is_hero: isHero,
      is_active: isActive,
      cards: isHero ? heroHandCards : null,
    });
    if (pos === 'BTN') dealerSeat = i;
  }
  return { seats, dealerSeat };
}

export function generatePreflopRfi(position = null) {
  if (!position || !RFI_RANGES[position]) {
    position = pick(['UTG', 'MP', 'CO', 'BTN', 'SB']);
  }
  const deck = createDeck();
  const hand = drawCards(deck, 2);
  const handKey = handToKey(hand[0], hand[1]);
  const isRaise = RFI_RANGES[position].has(handKey);
  const correct = isRaise ? 'raise' : 'fold';
  const handCards = hand.map(cardToDisplay);
  const { seats, dealerSeat } = buildSeats(position, handCards);

  return {
    type: 'preflop_rfi', position, opener: '',
    situation: `RFI from ${position}`,
    hand: handCards, hand_key: handKey,
    correct_action: correct,
    range: [...RFI_RANGES[position]].sort(),
    raise_range: null, call_range: null,
    range_size: RFI_RANGES[position].size,
    actions: ['raise', 'fold'],
    action_labels: { raise: 'Raise', fold: 'Fold' },
    seats, dealer_seat: dealerSeat, board: [],
  };
}

export function generatePreflopFacing(position = null) {
  let matchups = FACING_OPEN_KEYS;
  if (position) {
    const filtered = matchups.filter(([h]) => h === position);
    if (filtered.length) matchups = filtered;
  }
  const [heroPos, openerPos] = pick(matchups);
  const deck = createDeck();
  const hand = drawCards(deck, 2);
  const handKey = handToKey(hand[0], hand[1]);
  const key = `${heroPos}|${openerPos}`;
  const ranges = FACING_OPEN[key];

  let correct;
  if (ranges.raise.has(handKey)) correct = 'raise';
  else if (ranges.call.has(handKey)) correct = 'call';
  else correct = 'fold';

  const handCards = hand.map(cardToDisplay);
  const active = new Set([heroPos, openerPos]);
  const { seats, dealerSeat } = buildSeats(heroPos, handCards, active);

  return {
    type: 'preflop_facing', position: heroPos, opener: openerPos,
    situation: `${heroPos} vs ${openerPos} open`,
    hand: handCards, hand_key: handKey,
    correct_action: correct,
    raise_range: [...ranges.raise].sort(),
    call_range: [...ranges.call].sort(),
    range: [...new Set([...ranges.raise, ...ranges.call])].sort(),
    range_size: ranges.raise.size + ranges.call.size,
    actions: ['raise', 'call', 'fold'],
    action_labels: { raise: '3-Bet', call: 'Call', fold: 'Fold' },
    seats, dealer_seat: dealerSeat, board: [],
  };
}

export function generatePreflop(position = null) {
  return Math.random() < 0.5 ? generatePreflopRfi(position) : generatePreflopFacing(position);
}

export function generatePostflop(position = null, texture = null) {
  if (position !== 'OOP' && position !== 'IP') position = pick(['OOP', 'IP']);

  let hand, board, actualTexture;
  for (let i = 0; i < 100; i++) {
    const deck = createDeck();
    hand = drawCards(deck, 2);
    board = drawCards(deck, 3);
    actualTexture = classifyTexture(board);
    if (!texture || actualTexture === texture) break;
  }
  texture = actualTexture;
  const bucket = classifyHand(hand, board, texture);
  const facingBet = Math.random() < 0.3;
  const strategy = getStrategy(position, texture, bucket, facingBet);
  const correctActions = getCorrectActions(strategy);

  let actions, actionLabels, situation;
  if (facingBet) {
    actions = ['fold', 'call', 'raise'];
    actionLabels = { fold: 'Fold', call: 'Call', raise: 'Raise' };
    situation = `${position} facing bet on ${texture.replace(/_/g, ' ')} board`;
  } else if (position === 'OOP') {
    actions = ['check', 'bet_s', 'bet_m', 'bet_l'];
    actionLabels = { check: 'Check', bet_s: 'Bet 33%', bet_m: 'Bet 66%', bet_l: 'Bet 100%' };
    situation = `OOP first to act on ${texture.replace(/_/g, ' ')} board`;
  } else {
    actions = ['check', 'bet_s', 'bet_m', 'bet_l'];
    actionLabels = { check: 'Check', bet_s: 'Bet 33%', bet_m: 'Bet 66%', bet_l: 'Bet 100%' };
    situation = `IP after check on ${texture.replace(/_/g, ' ')} board`;
  }

  const rangeBreakdown = {};
  for (const b of BUCKETS) {
    rangeBreakdown[b] = getStrategy(position, texture, b, facingBet);
  }

  const handCards = hand.map(cardToDisplay);
  const boardCards = board.map(cardToDisplay);
  let heroPos, villainPos;
  if (position === 'OOP') {
    heroPos = pick(['UTG', 'MP', 'SB', 'BB']);
    villainPos = pick(['CO', 'BTN']);
  } else {
    heroPos = pick(['CO', 'BTN']);
    villainPos = pick(['UTG', 'MP', 'SB', 'BB']);
  }
  const active = new Set([heroPos, villainPos]);
  const { seats, dealerSeat } = buildSeats(heroPos, handCards, active);
  const pot = pick([6, 8, 10, 12, 15, 20]);

  let bets = null;
  if (facingBet) {
    const villainSeatIdx = seats.findIndex(s => s.position === villainPos);
    const betSize = pick([3, 4, 5, 6, 7]);
    bets = { [villainSeatIdx]: `${betSize} BB` };
  }

  return {
    type: 'postflop', position, situation, facing_bet: facingBet,
    hand: handCards, hand_key: handToKey(hand[0], hand[1]),
    board: boardCards, texture, texture_label: TEXTURE_LABELS[texture],
    bucket, bucket_label: BUCKET_LABELS[bucket],
    strategy, correct_actions: correctActions,
    actions, action_labels: actionLabels,
    range_breakdown: rangeBreakdown,
    pot, seats, dealer_seat: dealerSeat, bets,
  };
}

export function computeStreetData(hand, board, position) {
  const texture = classifyTexture(board);
  const bucket = classifyHand(hand, board, texture);
  const facingBet = Math.random() < 0.3;
  const strategy = getStrategy(position, texture, bucket, facingBet);
  const correctActions = getCorrectActions(strategy);

  let actions, actionLabels, situation;
  if (facingBet) {
    actions = ['fold', 'call', 'raise'];
    actionLabels = { fold: 'Fold', call: 'Call', raise: 'Raise' };
    situation = `${position} facing bet`;
  } else if (position === 'OOP') {
    actions = ['check', 'bet_s', 'bet_m', 'bet_l'];
    actionLabels = { check: 'Check', bet_s: 'Bet 33%', bet_m: 'Bet 66%', bet_l: 'Bet 100%' };
    situation = 'OOP first to act';
  } else {
    actions = ['check', 'bet_s', 'bet_m', 'bet_l'];
    actionLabels = { check: 'Check', bet_s: 'Bet 33%', bet_m: 'Bet 66%', bet_l: 'Bet 100%' };
    situation = 'IP after check';
  }

  const rangeBreakdown = {};
  for (const b of BUCKETS) {
    rangeBreakdown[b] = getStrategy(position, texture, b, facingBet);
  }

  return {
    texture, texture_label: TEXTURE_LABELS[texture],
    bucket, bucket_label: BUCKET_LABELS[bucket],
    strategy, correct_actions: correctActions,
    postflop_actions: actions, postflop_action_labels: actionLabels,
    postflop_situation: situation,
    range_breakdown: rangeBreakdown, facing_bet: facingBet,
  };
}

export function generatePlayScenario(position = null) {
  const deck = createDeck();
  const hand = drawCards(deck, 2);
  const board = drawCards(deck, 5);
  const handCards = hand.map(cardToDisplay);
  const boardCards = board.map(cardToDisplay);
  const handKey = handToKey(hand[0], hand[1]);

  if (!position || !POSITION_ORDER.includes(position)) {
    position = pick(POSITION_ORDER);
  }

  // Preflop data
  const facingMatchups = FACING_OPEN_KEYS.filter(([h]) => h === position);
  let preflopType, preflopSituation, preflopCorrect, preflopActions, preflopActionLabels;
  let preflopRange, preflopRaiseRange, preflopCallRange, preflopRangeSize, openerPos;

  if (facingMatchups.length && Math.random() < 0.5) {
    const [heroP, openerP] = pick(facingMatchups);
    openerPos = openerP;
    const key = `${heroP}|${openerP}`;
    const ranges = FACING_OPEN[key];
    preflopCorrect = ranges.raise.has(handKey) ? 'raise' : ranges.call.has(handKey) ? 'call' : 'fold';
    preflopType = 'preflop_facing';
    preflopSituation = `${heroP} vs ${openerP} open`;
    preflopActions = ['raise', 'call', 'fold'];
    preflopActionLabels = { raise: '3-Bet', call: 'Call', fold: 'Fold' };
    preflopRange = [...new Set([...ranges.raise, ...ranges.call])].sort();
    preflopRaiseRange = [...ranges.raise].sort();
    preflopCallRange = [...ranges.call].sort();
    preflopRangeSize = ranges.raise.size + ranges.call.size;
  } else {
    const rfiPos = RFI_RANGES[position] ? position : 'SB';
    openerPos = '';
    preflopCorrect = RFI_RANGES[rfiPos].has(handKey) ? 'raise' : 'fold';
    preflopType = 'preflop_rfi';
    preflopSituation = `RFI from ${rfiPos}`;
    preflopActions = ['raise', 'fold'];
    preflopActionLabels = { raise: 'Raise', fold: 'Fold' };
    preflopRange = [...RFI_RANGES[rfiPos]].sort();
    preflopRaiseRange = null;
    preflopCallRange = null;
    preflopRangeSize = RFI_RANGES[rfiPos].size;
  }

  // Postflop data
  const postflopPosition = IP_POSITIONS.has(position) ? 'IP' : 'OOP';
  const flop = board.slice(0, 3);
  const texture = classifyTexture(flop);
  const bucket = classifyHand(hand, flop, texture);
  const facingBet = Math.random() < 0.3;
  const strategy = getStrategy(postflopPosition, texture, bucket, facingBet);
  const correctActions = getCorrectActions(strategy);

  let postActions, postActionLabels, postSituation;
  if (facingBet) {
    postActions = ['fold', 'call', 'raise'];
    postActionLabels = { fold: 'Fold', call: 'Call', raise: 'Raise' };
    postSituation = `${postflopPosition} facing bet`;
  } else if (postflopPosition === 'OOP') {
    postActions = ['check', 'bet_s', 'bet_m', 'bet_l'];
    postActionLabels = { check: 'Check', bet_s: 'Bet 33%', bet_m: 'Bet 66%', bet_l: 'Bet 100%' };
    postSituation = 'OOP first to act';
  } else {
    postActions = ['check', 'bet_s', 'bet_m', 'bet_l'];
    postActionLabels = { check: 'Check', bet_s: 'Bet 33%', bet_m: 'Bet 66%', bet_l: 'Bet 100%' };
    postSituation = 'IP after check';
  }

  const rangeBreakdown = {};
  for (const b of BUCKETS) {
    rangeBreakdown[b] = getStrategy(postflopPosition, texture, b, facingBet);
  }

  const villainPick = IP_POSITIONS.has(position)
    ? pick(['UTG', 'MP', 'SB', 'BB'])
    : pick(['CO', 'BTN']);
  const active = new Set([position, villainPick]);
  const { seats, dealerSeat } = buildSeats(position, handCards, active);
  const pot = pick([6, 8, 10, 12, 15, 20]);

  return {
    hand: handCards, hand_key: handKey, hand_strs: hand,
    board: boardCards, board_strs: board,
    position, seats, dealer_seat: dealerSeat, pot,
    preflop_type: preflopType, preflop_situation: preflopSituation,
    preflop_correct: preflopCorrect, preflop_actions: preflopActions,
    preflop_action_labels: preflopActionLabels, preflop_range: preflopRange,
    preflop_raise_range: preflopRaiseRange, preflop_call_range: preflopCallRange,
    preflop_range_size: preflopRangeSize,
    preflop_opener: openerPos,
    postflop_position: postflopPosition, postflop_situation: postSituation,
    texture, texture_label: TEXTURE_LABELS[texture],
    bucket, bucket_label: BUCKET_LABELS[bucket],
    strategy, correct_actions: correctActions,
    postflop_actions: postActions, postflop_action_labels: postActionLabels,
    range_breakdown: rangeBreakdown, facing_bet: facingBet,
  };
}
