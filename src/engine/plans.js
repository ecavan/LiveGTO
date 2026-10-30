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

/**
 * One action is only an answer when the solved spots mostly agree. Below SPLIT (65%) the most
 * common play hides a coin flip across boards and sizes, so the plan names the two plays and what
 * usually decides between them. Returns { acts: [primary, secondary?], split: bool }.
 */
export const SPLIT = 0.65;
export function planActs(pl) {
  if (!pl) return null;
  const sorted = Object.entries(pl.dist || {}).sort((a, b) => b[1] - a[1]);
  const second = sorted.find(([k]) => k !== pl.act);
  if (pl.p >= SPLIT || !second || second[1] < 0.2) return { acts: [pl.act], split: false };
  return { acts: [pl.act, second[0]], split: true };
}
/** "Call" or "Call or fold (depends on the size)" for a plan entry. */
export function planText(pl, { or = ' or ' } = {}) {
  const a = planActs(pl);
  if (!a) return null;
  const name = (k) => ACT_NAME[k] ?? k;
  if (!a.split) return name(a.acts[0]);
  return `${name(a.acts[0])}${or}${name(a.acts[1]).toLowerCase()}`;
}
/** What usually decides a split plan. */
export const SPLIT_TIP = 'a split: the solver does both, depending on the bet size and how much is behind. Smaller bet or deeper stacks → the passive play; big bet, short stacks → commit or fold.';

/** The plan for your hand's bucket on this board: { kind, base, exploit } (exploit when a villain type is given). */
export function planOn(board, bucket, facing, villain = null) {
  const kind = boardKind(board);
  const dec = facing ? 'facing' : 'bet';
  return { kind, base: planFor('gto', kind, dec, bucket), exploit: villain && villain !== 'gto' ? planFor(villain, kind, dec, bucket) : null };
}
