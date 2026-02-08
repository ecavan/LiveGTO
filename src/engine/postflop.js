/**
 * Board texture classification + GTO-approximate strategy tables (9 buckets).
 * Strategy tables loaded from pre-computed JSON (data/strategies.json).
 */
import { rankInt, suitChar } from './evaluator.js';
import strategiesData from '../../data/strategies.json';

export const MONOTONE = 'monotone';
export const PAIRED = 'paired';
export const WET = 'wet';
export const HIGH_DRY = 'high_dry';
export const LOW_DRY = 'low_dry';
export const TEXTURES = [MONOTONE, PAIRED, WET, HIGH_DRY, LOW_DRY];

export const TEXTURE_LABELS = {
  [MONOTONE]: 'Monotone (3+ same suit)',
  [PAIRED]: 'Paired board',
  [WET]: 'Wet (connected + two-tone)',
  [HIGH_DRY]: 'High & dry (broadway, rainbow)',
  [LOW_DRY]: 'Low & dry (rainbow, unconnected)',
};

export const ACTION_LABELS = {
  check: 'Check', bet_s: 'Bet 33%', bet_m: 'Bet 66%', bet_l: 'Bet 100%',
  fold: 'Fold', call: 'Call', raise: 'Raise',
};

function countBy(arr) {
  const counts = {};
  for (const item of arr) counts[item] = (counts[item] || 0) + 1;
  return counts;
}

/** Classify board (array of card strings) into one of 5 texture categories */
export function classifyTexture(board) {
  const ranks = board.map(c => rankInt(c));
  const suits = board.map(c => suitChar(c));

  const suitCounts = countBy(suits);
  const rankCounts = countBy(ranks);

  if (Math.max(...Object.values(suitCounts)) >= 3) return MONOTONE;
  if (Math.max(...Object.values(rankCounts)) >= 2) return PAIRED;

  const sortedRanks = [...ranks].sort((a, b) => a - b);
  const isTwoTone = Math.max(...Object.values(suitCounts)) >= 2;
  let maxGap = 0;
  for (let i = 0; i < sortedRanks.length - 1; i++) {
    maxGap = Math.max(maxGap, sortedRanks[i + 1] - sortedRanks[i]);
  }
  const isConnected = maxGap <= 2;

  if (isTwoTone && isConnected) return WET;

  const highCount = ranks.filter(r => r >= 8).length; // T+
  if (highCount >= 2) return HIGH_DRY;
  return LOW_DRY;
}

// Strategy tables: key is 'position|texture|bucket' or 'texture|bucket'
const OOP_STRATEGY = {
  'OOP|high_dry|premium': {check:0.40,bet_m:0.20,bet_l:0.40}, 'OOP|low_dry|premium': {check:0.35,bet_m:0.25,bet_l:0.40},
  'OOP|wet|premium': {check:0.10,bet_m:0.25,bet_l:0.65}, 'OOP|monotone|premium': {check:0.15,bet_m:0.20,bet_l:0.65},
  'OOP|paired|premium': {check:0.35,bet_m:0.25,bet_l:0.40},
  'OOP|high_dry|nut': {check:0.25,bet_m:0.30,bet_l:0.45}, 'OOP|low_dry|nut': {check:0.20,bet_m:0.35,bet_l:0.45},
  'OOP|wet|nut': {check:0.10,bet_m:0.30,bet_l:0.60}, 'OOP|monotone|nut': {check:0.15,bet_m:0.30,bet_l:0.55},
  'OOP|paired|nut': {check:0.20,bet_m:0.35,bet_l:0.45},
  'OOP|high_dry|strong': {check:0.20,bet_m:0.55,bet_l:0.25}, 'OOP|low_dry|strong': {check:0.15,bet_m:0.60,bet_l:0.25},
  'OOP|wet|strong': {check:0.20,bet_m:0.50,bet_l:0.30}, 'OOP|monotone|strong': {check:0.35,bet_s:0.30,bet_m:0.35},
  'OOP|paired|strong': {check:0.25,bet_m:0.50,bet_l:0.25},
  'OOP|high_dry|good': {check:0.35,bet_s:0.25,bet_m:0.40}, 'OOP|low_dry|good': {check:0.30,bet_s:0.30,bet_m:0.40},
  'OOP|wet|good': {check:0.45,bet_s:0.25,bet_m:0.30}, 'OOP|monotone|good': {check:0.55,bet_s:0.25,bet_m:0.20},
  'OOP|paired|good': {check:0.35,bet_s:0.25,bet_m:0.40},
  'OOP|high_dry|medium': {check:0.60,bet_s:0.25,bet_m:0.15}, 'OOP|low_dry|medium': {check:0.55,bet_s:0.30,bet_m:0.15},
  'OOP|wet|medium': {check:0.70,bet_s:0.20,bet_m:0.10}, 'OOP|monotone|medium': {check:0.75,bet_s:0.15,bet_m:0.10},
  'OOP|paired|medium': {check:0.60,bet_s:0.25,bet_m:0.15},
  'OOP|high_dry|draw': {check:0.40,bet_s:0.35,bet_m:0.25}, 'OOP|low_dry|draw': {check:0.35,bet_s:0.35,bet_m:0.30},
  'OOP|wet|draw': {check:0.30,bet_m:0.40,bet_l:0.30}, 'OOP|monotone|draw': {check:0.45,bet_s:0.25,bet_m:0.30},
  'OOP|paired|draw': {check:0.35,bet_s:0.30,bet_m:0.35},
  'OOP|high_dry|weak_made': {check:0.80,bet_s:0.20}, 'OOP|low_dry|weak_made': {check:0.75,bet_s:0.25},
  'OOP|wet|weak_made': {check:0.90,bet_s:0.10}, 'OOP|monotone|weak_made': {check:0.90,bet_s:0.10},
  'OOP|paired|weak_made': {check:0.80,bet_s:0.20},
  'OOP|high_dry|weak_draw': {check:0.75,bet_s:0.25}, 'OOP|low_dry|weak_draw': {check:0.70,bet_s:0.30},
  'OOP|wet|weak_draw': {check:0.80,bet_s:0.20}, 'OOP|monotone|weak_draw': {check:0.85,bet_s:0.15},
  'OOP|paired|weak_draw': {check:0.75,bet_s:0.25},
  'OOP|high_dry|air': {check:0.65,bet_s:0.10,bet_l:0.25}, 'OOP|low_dry|air': {check:0.60,bet_s:0.10,bet_l:0.30},
  'OOP|wet|air': {check:0.75,bet_l:0.25}, 'OOP|monotone|air': {check:0.80,bet_l:0.20},
  'OOP|paired|air': {check:0.70,bet_l:0.30},
};

const IP_VS_CHECK = {
  'IP|high_dry|premium': {check:0.30,bet_m:0.25,bet_l:0.45}, 'IP|low_dry|premium': {check:0.25,bet_m:0.25,bet_l:0.50},
  'IP|wet|premium': {check:0.10,bet_m:0.20,bet_l:0.70}, 'IP|monotone|premium': {check:0.10,bet_m:0.25,bet_l:0.65},
  'IP|paired|premium': {check:0.25,bet_m:0.30,bet_l:0.45},
  'IP|high_dry|nut': {check:0.20,bet_m:0.35,bet_l:0.45}, 'IP|low_dry|nut': {check:0.15,bet_m:0.35,bet_l:0.50},
  'IP|wet|nut': {check:0.10,bet_m:0.25,bet_l:0.65}, 'IP|monotone|nut': {check:0.10,bet_m:0.30,bet_l:0.60},
  'IP|paired|nut': {check:0.15,bet_m:0.40,bet_l:0.45},
  'IP|high_dry|strong': {check:0.15,bet_m:0.60,bet_l:0.25}, 'IP|low_dry|strong': {check:0.10,bet_m:0.65,bet_l:0.25},
  'IP|wet|strong': {check:0.15,bet_m:0.50,bet_l:0.35}, 'IP|monotone|strong': {check:0.25,bet_s:0.30,bet_m:0.45},
  'IP|paired|strong': {check:0.15,bet_m:0.55,bet_l:0.30},
  'IP|high_dry|good': {check:0.25,bet_s:0.35,bet_m:0.40}, 'IP|low_dry|good': {check:0.20,bet_s:0.35,bet_m:0.45},
  'IP|wet|good': {check:0.35,bet_s:0.30,bet_m:0.35}, 'IP|monotone|good': {check:0.40,bet_s:0.35,bet_m:0.25},
  'IP|paired|good': {check:0.25,bet_s:0.30,bet_m:0.45},
  'IP|high_dry|medium': {check:0.40,bet_s:0.40,bet_m:0.20}, 'IP|low_dry|medium': {check:0.35,bet_s:0.45,bet_m:0.20},
  'IP|wet|medium': {check:0.55,bet_s:0.30,bet_m:0.15}, 'IP|monotone|medium': {check:0.60,bet_s:0.25,bet_m:0.15},
  'IP|paired|medium': {check:0.40,bet_s:0.40,bet_m:0.20},
  'IP|high_dry|draw': {check:0.25,bet_s:0.35,bet_m:0.40}, 'IP|low_dry|draw': {check:0.20,bet_s:0.35,bet_m:0.45},
  'IP|wet|draw': {check:0.15,bet_m:0.40,bet_l:0.45}, 'IP|monotone|draw': {check:0.30,bet_s:0.30,bet_m:0.40},
  'IP|paired|draw': {check:0.25,bet_s:0.35,bet_m:0.40},
  'IP|high_dry|weak_made': {check:0.65,bet_s:0.35}, 'IP|low_dry|weak_made': {check:0.60,bet_s:0.40},
  'IP|wet|weak_made': {check:0.80,bet_s:0.20}, 'IP|monotone|weak_made': {check:0.85,bet_s:0.15},
  'IP|paired|weak_made': {check:0.65,bet_s:0.35},
  'IP|high_dry|weak_draw': {check:0.55,bet_s:0.45}, 'IP|low_dry|weak_draw': {check:0.50,bet_s:0.50},
  'IP|wet|weak_draw': {check:0.65,bet_s:0.35}, 'IP|monotone|weak_draw': {check:0.70,bet_s:0.30},
  'IP|paired|weak_draw': {check:0.55,bet_s:0.45},
  'IP|high_dry|air': {check:0.45,bet_s:0.15,bet_l:0.40}, 'IP|low_dry|air': {check:0.40,bet_s:0.15,bet_l:0.45},
  'IP|wet|air': {check:0.55,bet_l:0.45}, 'IP|monotone|air': {check:0.60,bet_l:0.40},
  'IP|paired|air': {check:0.50,bet_l:0.50},
};

const FACING_BET = {
  'high_dry|premium': {call:0.35,raise:0.65}, 'low_dry|premium': {call:0.30,raise:0.70},
  'wet|premium': {call:0.25,raise:0.75}, 'monotone|premium': {call:0.30,raise:0.70},
  'paired|premium': {call:0.30,raise:0.70},
  'high_dry|nut': {call:0.40,raise:0.60}, 'low_dry|nut': {call:0.35,raise:0.65},
  'wet|nut': {call:0.35,raise:0.65}, 'monotone|nut': {call:0.45,raise:0.55},
  'paired|nut': {call:0.40,raise:0.60},
  'high_dry|strong': {call:0.80,raise:0.20}, 'low_dry|strong': {call:0.75,raise:0.25},
  'wet|strong': {call:0.75,raise:0.25}, 'monotone|strong': {call:0.85,raise:0.15},
  'paired|strong': {call:0.80,raise:0.20},
  'high_dry|good': {call:0.80,fold:0.10,raise:0.10}, 'low_dry|good': {call:0.75,fold:0.10,raise:0.15},
  'wet|good': {call:0.65,fold:0.25,raise:0.10}, 'monotone|good': {call:0.60,fold:0.30,raise:0.10},
  'paired|good': {call:0.75,fold:0.15,raise:0.10},
  'high_dry|medium': {call:0.65,fold:0.35}, 'low_dry|medium': {call:0.60,fold:0.40},
  'wet|medium': {call:0.45,fold:0.55}, 'monotone|medium': {call:0.40,fold:0.60},
  'paired|medium': {call:0.55,fold:0.45},
  'high_dry|draw': {call:0.55,raise:0.20,fold:0.25}, 'low_dry|draw': {call:0.50,raise:0.25,fold:0.25},
  'wet|draw': {call:0.45,raise:0.30,fold:0.25}, 'monotone|draw': {call:0.50,raise:0.20,fold:0.30},
  'paired|draw': {call:0.50,raise:0.25,fold:0.25},
  'high_dry|weak_made': {fold:0.55,call:0.45}, 'low_dry|weak_made': {fold:0.45,call:0.55},
  'wet|weak_made': {fold:0.65,call:0.35}, 'monotone|weak_made': {fold:0.70,call:0.30},
  'paired|weak_made': {fold:0.55,call:0.45},
  'high_dry|weak_draw': {fold:0.55,call:0.45}, 'low_dry|weak_draw': {fold:0.55,call:0.45},
  'wet|weak_draw': {fold:0.60,call:0.40}, 'monotone|weak_draw': {fold:0.65,call:0.35},
  'paired|weak_draw': {fold:0.55,call:0.45},
  'high_dry|air': {fold:0.70,raise:0.15,call:0.15}, 'low_dry|air': {fold:0.65,raise:0.20,call:0.15},
  'wet|air': {fold:0.75,raise:0.15,call:0.10}, 'monotone|air': {fold:0.80,raise:0.10,call:0.10},
  'paired|air': {fold:0.70,raise:0.15,call:0.15},
};

// Override from strategies.json if available
function _loadStrategies() {
  if (!strategiesData || !strategiesData.strategies) return;
  const strats = strategiesData.strategies;
  for (const tex of TEXTURES) {
    const oopTex = (strats.OOP || {})[tex] || {};
    for (const [bkt, strat] of Object.entries(oopTex)) {
      if (strat && Object.keys(strat).length > 0) OOP_STRATEGY[`OOP|${tex}|${bkt}`] = strat;
    }
    const ipTex = (strats.IP || {})[tex] || {};
    for (const [bkt, strat] of Object.entries(ipTex)) {
      if (strat && Object.keys(strat).length > 0) IP_VS_CHECK[`IP|${tex}|${bkt}`] = strat;
    }
    const fbTex = (strats.FACING_BET || {})[tex] || {};
    for (const [bkt, strat] of Object.entries(fbTex)) {
      if (strat && Object.keys(strat).length > 0) FACING_BET[`${tex}|${bkt}`] = strat;
    }
  }
}
_loadStrategies();

/** Look up strategy for a given context */
export function getStrategy(position, texture, bucket, facingBet = false) {
  if (facingBet) {
    return FACING_BET[`${texture}|${bucket}`] || { fold: 0.5, call: 0.5 };
  }
  if (position === 'OOP') {
    return OOP_STRATEGY[`OOP|${texture}|${bucket}`] || { check: 1.0 };
  }
  return IP_VS_CHECK[`IP|${texture}|${bucket}`] || { check: 1.0 };
}

/** Determine acceptable actions from a mixed strategy */
export function getCorrectActions(strategy) {
  const sorted = Object.entries(strategy).sort((a, b) => b[1] - a[1]);
  const [bestAction, bestProb] = sorted[0];

  if (bestProb >= 0.50) return [bestAction];

  const correct = [bestAction];
  if (sorted.length > 1) {
    const [secondAction, secondProb] = sorted[1];
    if (secondProb >= 0.25) correct.push(secondAction);
  }
  return correct;
}

// Re-export the raw tables for range breakdown
export { OOP_STRATEGY, IP_VS_CHECK, FACING_BET };
