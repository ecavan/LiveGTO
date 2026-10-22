/**
 * Builds src/engine/plans.json: one action per hand bucket, board kind and decision, for
 * Level 1 (the solver's baseline) and Level 2 (the exploit against each villain type), from the
 * solved puzzle library.
 *
 *   level 1   what the GTO playbook does with each class (records against the GTO villain)
 *   level 2   what the best exploit does against a Station / Nit / Maniac / Whale
 *   decision  'bet' (first to act or checked to) · 'facing' (facing a bet)
 *   kind      dry · wet · paired · monotone (buckets.js boardKind, on the board of the spot)
 *
 * Buckets from the solver's classes: Nuts ← monster, Value ← strong, Bluff-catcher ← medium +
 * weak, Draw ← draw. Air is split the way the solver splits it: it bets (or continues) with its
 * best air first (backdoors, gutshots, overcards = Air with equity), so Air with equity takes the
 * air's aggressive action when at least a fifth of the air does it, and the rest of the air too
 * when most of it does (against a player who folds too much).
 *
 *   node scripts/build-plans.mjs [libraryDir]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { boardKind } from '../src/engine/buckets.js';
import { ids } from '../src/engine/hu/hand.js';

const dir = process.argv[2] || 'public/library';
const FACING = new Set(['oop_vs_bet', 'ip_vs_bet']);
const KINDS = ['dry', 'wet', 'paired', 'monotone'];

function category(label, facing) {
  const l = label.toLowerCase();
  if (l.startsWith('fold')) return 'fold';
  if (l.startsWith('check')) return 'check';
  if (l.startsWith('call')) return 'call';
  if (l.startsWith('raise') || (facing && l.startsWith('all-in'))) return 'raise';
  const m = l.match(/bet [\d.]+bb \((\d+)%\)|bet (\d+)%/);
  if (m) return Number(m[1] ?? m[2]) < 50 ? 'bet small' : 'bet big';
  return 'bet big'; // all-in when not facing a bet
}

// acc[level][kind][decision][class] = { w, cats: {cat: weighted share} }
const acc = {};
const add = (level, kind, dec, cls, w, cats) => {
  const a = (((acc[level] ||= {})[kind] ||= {})[dec] ||= {})[cls] ||= { w: 0, cats: {} };
  a.w += w;
  for (const [k, p] of Object.entries(cats)) a.cats[k] = (a.cats[k] || 0) + w * p;
};
let spots = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && !['index.json', 'playbook.json'].includes(f)).sort()) {
  const { records } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const r of records) {
    const facing = FACING.has(r.decision);
    const dec = facing ? 'facing' : 'bet';
    const kind = boardKind(ids(r.board));
    const level = r.villain.profile;
    if (level === 'gto') spots++; // one per spot (each is solved against every villain type)
    for (const row of r.classes) {
      const part = level === 'gto' ? row.gto : row.exploit;
      const cats = {};
      part.pure.forEach((p, i) => { if (p > 0) { const c = category(r.actions[i], facing); cats[c] = (cats[c] || 0) + p; } });
      add(level, kind, dec, row.class, part.weight, cats);
    }
  }
}

const norm = (a) => (a && a.w > 0 ? Object.fromEntries(Object.entries(a.cats).map(([k, v]) => [k, v / a.w])) : null);
const merge = (...as) => {
  const out = { w: 0, cats: {} };
  for (const a of as.filter(Boolean)) { out.w += a.w; for (const [k, v] of Object.entries(a.cats)) out.cats[k] = (out.cats[k] || 0) + v; }
  return out.w > 0 ? out : null;
};
const r2 = (x) => Math.round(x * 100) / 100;
const pick = (dist) => {
  const [act, p] = Object.entries(dist).sort((x, y) => y[1] - x[1])[0];
  return { act, p: r2(p), dist: Object.fromEntries(Object.entries(dist).filter(([, v]) => v >= 0.05).map(([k, v]) => [k, r2(v)])) };
};

function buckets(t, dec) {
  if (!t) return null;
  const out = {};
  const put = (key, a) => { const d = norm(a); if (d) out[key] = pick(d); };
  put('nuts', t.monster);
  put('value', t.strong);
  put('catcher', merge(t.medium, t.weak));
  put('draw', t.draw);
  const air = norm(t.air);
  if (air) {
    const passive = dec === 'facing' ? (air.fold || 0) : (air.check || 0);
    const giveUp = dec === 'facing' ? 'fold' : 'check';
    const active = Object.entries(air).filter(([k]) => k !== giveUp).sort((x, y) => y[1] - x[1]);
    // the air that bets is the best air: Air with equity first, then the rest
    const f = 1 - passive;
    const go = { act: active[0]?.[0] ?? giveUp, p: r2(f), dist: { [active[0]?.[0] ?? giveUp]: r2(f), [giveUp]: r2(passive) } };
    const stop = { act: giveUp, p: r2(passive), dist: { [giveUp]: r2(passive) } };
    out.eqair = active.length && f >= 0.2 ? go : stop;
    out.air = active.length && f >= 0.6 ? go : stop;
  }
  return out;
}

const plans = { version: 1, spots, levels: {} };
for (const [level, byKind] of Object.entries(acc)) {
  plans.levels[level] = {};
  for (const kind of KINDS) {
    if (!byKind[kind]) continue;
    plans.levels[level][kind] = { bet: buckets(byKind[kind].bet, 'bet'), facing: buckets(byKind[kind].facing, 'facing') };
  }
}
writeFileSync('src/engine/plans.json', JSON.stringify(plans, null, 1) + '\n');
console.log(`plans: ${spots} spots, levels ${Object.keys(plans.levels).join(', ')}`);
for (const kind of KINDS) {
  const b = plans.levels.gto?.[kind];
  if (!b) continue;
  console.log(kind.padEnd(9), 'bet:', Object.entries(b.bet || {}).map(([k, v]) => `${k} ${v.act} ${Math.round(100 * v.p)}%`).join(' | '));
  console.log(''.padEnd(9), 'facing:', Object.entries(b.facing || {}).map(([k, v]) => `${k} ${v.act} ${Math.round(100 * v.p)}%`).join(' | '));
}
