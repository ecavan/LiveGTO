/**
 * Board texture classification + strategy tables (13 buckets × 8 textures).
 * Strategy tables loaded from pre-computed JSON (data/strategies.json).
 */
import { rankInt, suitChar } from './evaluator.js';
import strategiesData from '../../data/strategies.json';

export const MONOTONE = 'monotone';
export const PAIRED = 'paired';
export const WET_CONNECTED = 'wet_connected';
export const WET_TWOTONE = 'wet_twotone';
export const HIGH_DRY_A = 'high_dry_A';
export const HIGH_DRY_K = 'high_dry_K';
export const MEDIUM_DRY = 'medium_dry';
export const LOW_DRY = 'low_dry';

export const TEXTURES = [MONOTONE, PAIRED, WET_CONNECTED, WET_TWOTONE,
  HIGH_DRY_A, HIGH_DRY_K, MEDIUM_DRY, LOW_DRY];

export const TEXTURE_LABELS = {
  [MONOTONE]: 'Monotone (3+ same suit)',
  [PAIRED]: 'Paired board',
  [WET_CONNECTED]: 'Wet connected (straight-draw heavy)',
  [WET_TWOTONE]: 'Wet two-tone (flush-draw heavy)',
  [HIGH_DRY_A]: 'Ace-high dry',
  [HIGH_DRY_K]: 'K/Q-high dry',
  [MEDIUM_DRY]: 'Medium dry (J-8 high)',
  [LOW_DRY]: 'Low dry (7-high or less)',
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

/** Classify board (array of card strings) into one of 8 texture categories */
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

  if (isConnected) return WET_CONNECTED;
  if (isTwoTone) return WET_TWOTONE;

  // Rainbow, not connected
  const highest = Math.max(...ranks);
  if (highest === 12) return HIGH_DRY_A;
  if (highest >= 10) return HIGH_DRY_K;
  if (highest >= 7) return MEDIUM_DRY;
  return LOW_DRY;
}

// Default strategy templates per bucket
const _OOP_DEFAULTS = {
  premium:  {check:0.25,bet_m:0.25,bet_l:0.50},
  nut:      {check:0.20,bet_m:0.30,bet_l:0.50},
  strong:   {check:0.20,bet_m:0.55,bet_l:0.25},
  two_pair: {check:0.25,bet_m:0.50,bet_l:0.25},
  top_pair: {check:0.35,bet_s:0.25,bet_m:0.40},
  overpair: {check:0.40,bet_s:0.25,bet_m:0.35},
  mid_pair: {check:0.60,bet_s:0.25,bet_m:0.15},
  underpair:{check:0.70,bet_s:0.20,bet_m:0.10},
  nut_draw: {check:0.25,bet_m:0.40,bet_l:0.35},
  draw:     {check:0.40,bet_s:0.30,bet_m:0.30},
  weak_made:{check:0.80,bet_s:0.20},
  gutshot:  {check:0.75,bet_s:0.25},
  air:      {check:0.65,bet_s:0.10,bet_l:0.25},
};

const _IP_DEFAULTS = {
  premium:  {check:0.20,bet_m:0.25,bet_l:0.55},
  nut:      {check:0.15,bet_m:0.35,bet_l:0.50},
  strong:   {check:0.15,bet_m:0.60,bet_l:0.25},
  two_pair: {check:0.20,bet_m:0.55,bet_l:0.25},
  top_pair: {check:0.25,bet_s:0.30,bet_m:0.45},
  overpair: {check:0.30,bet_s:0.35,bet_m:0.35},
  mid_pair: {check:0.45,bet_s:0.35,bet_m:0.20},
  underpair:{check:0.55,bet_s:0.30,bet_m:0.15},
  nut_draw: {check:0.15,bet_m:0.45,bet_l:0.40},
  draw:     {check:0.25,bet_s:0.35,bet_m:0.40},
  weak_made:{check:0.65,bet_s:0.35},
  gutshot:  {check:0.55,bet_s:0.45},
  air:      {check:0.45,bet_s:0.15,bet_l:0.40},
};

const _FB_DEFAULTS = {
  premium:  {call:0.30,raise:0.70},
  nut:      {call:0.40,raise:0.60},
  strong:   {call:0.80,raise:0.20},
  two_pair: {call:0.75,raise:0.25},
  top_pair: {call:0.75,fold:0.10,raise:0.15},
  overpair: {call:0.70,fold:0.15,raise:0.15},
  mid_pair: {call:0.55,fold:0.45},
  underpair:{call:0.40,fold:0.60},
  nut_draw: {call:0.45,raise:0.35,fold:0.20},
  draw:     {call:0.50,raise:0.20,fold:0.30},
  weak_made:{fold:0.55,call:0.45},
  gutshot:  {fold:0.60,call:0.40},
  air:      {fold:0.70,raise:0.15,call:0.15},
};

// Build strategy tables from defaults
const OOP_STRATEGY = {};
const IP_VS_CHECK = {};
const FACING_BET = {};

// Import BUCKETS inline to avoid circular dependency at module level
const _BUCKETS = ['premium','nut','strong','two_pair','top_pair','overpair',
  'mid_pair','underpair','nut_draw','draw','weak_made','gutshot','air'];

for (const tex of TEXTURES) {
  for (const bkt of _BUCKETS) {
    OOP_STRATEGY[`OOP|${tex}|${bkt}`] = {...(_OOP_DEFAULTS[bkt] || {check: 1.0})};
    IP_VS_CHECK[`IP|${tex}|${bkt}`] = {...(_IP_DEFAULTS[bkt] || {check: 1.0})};
    FACING_BET[`${tex}|${bkt}`] = {...(_FB_DEFAULTS[bkt] || {fold: 0.5, call: 0.5})};
  }
}

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
