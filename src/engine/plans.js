/**
 * The plan for each bucket, by kind of board and decision, at both levels (src/engine/plans.json,
 * built from the solved library by scripts/build-plans.mjs):
 *   level   'gto' (Level 1, the baseline) or a villain type (Level 2: station, nit, maniac, whale;
 *           a hedge part-way from the baseline to the solver's exploit, see EXPLOIT_WEIGHT)
 *   street  'flop', or 'later' (turn and river); `levels` is every street together
 *   kind    dry · wet · paired · monotone (buckets.js boardKind)
 *   dec     'bet' (first to act, or checked to you) · 'facing' (facing a bet), or the role the
 *           coach grades by: aggr · free · vs_cbet · vs_bet
 * Each entry: { act, p, dist } — the most common play for those hands and how often.
 */
import PLANS from './plans.json';
import { boardKind } from './buckets.js';

export const PLAN_VILLAINS = { station: 'Station', nit: 'Nit', maniac: 'Maniac', whale: 'Whale' };
export const ACT_NAME = { check: 'Check', 'bet small': 'Bet small', 'bet big': 'Bet big', fold: 'Fold', call: 'Call', raise: 'Raise' };
export const ACT_TIP = { 'bet small': 'under half the pot', 'bet big': 'half the pot or more' };
export const planSpots = () => PLANS.spots;

/**
 * The plan entry for a level, board kind, decision/role and bucket. `street`: 'flop' or 'later'
 * (turn and river) picks the street's own plan when the library has one; without it, or when
 * that street has nothing for the cell, every street together.
 */
export function planFor(level, kind, dec, bucket, street = null) {
  const st = street && PLANS.streets?.[level]?.[street]?.[kind]?.[dec]?.[bucket];
  return st ?? PLANS.levels?.[level]?.[kind]?.[dec]?.[bucket] ?? null;
}
/** Level 2 plans sit this far from the baseline towards the solver's exploit (build-plans.mjs). */
export const EXPLOIT_WEIGHT = PLANS.exploitWeight ?? 1;

/**
 * One action. When the solved spots mostly agree (the first play at SPLIT, 65%, or more) that is the
 * plan. Below it the solver mixes, and the plan is the simple line: the passive play (check, call,
 * fold) when one of the two is passive, else the more common one; the other is "fine too". A simple
 * strategy you can execute every time, at the cost of a little edge in close spots (solid.js
 * applies the same rule in the coach, with the EV model allowed to overrule it when the aggressive
 * line is worth clearly more). Returns { acts: [play, alsoFine?], split: bool }.
 */
export const SPLIT = 0.65;
const PASSIVE = new Set(['check', 'call', 'fold']);
export function planActs(pl) {
  if (!pl) return null;
  const sorted = Object.entries(pl.dist || {}).sort((a, b) => b[1] - a[1]);
  const second = sorted.find(([k]) => k !== pl.act);
  if (pl.p >= SPLIT || !second || second[1] < 0.2) return { acts: [pl.act], split: false };
  const simple = PASSIVE.has(second[0]) && !PASSIVE.has(pl.act) ? [second[0], pl.act] : [pl.act, second[0]];
  return { acts: simple, split: true };
}
/** "Call", or "Check (bet big is fine too)" for a split plan. */
export function planText(pl) {
  const a = planActs(pl);
  if (!a) return null;
  const name = (k) => ACT_NAME[k] ?? k;
  if (!a.split) return name(a.acts[0]);
  return `${name(a.acts[0])} (${name(a.acts[1]).toLowerCase()} is fine too)`;
}
/** What usually decides a split plan. */
export const SPLIT_TIP = 'a close spot: the solver does both. Keep it simple: the first play is the one to make every time; the other is fine too.';

/** The plan for your hand's bucket on this board: { kind, base, exploit } (exploit when a villain type is given). */
export function planOn(board, bucket, facing, villain = null) {
  const kind = boardKind(board);
  const dec = facing ? 'facing' : 'bet';
  return { kind, base: planFor('gto', kind, dec, bucket), exploit: villain && villain !== 'gto' ? planFor(villain, kind, dec, bucket) : null };
}
