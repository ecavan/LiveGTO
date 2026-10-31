#!/usr/bin/env node
/**
 * Drops the flop "your c-bet was raised" records of a flop when the solver's villain hardly ever
 * raises there (`node scripts/prune-library.mjs [public/library]`, after `ps library`).
 *
 * Why: the villain types are node locks on the equilibrium (the Station raises 1.24x as often as
 * GTO, with the same hands). Where GTO never raises a 75% c-bet (CO vs BTN with a shove behind:
 * the BTN just calls), his raising range is the solver's rounding noise (weak pairs and air), and
 * the "exploit" of it is to call or shove with everything, worth tens of blinds on paper. Those
 * records would teach the opposite of the truth, so a flop keeps its vs_raise records only when
 * the raiser's GTO raise frequency, read from the facing-the-75%-c-bet record of the same flop, is
 * at least MIN_RAISE of his range.
 *
 * Also drops, from every villain-type record, the puzzles whose exploit answer Level 2 does not
 * teach (scripts/lib/exploit-guard.mjs: an action the baseline never takes with that kind of
 * hand, or a float), so the puzzles and the coach's plans agree.
 *
 * Idempotent; prints what it drops. Run `ps library --index-only` afterwards so index.json matches.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { puzzleAllowed } from './lib/exploit-guard.mjs';

const dir = process.argv[2] || 'public/library';
export const MIN_RAISE = 0.02;

const FACING = new Set(['oop_vs_bet', 'ip_vs_bet', 'oop_vs_bet_small', 'ip_vs_bet_small', 'oop_vs_raise', 'ip_vs_raise']);
let dropped = 0, kept = 0, puzzlesCut = 0, puzzlesAll = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && !['index.json', 'playbook.json'].includes(f)).sort()) {
  const path = join(dir, f);
  const lib = JSON.parse(readFileSync(path, 'utf8'));
  let changed = false;
  const vsRaise = lib.records.filter(r => r.street === 'flop' && /_vs_raise$/.test(r.decision));
  // the raiser's own decision: facing the 75% c-bet, at equilibrium
  const vsBet = lib.records.find(r => r.street === 'flop' && /_vs_bet$/.test(r.decision) && r.villain.profile === 'gto');
  if (vsRaise.length && vsBet) {
    const ri = vsBet.actions.findIndex(a => /^(raise|all-in)/i.test(a));
    const freq = ri < 0 ? 0 : vsBet.classes.reduce((s, row) => s + row.gto.weight * row.gto.pure[ri], 0);
    if (freq >= MIN_RAISE) kept++;
    else {
      lib.records = lib.records.filter(r => !vsRaise.includes(r));
      changed = true;
      dropped++;
      console.log(`${f}: raiser raises ${(100 * freq).toFixed(1)}% at equilibrium, dropped ${vsRaise.length} vs_raise records`);
    }
  }
  // puzzles Level 2 does not teach
  let cut = 0, all = 0;
  for (const r of lib.records) {
    if (r.villain.profile === 'gto' || !r.puzzles?.length) continue;
    const facing = FACING.has(r.decision);
    const keep = r.puzzles.filter(p => { all++; return puzzleAllowed(p, r, facing); });
    if (keep.length !== r.puzzles.length) { cut += r.puzzles.length - keep.length; r.puzzles = keep; changed = true; }
  }
  if (cut) console.log(`${f}: dropped ${cut} of ${all} villain-type puzzles`);
  puzzlesCut += cut; puzzlesAll += all;
  if (changed) writeFileSync(path, JSON.stringify(lib));
}
console.log(`vs_raise kept on ${kept} flops, dropped on ${dropped}; puzzles dropped ${puzzlesCut} of ${puzzlesAll}`);
