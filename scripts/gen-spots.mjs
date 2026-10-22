// Generate the Flop and Multiway puzzle sets from the Play engines: bots play hands, and at each of
// "your" decisions the coach prices every option against the real ranges and strategies. A spot
// becomes a puzzle when one option is clearly best (EV gap ≥ max(0.8bb, 7% of the pot)).
//   npx vite-node scripts/gen-spots.mjs [flopCount] [multiwayCount]
// Writes public/spots/flop.json and public/spots/multiway.json, each spot with the plan for your
// whole range by bucket, and public/spots/buckets.json: spots for the Buckets drill (one action
// per kind of hand), heads-up on every street and multiway.
// Every spot is judged at both levels: Level 1 prices it as if the others played solid (the
// baseline: a Reg heads-up, Pros at the table, none adjusting to you), Level 2 against the real
// players. A spot can be a puzzle at one level or both; each entry carries the other level's
// answer (`other`) so the coach shows both.
//   npx vite-node scripts/gen-spots.mjs [flop] [multiway] [buckets]
import { writeFileSync, mkdirSync } from 'node:fs';
import * as HU from '../src/engine/hu/game.js';
import { createAgent, choose, AGENTS } from '../src/engine/hu/agents.js';
import { coach, bucketView } from '../src/engine/hu/coach.js';
import { rng } from '../src/engine/ring/game.js';
import { createTable, startHand, botAct, HERO, baselineTable } from '../src/engine/ring/session.js';
import { randomPlayer, styleLabel } from '../src/engine/ring/players.js';
import { ringCoach, ringBucketView } from '../src/engine/ring/coach.js';
import { live } from '../src/engine/ring/game.js';

const FLOP = Number(process.argv[2] || 240);
const MULTI = Number(process.argv[3] || 150);
const BUCKETS = Number(process.argv[4] || 220);

/** A bucket view, compact: { options, rows: [{ key, name, desc, share, examples, mix, best, agree }] }. */
const packPlan = (bv) => (bv ? {
  options: bv.options.map(o => ({ type: o.type, to: o.to, label: o.label })),
  rows: bv.rows.map(r => ({ key: r.key, name: r.name, desc: r.desc, share: r3(r.share), examples: r.examples, mix: r.mix.map(r3), best: r.best, agree: r3(r.agree) })),
} : null);
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
/** A stable id from the spot's cards and action (queued / seen puzzles survive a rebuild). */
function sid(prefix, holes, runout, log) {
  const str = JSON.stringify([holes, runout, log.map(e => [e.seat, e.type, e.to ?? 0])]);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return prefix + (h >>> 0).toString(36);
}
const aggr = (o) => o.type === 'bet' || o.type === 'raise' || o.type === 'allin';
const packOther = (k, level) => ({ level, best: k.best, fine: k.fine, ev: k.options.map(o => r2(o.ev)) });
const typeOf = (k) => (k.options[k.best].type === 'allin' ? 'raise' : k.options[k.best].type);

/**
 * Drop unnatural all-ins (more than 3× the pot on top of the current bet): the bot models treat
 * a 20×-pot shove like any overbet, so those options teach nothing. Best / fine are recomputed
 * over what's left.
 */
function natural(k, pot, curBet) {
  const keep = k.options.map((o, i) => i).filter(i => k.options[i].type !== 'allin' || k.options[i].to - curBet <= 3 * pot + 1e-9);
  const options = keep.map(i => k.options[i]);
  let best = 0;
  options.forEach((o, i) => { if (o.ev > options[best].ev) best = i; });
  const tol = Math.max(0.1, 0.02 * pot);
  const fine = options.map((o, i) => (options[best].ev - o.ev <= tol ? i : -1)).filter(i => i >= 0);
  return { ...k, options, best, fine };
}

/** Is this a puzzle? Returns { gap, rating } or null. */
function judge(k, pot, rand) {
  const evs = k.options.map(o => o.ev).filter(Number.isFinite);
  if (evs.length < 2) return null;
  const best = k.options[k.best];
  const second = Math.max(...k.options.filter((o, i) => i !== k.best && !k.fine.includes(i)).map(o => o.ev));
  if (!Number.isFinite(second)) return null;
  const gap = best.ev - second;
  if (gap < Math.max(0.8, 0.07 * pot)) return null;
  const rel = gap / Math.max(1, pot);
  let rating = 1750 - 900 * Math.min(1, rel / 0.5);
  const eq = k.equity ?? 0.5;
  // counter-intuitive answers are harder
  if (best.type === 'fold' && eq >= 0.3) rating += 150;
  if (aggr(best) && eq < 0.35) rating += 150;
  if (best.type === 'check' && eq >= 0.65) rating += 120;
  if (best.type === 'call' && k.need != null && eq < k.need + 0.06) rating += 100;
  if (k.fine.length > 1) rating += 60;
  return { gap: r2(gap), rating: Math.round(Math.max(700, Math.min(2100, rating + (rand() - 0.5) * 80))) };
}

const packOpts = (opts) => opts.map(o => {
  const info = {};
  for (const [a, b] of Object.entries(o.info || {})) if (typeof b === 'number') info[a] = r3(b);
  return { type: o.type, to: o.to, label: o.label, ev: r2(o.ev), info };
});
const packRange = (r) => (r ? Object.fromEntries(Object.entries(r).map(([a, b]) => [a, r3(b)])) : null);
const packLog = (log) => log.map(e => ({ seat: e.seat, street: e.street, type: e.type, ...(e.to != null ? { to: e.to } : {}), ...(e.amount != null ? { amount: e.amount } : {}), ...(e.callAllIn ? { callAllIn: true } : {}) }));

// ------------------------------------------------------------------ heads-up flop spots

function genFlop(count) {
  const rand = rng(20260927);
  const opps = ['station', 'nit', 'maniac', 'whale', 'reg', 'shark'];
  const depths = [40, 100, 100, 100, 150, 200];
  const out = [];
  const perType = { 1: {}, 2: {} };
  const n = { 1: 0, 2: 0 };
  const cap = Math.ceil((count / 2) * 0.34);
  let hands = 0;
  for (let pass = 0; (n[1] < count / 2 || n[2] < count / 2) && pass < 800; pass++) {
    const opp = opps[pass % opps.length];
    const vAgent = createAgent(opp);
    const hAgent = createAgent('reg');
    for (let h = 0; h < 30; h++) {
      hands++;
      const d = depths[Math.floor(rand() * depths.length)];
      let s = HU.newHand({ stacks: [d, d], rand });
      const hero = rand() < 0.5 ? HU.BTN : HU.BB;
      let took = false;
      for (let g = 0; g < 40 && !s.done; g++) {
        if (s.toAct === hero) {
          if (s.street === 1 && !took) {
            const P = HU.pot(s);
            // level 2: against him; level 1: as if a solid Reg had played his line
            const ks = { 2: natural(coach(s, hero, vAgent), P, s.streetBet[hero]), 1: natural(coach(s, hero, 'reg'), P, s.streetBet[hero]) };
            for (const lv of [1, 2]) {
              if (n[lv] >= count / 2 || (lv === 2 && (opp === 'reg' || opp === 'shark'))) continue; // Level 2: the fish
              const k = ks[lv];
              const j = judge(k, P, rand);
              const t = typeOf(k);
              if (!j || (perType[lv][t] || 0) >= cap) continue;
              perType[lv][t] = (perType[lv][t] || 0) + 1;
              n[lv]++;
              took = true;
              const view = lv === 1 ? 'reg' : vAgent;
              out.push({
                id: sid('f', s.holes, s.runout, s.log) + (lv === 1 ? '.1' : ''), level: lv, kind: 'hu', opp, depth: d, hero, start: [...s.start], holes: s.holes.map(x => [...x]), runout: [...s.runout],
                log: packLog(s.log), pot: r2(P), toCall: r2(HU.toCall(s, hero)), street: 1,
                options: packOpts(k.options), best: k.best, fine: k.fine, equity: r3(k.equity), need: r3(k.need), range: packRange(k.range),
                notes: k.notes || [], rating: j.rating, gap: j.gap,
                buckets: k.buckets, heroBucket: k.heroBucket, plan: packPlan(bucketView(s, hero, view)),
                other: packOther(ks[3 - lv], 3 - lv),
              });
            }
          }
          s = HU.act(s, choose(hAgent, s, rand));
        } else s = HU.act(s, choose(vAgent, s, rand));
      }
    }
    if (pass % 12 === 11) console.log(`flop: L1 ${n[1]} L2 ${n[2]} of ${count / 2} each, from ${hands} hands`);
  }
  return out;
}

// ------------------------------------------------------------------ multiway spots

function genMulti(count) {
  const rand = rng(777);
  const out = [];
  const perType = { 1: {}, 2: {} };
  const n = { 1: 0, 2: 0 };
  const cap = Math.ceil((count / 2) * 0.34);
  let hands = 0;
  for (let rep = 0; (n[1] < count / 2 || n[2] < count / 2) && rep < 400; rep++) {
    const level = ['easy', 'medium', 'medium', 'hard'][rep % 4];
    const stacks = ['even', 'mixed', 'mixed', 'deep'][rep % 4];
    const t = createTable({ n: 6, level, stacks, rand });
    t.players[HERO] = { ...randomPlayer(rand, new Set(), 'reg'), name: 'You', mix: { reg: 1 }, hud: { hands: 0, vpip: 0, pfr: 0 } };
    for (let h = 0; h < 40; h++) {
      hands++;
      startHand(t, rand);
      let took = false;
      for (let g = 0; g < 120 && !t.s.done; g++) {
        const s = t.s;
        if (s.toAct === HERO && s.street >= 1 && !took && live(s).length >= 3) {
          const P = s.invested.reduce((a, b) => a + b, 0);
          const tables = { 1: baselineTable(t), 2: t };
          const ks = { 1: natural(ringCoach(s, HERO, tables[1], t.snap), P, s.streetBet[HERO]), 2: natural(ringCoach(s, HERO, t, t.snap), P, s.streetBet[HERO]) };
          for (const lv of [1, 2]) {
            if (n[lv] >= count / 2) continue;
            const k = ks[lv];
            const j = judge(k, P, rand);
            const ty = typeOf(k);
            if (!j || (perType[lv][ty] || 0) >= cap) continue;
            perType[lv][ty] = (perType[lv][ty] || 0) + 1;
            n[lv]++;
            took = true;
            out.push({
              id: sid('m', s.holes, s.runout, s.log) + (lv === 1 ? '.1' : ''), level: lv, kind: 'table', tableLevel: level, n: s.n, btn: s.btn, hero: HERO, start: [...s.start], holes: s.holes.map(x => [...x]), runout: [...s.runout],
              log: packLog(s.log), pot: r2(P), toCall: r2(Math.max(...s.streetBet) - s.streetBet[HERO]), street: s.street,
              names: t.players.map((p, i) => (i === HERO ? 'You' : p.name)), styles: t.players.map((p, i) => (i === HERO ? '' : styleLabel(p))),
              options: packOpts(k.options), best: k.best, fine: k.fine, equity: r3(k.equity), need: r3(k.need), range: packRange(k.range),
              notes: k.notes || [], opponents: k.opponents, rating: j.rating, gap: j.gap,
              buckets: k.buckets, heroBucket: k.heroBucket, plan: packPlan(ringBucketView(s, HERO, tables[lv], t.snap)),
              other: packOther(ks[3 - lv], 3 - lv),
            });
          }
        }
        botAct(t, rand);
      }
    }
    console.log(`multiway: L1 ${n[1]} L2 ${n[2]} of ${count / 2} each, from ${hands} hands`);
  }
  return out;
}

// ------------------------------------------------------------------ bucket drill spots

/** A good drill: 3+ buckets that matter, clear answers, and not everything the same play. */
function drillable(plan) {
  const rows = plan.rows.filter(r => r.share >= 0.03);
  if (rows.length < 3 || rows.length > 7) return false;
  if (rows.filter(r => r.agree >= 0.6).length < 3) return false;
  return new Set(rows.map(r => r.best)).size >= 2;
}

function genBuckets(count) {
  const rand = rng(4242);
  const opps = ['station', 'nit', 'maniac', 'whale', 'reg', 'shark'];
  const depths = [40, 100, 100, 100, 150, 200];
  const out = [];
  // per level and street (heads-up), so both levels get flop, turn and river spots
  const per = { 1: [0, 0, 0, 0], 2: [0, 0, 0, 0] };
  const cap = Math.ceil(count * 0.8 / 6);
  const full = () => [1, 2].every(lv => [1, 2, 3].every(st => per[lv][st] >= cap));
  // heads-up: flop, turn and river; at each spot the level that needs it more, if its plan drills well
  for (let pass = 0; !full() && pass < 2000; pass++) {
    const opp = opps[pass % opps.length];
    const vAgent = createAgent(opp), hAgent = createAgent('reg');
    const d = depths[Math.floor(rand() * depths.length)];
    let s = HU.newHand({ stacks: [d, d], rand });
    const hero = rand() < 0.5 ? HU.BTN : HU.BB;
    let took = false;
    for (let g = 0; g < 40 && !s.done; g++) {
      if (s.toAct === hero && s.street >= 1 && !took && rand() < 0.6) {
        const order = [1, 2].filter(lv => per[lv][s.street] < cap && !(lv === 2 && (opp === 'reg' || opp === 'shark'))).sort((a, b) => per[a][s.street] - per[b][s.street]);
        for (const lv of order) {
          const plan = packPlan(bucketView(s, hero, lv === 1 ? 'reg' : vAgent));
          if (!plan || !drillable(plan)) continue;
          took = true;
          per[lv][s.street]++;
          out.push({ id: sid('b', s.holes, s.runout, s.log), level: lv, kind: 'hu', opp, depth: d, hero, start: [...s.start], holes: s.holes.map(x => [...x]), runout: [...s.runout], log: packLog(s.log), street: s.street, pot: r2(HU.pot(s)), toCall: r2(HU.toCall(s, hero)), plan });
          break;
        }
      }
      s = HU.act(s, choose(s.toAct === hero ? hAgent : vAgent, s, rand));
    }
    if (pass % 120 === 119) console.log(`buckets: ${out.length}`, per);
  }
  // multiway, the same number at each level
  const mw = { 1: 0, 2: 0 };
  const capMw = Math.ceil(count * 0.1);
  for (let rep = 0; (mw[1] < capMw || mw[2] < capMw) && rep < 150; rep++) {
    const level = ['easy', 'medium', 'hard'][rep % 3];
    const t = createTable({ n: 6, level, stacks: rep % 2 ? 'mixed' : 'even', rand });
    t.players[HERO] = { ...randomPlayer(rand, new Set(), 'reg'), name: 'You', mix: { reg: 1 }, hud: { hands: 0, vpip: 0, pfr: 0 } };
    for (let h = 0; h < 40 && (mw[1] < capMw || mw[2] < capMw); h++) {
      startHand(t, rand);
      let took = false;
      for (let g = 0; g < 120 && !t.s.done; g++) {
        const s = t.s;
        if (s.toAct === HERO && s.street >= 1 && !took && live(s).length >= 3) {
          for (const lv of [1, 2].filter(x => mw[x] < capMw).sort((a, b) => mw[a] - mw[b])) {
            const plan = packPlan(ringBucketView(s, HERO, lv === 1 ? baselineTable(t) : t, t.snap, 5));
            if (!plan || !drillable(plan)) continue;
            took = true;
            mw[lv]++;
            out.push({
              id: sid('b', s.holes, s.runout, s.log), level: lv, kind: 'table', tableLevel: level, n: s.n, btn: s.btn, hero: HERO, start: [...s.start], holes: s.holes.map(x => [...x]), runout: [...s.runout],
              log: packLog(s.log), street: s.street, pot: r2(s.invested.reduce((a, b) => a + b, 0)), toCall: r2(Math.max(...s.streetBet) - s.streetBet[HERO]),
              names: t.players.map((p, i) => (i === HERO ? 'You' : p.name)), styles: t.players.map((p, i) => (i === HERO ? '' : styleLabel(p))), plan,
            });
            break;
          }
        }
        botAct(t, rand);
      }
    }
    console.log(`buckets (multiway): L1 ${mw[1]} L2 ${mw[2]}`);
  }
  return out;
}

mkdirSync('public/spots', { recursive: true });
const tb = Date.now();
const bk = genBuckets(BUCKETS);
writeFileSync('public/spots/buckets.json', JSON.stringify({ version: 1, spots: bk }));
console.log('bucket spots', bk.length, `${((Date.now() - tb) / 1000).toFixed(0)}s`);
const t0 = Date.now();
const flop = genFlop(FLOP);
writeFileSync('public/spots/flop.json', JSON.stringify({ version: 1, spots: flop }));
console.log('flop spots', flop.length, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
const t1 = Date.now();
const multi = genMulti(MULTI);
writeFileSync('public/spots/multiway.json', JSON.stringify({ version: 1, spots: multi }));
console.log('multiway spots', multi.length, `${((Date.now() - t1) / 1000).toFixed(0)}s`);
