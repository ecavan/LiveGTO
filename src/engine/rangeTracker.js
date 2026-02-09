/**
 * Range tracker — estimates villain ranges based on their actions.
 * Uses Bayesian narrowing with GTO strategy tables.
 */
import { RFI_RANGES, FACING_OPEN, buildGrid } from './ranges.js';
import { classifyHand } from './abstraction.js';
import { classifyTexture, getStrategy } from './postflop.js';

const SUITS = ['h', 'd', 'c', 's'];
const NOISE = 0.30;

// Cache the grid so we don't rebuild it every call
let _gridCache = null;
function getGrid() {
  if (!_gridCache) _gridCache = buildGrid();
  return _gridCache;
}

/** Get all 169 canonical hand keys */
function allHandKeys() {
  const grid = getGrid();
  const keys = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      keys.push(grid[i][j]);
    }
  }
  return keys;
}

/**
 * Expand a canonical hand key into all possible suit combos.
 * Returns array of [card1, card2] pairs (e.g. ['Ah', 'Kh']).
 */
export function expandHandKey(handKey) {
  const combos = [];
  if (handKey.length === 2) {
    // Pair: "AA" → 6 combos
    const r = handKey[0];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        combos.push([r + SUITS[i], r + SUITS[j]]);
      }
    }
  } else if (handKey[2] === 's') {
    // Suited: "AKs" → 4 combos
    const r1 = handKey[0], r2 = handKey[1];
    for (const s of SUITS) {
      combos.push([r1 + s, r2 + s]);
    }
  } else {
    // Offsuit: "AKo" → 12 combos
    const r1 = handKey[0], r2 = handKey[1];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (i !== j) combos.push([r1 + SUITS[i], r2 + SUITS[j]]);
      }
    }
  }
  return combos;
}

/**
 * Initialize a villain's range based on position.
 * Returns Map<handKey, weight> with RFI hands at 1.0, others at 0.
 */
export function initVillainRange(position) {
  const range = new Map();
  const rfiPos = RFI_RANGES[position] ? position : 'BTN';
  const rfi = RFI_RANGES[rfiPos];
  for (const key of allHandKeys()) {
    range.set(key, rfi.has(key) ? 1.0 : 0);
  }
  return range;
}

/**
 * Narrow range based on preflop action.
 * Mutates and returns the range map.
 */
export function narrowPreflop(range, villainPos, action, openerPos) {
  let targetSet = null;

  if (action === 'fold') {
    // Folded — zero out everything
    for (const key of range.keys()) range.set(key, 0);
    return range;
  }

  if (action === 'raise' && !openerPos) {
    // Opening raise — use RFI range
    const rfiPos = RFI_RANGES[villainPos] ? villainPos : 'BTN';
    targetSet = RFI_RANGES[rfiPos];
  } else if (action === 'call' && openerPos) {
    // Calling an open
    const key = `${villainPos}|${openerPos}`;
    if (FACING_OPEN[key]) {
      targetSet = FACING_OPEN[key].call;
    }
  } else if (action === 'raise' && openerPos) {
    // 3-betting
    const key = `${villainPos}|${openerPos}`;
    if (FACING_OPEN[key]) {
      targetSet = FACING_OPEN[key].raise;
    }
  }

  if (!targetSet) {
    // No matching range data — keep current range unchanged
    return range;
  }

  for (const key of range.keys()) {
    range.set(key, targetSet.has(key) ? 1.0 : 0);
  }
  return range;
}

/**
 * Narrow range based on a postflop action using Bayesian update.
 * blockedCards: Set of card strings that can't be in villain's hand.
 * posLabel: 'OOP' or 'IP'
 * action: the action villain took (check, bet_s, bet_m, bet_l, call, raise, fold)
 * facingBet: whether villain was facing a bet
 */
export function narrowPostflop(range, boardStrs, blockedCards, posLabel, action, facingBet, noise = NOISE) {
  if (action === 'fold') {
    for (const key of range.keys()) range.set(key, 0);
    return range;
  }

  const texture = classifyTexture(boardStrs);

  // Determine how many random actions are possible (for noise calc)
  const randomActions = facingBet ? ['call', 'fold', 'raise'] : ['check', 'bet_m'];
  const pRandom = noise > 0 && randomActions.includes(action) ? 1 / randomActions.length : 0;

  let maxWeight = 0;

  for (const [handKey, weight] of range) {
    if (weight <= 0) continue;

    const combos = expandHandKey(handKey);
    const validCombos = combos.filter(
      ([c1, c2]) => !blockedCards.has(c1) && !blockedCards.has(c2)
    );

    if (validCombos.length === 0) {
      range.set(handKey, 0);
      continue;
    }

    // Average strategy probability across valid combos
    let totalProb = 0;
    for (const [c1, c2] of validCombos) {
      const bucket = classifyHand([c1, c2], boardStrs, texture);
      const strategy = getStrategy(posLabel, texture, bucket, facingBet);
      totalProb += strategy[action] || 0;
    }
    const avgGtoProb = totalProb / validCombos.length;

    // Account for noise
    const pEffective = (1 - noise) * avgGtoProb + noise * pRandom;

    const newWeight = weight * Math.max(pEffective, 0.001); // floor to avoid zeroing out entirely
    range.set(handKey, newWeight);
    if (newWeight > maxWeight) maxWeight = newWeight;
  }

  // Normalize so max weight = 1.0
  if (maxWeight > 0) {
    for (const [key, w] of range) {
      if (w > 0) range.set(key, w / maxWeight);
    }
  }

  return range;
}

/**
 * Get stats about a range: how many combos remain and what % of all hands.
 */
export function getRangeStats(range) {
  let combos = 0;
  for (const w of range.values()) {
    if (w > 0.05) combos++;
  }
  return { combos, pct: Math.round((combos / 169) * 100) };
}
