/**
 * The plan for each bucket, by kind of board and decision, at both levels (src/engine/plans.json,
 * built from the solved library by scripts/build-plans.mjs):
 *   level   'gto' (Level 1, the baseline) or a villain type (Level 2: station, nit, maniac, whale)
 *   kind    dry · wet · paired · monotone (buckets.js boardKind)
 *   dec     'bet' (first to act, or checked to you) · 'facing' (facing a bet)
 * Each entry: { act, p, dist } — the most common play for those hands and how often.
 */
import PLANS from './plans.json';
import { boardKind } from './buckets.js';

export const PLAN_VILLAINS = { station: 'Station', nit: 'Nit', maniac: 'Maniac', whale: 'Whale' };
export const ACT_NAME = { check: 'Check', 'bet small': 'Bet small', 'bet big': 'Bet big', fold: 'Fold', call: 'Call', raise: 'Raise' };
export const ACT_TIP = { 'bet small': 'under half the pot', 'bet big': 'half the pot or more' };
export const planSpots = () => PLANS.spots;

export function planFor(level, kind, dec, bucket) {
  return PLANS.levels?.[level]?.[kind]?.[dec]?.[bucket] ?? null;
}

/** The plan for your hand's bucket on this board: { kind, base, exploit } (exploit when a villain type is given). */
export function planOn(board, bucket, facing, villain = null) {
  const kind = boardKind(board);
  const dec = facing ? 'facing' : 'bet';
  return { kind, base: planFor('gto', kind, dec, bucket), exploit: villain && villain !== 'gto' ? planFor(villain, kind, dec, bucket) : null };
}
