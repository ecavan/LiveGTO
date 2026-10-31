/**
 * Builds src/engine/plans.json: one action per hand bucket, board kind and decision, for
 * Level 1 (the solver's baseline) and Level 2 (the exploit against each villain type), from the
 * solved puzzle library.
 *
 *   level 1   what the GTO playbook does with each class (records against the GTO villain)
 *   level 2   what the best exploit does against a Station / Nit / Maniac / Whale
 *   decision  'bet' (first to act or checked to) · 'facing' (facing a bet); and by role, for the
 *             coach: 'aggr' (you bet last street) · 'free' (nobody did) · 'vs_cbet' (his bet
 *             after his bet last street) · 'vs_bet' (his bet after a checked street) · 'vs_raise'
 *             (your c-bet was raised; flop spots only)
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
import { category, guard } from './lib/exploit-guard.mjs';

const dir = process.argv[2] || 'public/library';
const FACING = new Set(['oop_vs_bet', 'ip_vs_bet', 'oop_vs_bet_small', 'ip_vs_bet_small', 'oop_vs_raise', 'ip_vs_raise']);
const KINDS = ['dry', 'wet', 'paired', 'monotone'];
const STREETS = ['flop', 'later']; // the flop has its own plans; turn and river share one
/**
 * Level 2 is a hedge, not the full exploit: the plan is EXPLOIT_WEIGHT of the way from the
 * baseline to the solver's best response to the fitted profile. The node-locked best response
 * is pure and brittle (check-raise every c-bet with air against a Station who folds too many
 * rivers): right if the read and the fit are right, costly if not. Part-way keeps the clear
 * exploits (value-bet thin into a Station, bluff a Nit, call down a Maniac) and drops the ones
 * that only work if the villain is exactly the model, which is what "don't be exploitable" asks.
 */
const EXPLOIT_WEIGHT = 0.6;
// and, before the hedge, the exploit is kept inside the baseline's lines: see scripts/lib/exploit-guard.mjs
// the only family with nobody holding the betting lead (a limped pot)
const NO_AGGRESSOR = new Set(['limp_mp_bb']);

// acc[level][street][kind][decision][class] = { w, cats: {cat: weighted share} }
// (street 'all' = every street together, for the Learn tables and as a fallback)
const acc = {};
const add = (level, street, kind, dec, cls, w, cats) => {
  for (const st of [street, 'all']) {
    const a = ((((acc[level] ||= {})[st] ||= {})[kind] ||= {})[dec] ||= {})[cls] ||= { w: 0, cats: {} };
    a.w += w;
    for (const [k, p] of Object.entries(cats)) a.cats[k] = (a.cats[k] || 0) + w * p;
  }
};
let spots = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && !['index.json', 'playbook.json'].includes(f)).sort()) {
  const { records } = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const r of records) {
    const facing = FACING.has(r.decision);
    const dec = facing ? 'facing' : 'bet';
    // The role, as the bots' streetRole / facingRole see it: was there a bet on the previous
    // street? Every bet line in the library ("cbet_called", "barrel_called") is the family's
    // aggressor betting, and every bet decision is his (or after a checked street, anyone's); so
    // first to act or checked to after his own bet = 'aggr', after a checked street = 'free';
    // facing his bet after his previous bet = 'vs_cbet', after a checked street = 'vs_bet'.
    // (Nobody leads into the aggressor in the library: solid.js has a rule for that.)
    const line = r.id.split('/')[2].split('-');
    const prevBet = /called$/.test(line[line.length - 1]);
    // On the flop the last bet was the preflop raise: the raiser checked to = 'aggr', facing his
    // c-bet = 'vs_cbet'; in a limped pot nobody has the lead ('free' / 'vs_bet').
    const flop = r.street === 'flop';
    const lead = flop ? !NO_AGGRESSOR.has(r.family) : prevBet;
    const role = /_vs_raise$/.test(r.decision) ? 'vs_raise' : facing ? (lead ? 'vs_cbet' : 'vs_bet') : (lead ? 'aggr' : 'free');
    const street = flop ? 'flop' : 'later';
    const kind = boardKind(ids(r.board));
    const level = r.villain.profile;
    if (level === 'gto') spots++; // one per spot (each is solved against every villain type)
    // the GTO strategy of this spot, for the Level 2 hedge
    const gtoCats = {};
    for (const row of r.classes) {
      const cats = {};
      row.gto.pure.forEach((p, i) => { if (p > 0) { const c = category(r.actions[i], facing); cats[c] = (cats[c] || 0) + p; } });
      gtoCats[row.class] = cats;
    }
    for (const row of r.classes) {
      const part = level === 'gto' ? row.gto : row.exploit;
      let cats = {};
      part.pure.forEach((p, i) => { if (p > 0) { const c = category(r.actions[i], facing); cats[c] = (cats[c] || 0) + p; } });
      if (level !== 'gto') {
        cats = guard(cats, gtoCats[row.class] || {}, row.class, facing);
        for (const k of Object.keys(cats)) cats[k] *= EXPLOIT_WEIGHT;
        for (const [k, p] of Object.entries(gtoCats[row.class] || {})) cats[k] = (cats[k] || 0) + (1 - EXPLOIT_WEIGHT) * p;
      }
      if (role !== 'vs_raise') add(level, street, kind, dec, row.class, part.weight, cats);
      add(level, street, kind, role, row.class, part.weight, cats);
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
    // under a fifth, the air that still bets is noted (it is rare: a small mistake, not a plan)
    const stopNoted = { ...stop, dist: { ...stop.dist, ...(active.length && f >= 0.05 ? { [active[0][0]]: r2(f) } : {}) } };
    out.eqair = active.length && f >= 0.2 ? go : stopNoted;
    out.air = active.length && f >= 0.6 ? go : stop;
  }
  return out;
}

const table = (byKind) => {
  const out = {};
  for (const kind of KINDS) {
    if (!byKind?.[kind]) continue;
    out[kind] = {
      bet: buckets(byKind[kind].bet, 'bet'), facing: buckets(byKind[kind].facing, 'facing'),
      // by role (the coach grades with these; the Learn tables show the two above)
      aggr: buckets(byKind[kind].aggr, 'bet'), free: buckets(byKind[kind].free, 'bet'),
      vs_cbet: buckets(byKind[kind].vs_cbet, 'facing'), vs_bet: buckets(byKind[kind].vs_bet, 'facing'),
      vs_raise: buckets(byKind[kind].vs_raise, 'facing'), // the flop library only (your c-bet was raised)
    };
  }
  return out;
};
// levels[level][kind] = every street together (Learn tables, fallback); streets[level][street][kind] for the coach
const plans = { version: 3, spots, exploitWeight: EXPLOIT_WEIGHT, levels: {}, streets: {} };
for (const [level, byStreet] of Object.entries(acc)) {
  plans.levels[level] = table(byStreet.all);
  plans.streets[level] = {};
  for (const st of STREETS) if (byStreet[st]) plans.streets[level][st] = table(byStreet[st]);
}
writeFileSync('src/engine/plans.json', JSON.stringify(plans, null, 1) + '\n');
console.log(`plans: ${spots} spots, levels ${Object.keys(plans.levels).join(', ')}, streets ${Object.entries(plans.streets).map(([l, s]) => `${l}: ${Object.keys(s).join('+')}`).join('; ')}`);
for (const kind of KINDS) {
  const b = plans.levels.gto?.[kind];
  if (!b) continue;
  console.log(kind.padEnd(9), 'bet:', Object.entries(b.bet || {}).map(([k, v]) => `${k} ${v.act} ${Math.round(100 * v.p)}%`).join(' | '));
  console.log(''.padEnd(9), 'facing:', Object.entries(b.facing || {}).map(([k, v]) => `${k} ${v.act} ${Math.round(100 * v.p)}%`).join(' | '));
}
