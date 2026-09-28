// Generate the Flop and Multiway puzzle sets from the Play engines: bots play hands, and at each of
// "your" decisions the coach prices every option against the real ranges and strategies. A spot
// becomes a puzzle when one option is clearly best (EV gap ≥ max(0.8bb, 7% of the pot)).
//   npx vite-node scripts/gen-spots.mjs [flopCount] [multiwayCount]
// Writes public/spots/flop.json and public/spots/multiway.json, each spot with the plan for your
// whole range by bucket, and public/spots/buckets.json: spots for the Buckets drill (one action
// per kind of hand), heads-up on every street and multiway.
//   npx vite-node scripts/gen-spots.mjs [flop] [multiway] [buckets]
import { writeFileSync, mkdirSync } from 'node:fs';
import * as HU from '../src/engine/hu/game.js';
import { createAgent, choose, AGENTS } from '../src/engine/hu/agents.js';
import { coach, bucketView } from '../src/engine/hu/coach.js';
import { rng } from '../src/engine/ring/game.js';
import { createTable, startHand, botAct, HERO } from '../src/engine/ring/session.js';
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
const aggr = (o) => o.type === 'bet' || o.type === 'raise' || o.type === 'allin';

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
  const perType = {};
  const cap = Math.ceil(count * 0.34);
  let hands = 0;
  for (let pass = 0; out.length < count && pass < 400; pass++) {
    const opp = opps[pass % opps.length];
    const vAgent = createAgent(opp);
    const hAgent = createAgent('reg');
    for (let h = 0; h < 30 && out.length < count; h++) {
      hands++;
      const d = depths[Math.floor(rand() * depths.length)];
      let s = HU.newHand({ stacks: [d, d], rand });
      const hero = rand() < 0.5 ? HU.BTN : HU.BB;
      let took = false;
      for (let g = 0; g < 40 && !s.done; g++) {
        if (s.toAct === hero) {
          if (s.street === 1 && !took) {
            const P = HU.pot(s);
            const k = natural(coach(s, hero, vAgent), P, s.streetBet[hero]);
            const j = judge(k, P, rand);
            const t = k.options[k.best].type === 'allin' ? 'raise' : k.options[k.best].type;
            if (j && (perType[t] || 0) < cap) {
              perType[t] = (perType[t] || 0) + 1;
              took = true;
              out.push({
                id: `f${out.length}`, kind: 'hu', opp, depth: d, hero, start: [...s.start], holes: s.holes.map(x => [...x]), runout: [...s.runout],
                log: packLog(s.log), pot: r2(P), toCall: r2(HU.toCall(s, hero)), street: 1,
                options: packOpts(k.options), best: k.best, fine: k.fine, equity: r3(k.equity), need: r3(k.need), range: packRange(k.range),
                notes: k.notes || [], rating: j.rating, gap: j.gap,
                buckets: k.buckets, heroBucket: k.heroBucket, plan: packPlan(bucketView(s, hero, vAgent)),
              });
            }
          }
          s = HU.act(s, choose(hAgent, s, rand));
        } else s = HU.act(s, choose(vAgent, s, rand));
      }
    }
    if (pass % 12 === 11) console.log(`flop: ${out.length}/${count} from ${hands} hands`, perType);
  }
  return out;
}

// ------------------------------------------------------------------ multiway spots

function genMulti(count) {
  const rand = rng(777);
  const out = [];
  const perType = {};
  const cap = Math.ceil(count * 0.34);
  let hands = 0;
  for (let rep = 0; out.length < count && rep < 200; rep++) {
    const level = ['easy', 'medium', 'medium', 'hard'][rep % 4];
    const stacks = ['even', 'mixed', 'mixed', 'deep'][rep % 4];
    const t = createTable({ n: 6, level, stacks, rand });
    t.players[HERO] = { ...randomPlayer(rand, new Set(), 'reg'), name: 'You', mix: { reg: 1 }, hud: { hands: 0, vpip: 0, pfr: 0 } };
    for (let h = 0; h < 40 && out.length < count; h++) {
      hands++;
      startHand(t, rand);
      let took = false;
      for (let g = 0; g < 120 && !t.s.done; g++) {
        const s = t.s;
        if (s.toAct === HERO && s.street >= 1 && !took && live(s).length >= 3) {
          const P = s.invested.reduce((a, b) => a + b, 0);
          const k = natural(ringCoach(s, HERO, t, t.snap), P, s.streetBet[HERO]);
          const j = judge(k, P, rand);
          const ty = k.options[k.best].type === 'allin' ? 'raise' : k.options[k.best].type;
          if (j && (perType[ty] || 0) < cap) {
            perType[ty] = (perType[ty] || 0) + 1;
            took = true;
            out.push({
              id: `m${out.length}`, kind: 'table', level, n: s.n, btn: s.btn, hero: HERO, start: [...s.start], holes: s.holes.map(x => [...x]), runout: [...s.runout],
              log: packLog(s.log), pot: r2(P), toCall: r2(Math.max(...s.streetBet) - s.streetBet[HERO]), street: s.street,
              names: t.players.map((p, i) => (i === HERO ? 'You' : p.name)), styles: t.players.map((p, i) => (i === HERO ? '' : styleLabel(p))),
              options: packOpts(k.options), best: k.best, fine: k.fine, equity: r3(k.equity), need: r3(k.need), range: packRange(k.range),
              notes: k.notes || [], opponents: k.opponents, rating: j.rating, gap: j.gap,
              buckets: k.buckets, heroBucket: k.heroBucket, plan: packPlan(ringBucketView(s, HERO, t, t.snap)),
            });
          }
        }
        botAct(t, rand);
      }
    }
    console.log(`multiway: ${out.length}/${count} from ${hands} hands`, perType);
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
  const perStreet = [0, 0, 0, 0];
  const cap = Math.ceil(count * 0.3);
  // heads-up: flop, turn and river
  for (let pass = 0; out.length < count * 0.8 && pass < 600; pass++) {
    const opp = opps[pass % opps.length];
    const vAgent = createAgent(opp), hAgent = createAgent('reg');
    const d = depths[Math.floor(rand() * depths.length)];
    let s = HU.newHand({ stacks: [d, d], rand });
    const hero = rand() < 0.5 ? HU.BTN : HU.BB;
    let took = false;
    for (let g = 0; g < 40 && !s.done; g++) {
      if (s.toAct === hero && s.street >= 1 && !took && perStreet[s.street] < cap && rand() < 0.6) {
        const plan = packPlan(bucketView(s, hero, vAgent));
        if (plan && drillable(plan)) {
          took = true;
          perStreet[s.street]++;
          out.push({ id: `b${out.length}`, kind: 'hu', opp, depth: d, hero, start: [...s.start], holes: s.holes.map(x => [...x]), runout: [...s.runout], log: packLog(s.log), street: s.street, pot: r2(HU.pot(s)), toCall: r2(HU.toCall(s, hero)), plan });
        }
      }
      s = HU.act(s, choose(s.toAct === hero ? hAgent : vAgent, s, rand));
    }
    if (pass % 60 === 59) console.log(`buckets: ${out.length}/${count}`, perStreet);
  }
  // multiway
  for (let rep = 0; out.length < count && rep < 60; rep++) {
    const level = ['easy', 'medium', 'hard'][rep % 3];
    const t = createTable({ n: 6, level, stacks: rep % 2 ? 'mixed' : 'even', rand });
    t.players[HERO] = { ...randomPlayer(rand, new Set(), 'reg'), name: 'You', mix: { reg: 1 }, hud: { hands: 0, vpip: 0, pfr: 0 } };
    for (let h = 0; h < 40 && out.length < count; h++) {
      startHand(t, rand);
      let took = false;
      for (let g = 0; g < 120 && !t.s.done; g++) {
        const s = t.s;
        if (s.toAct === HERO && s.street >= 1 && !took && live(s).length >= 3) {
          const plan = packPlan(ringBucketView(s, HERO, t, t.snap, 5));
          if (plan && drillable(plan)) {
            took = true;
            out.push({
              id: `b${out.length}`, kind: 'table', level, n: s.n, btn: s.btn, hero: HERO, start: [...s.start], holes: s.holes.map(x => [...x]), runout: [...s.runout],
              log: packLog(s.log), street: s.street, pot: r2(s.invested.reduce((a, b) => a + b, 0)), toCall: r2(Math.max(...s.streetBet) - s.streetBet[HERO]),
              names: t.players.map((p, i) => (i === HERO ? 'You' : p.name)), styles: t.players.map((p, i) => (i === HERO ? '' : styleLabel(p))), plan,
            });
          }
        }
        botAct(t, rand);
      }
    }
    console.log(`buckets (multiway): ${out.length}/${count}`);
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
