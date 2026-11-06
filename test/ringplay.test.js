import { describe, it, expect } from 'vitest';
import { rng } from '../src/engine/ring/game.js';
import { createTable, startHand, heroToAct, coachNow, heroAct, botAct, endHand, summary } from '../src/engine/ring/session.js';
import { playerPolicyAll, context, randomPlayer, newHeroStats, ARCHETYPES } from '../src/engine/ring/players.js';
import { newHand, act } from '../src/engine/ring/game.js';
import { N } from '../src/engine/hu/equity.js';

describe('live table', () => {
  it('plays full sessions: every policy a distribution, chips conserved, coach runs', () => {
    const rand = rng(8);
    const t = createTable({ n: 6, rand });
    let coachMs = 0, coachN = 0;
    for (let h = 0; h < 60; h++) {
      startHand(t, rand);
      let guard = 0;
      while (!t.s.done && guard++ < 100) {
        if (heroToAct(t)) {
          const t0 = performance.now();
          const k = coachNow(t);
          coachMs += performance.now() - t0; coachN++;
          expect(k.options.every(o => Number.isFinite(o.ev))).toBe(true);
          heroAct(t, h % 3 === 0 ? 0 : k.best);
        } else {
          const s = t.s, seat = s.toAct, p = t.players[seat];
          const pol = playerPolicyAll(p, s, seat, context(s, seat, p, 0, t.snap));
          for (let i = 0; i < N; i += 173) {
            const tot = pol.P.reduce((a, arr) => a + arr[i], 0);
            if (tot > 0) expect(tot).toBeCloseTo(1, 6);
          }
          botAct(t, rand);
        }
      }
      expect(t.s.done).toBe(true);
      expect(t.s.stacks.reduce((a, b) => a + b, 0)).toBeCloseTo(t.s.start.reduce((a, b) => a + b, 0), 6);
      endHand(t);
    }
    const sum = summary(t);
    expect(sum.hands).toBe(60);
    console.log('coach avg ms', (coachMs / coachN).toFixed(0), 'n', coachN, sum);
  });
  it('players are mixtures and tight players get stolen from as the table learns', () => {
    const p = { ...randomPlayer(rng(1)), mix: { reg: 1 }, learn: 0.5 };
    const s = newHand({ n: 6, btn: 2 }); // seat 5 (CO) first? find a late-position spot
    let st = s;
    while (st.toAct !== 2) st = act(st, { type: 'fold' }); // fold to the button (seat 2)
    const tight = { ...newHeroStats(), hands: 200, vpip: 20, pfr: 15 };
    const loose = { ...newHeroStats(), hands: 200, vpip: 80, pfr: 40 };
    const raiseShare = (stats) => {
      const pol = playerPolicyAll(p, st, 2, context(st, 2, p, 4, stats)); // hero in the BB (seat 4)
      const r = pol.opts.findIndex(o => o.type === 'raise');
      return pol.P[r].reduce((a, b) => a + b, 0) / N;
    };
    expect(raiseShare(tight)).toBeGreaterThan(raiseShare(loose));
  });
});

import { tableTiers, LEVELS } from '../src/engine/ring/players.js';
describe('table difficulty', () => {
  it('easy is all fish; medium has one strong player; hard has three', () => {
    const r = rng(4);
    const count = (lvl, n) => tableTiers(lvl, n, r).filter(x => x === 'strong').length;
    expect(count('easy', 6)).toBe(0);
    expect(count('medium', 6)).toBe(1);
    expect(count('hard', 6)).toBe(3);
    expect(count('hard', 4)).toBe(2); // always at least one fish at the table
    const t = createTable({ n: 6, level: 'easy', rand: r });
    for (const p of t.players.slice(1)) expect(Object.keys(p.mix).every(k => ['station', 'passive', 'whale', 'nit', 'maniac'].includes(k))).toBe(true);
    const h = createTable({ n: 6, level: 'hard', rand: r });
    expect(h.players.slice(1).filter(p => p.mix.pro || p.mix.shark).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(LEVELS)).toEqual(['easy', 'medium', 'hard']);
  });
});

describe('live stacks', () => {
  it('mixed stacks: chips conserved, short stacks re-raise all-in, the coach prices shoves by EV', () => {
    const rand = rng(33);
    const t = createTable({ n: 6, stacks: 'mixed', rand });
    const depths = t.players.slice(1).map(p => p.depth);
    expect(depths.every(d => d >= 25 && d <= 300)).toBe(true);
    let shoveSpots = 0;
    for (let h = 0; h < 150; h++) {
      startHand(t, rand);
      const total = t.s.start.reduce((a, b) => a + b, 0);
      let g = 0;
      while (!t.s.done && g++ < 100) {
        if (heroToAct(t)) {
          const k = coachNow(t);
          const facingShove = t.s.street === 0 && t.s.log.some(e => e.type === 'allin' && !e.callAllIn);
          if (facingShove) { shoveSpots++; expect(k.preflop).toBe(false); }
          const raise = k.options.findIndex(o => o.type === 'raise');
          heroAct(t, t.s.street === 0 && !facingShove && raise >= 0 ? raise : k.best); // open everything: the short stacks shove over it
        } else botAct(t, rand);
      }
      expect(t.s.stacks.reduce((a, b) => a + b, 0)).toBeCloseTo(total, 6);
      endHand(t);
    }
    console.log('preflop shove spots faced', shoveSpots);
    expect(shoveSpots).toBeGreaterThan(0);
  });
});

describe('stacks carry over', () => {
  it('each hand starts from the last one\'s stacks; a bust stack rebuys for its buy-in', async () => {
    const { createTable, startHand, endHand, HERO } = await import('../src/engine/ring/session.js');
    const t = createTable({ n: 6, stacks: 'even', rand: rng(7) });
    startHand(t);
    // pretend the hand ended: hero won 40bb from seat 2, seat 3 busted
    t.s.done = true;
    t.s.stacks = t.s.stacks.map((x, i) => (i === HERO ? 140 : i === 2 ? 60 : i === 3 ? 0 : x));
    const r = rng(3);
    let first = true;
    startHand(t, () => (first ? ((first = false), 0.99) : r())); // nobody leaves this hand
    expect(t.s.start[HERO]).toBe(140);
    expect(t.s.start[2]).toBe(60);
    expect(t.s.start[3]).toBe(100);
    expect(t.arrivals.some(a => /rebought for 100bb/.test(a))).toBe(true);
    void endHand;
  });
});


describe('pot-committed preflop', () => {
  // from a stored hand: hero (seat 0) called a 3-bet, 4-bet to 33, the button 5-bet to 99 of his
  // 103.5, and hero shoves 99.38. The button owes 0.38 into 220: he never folds, so the coach's
  // all-in EV is the call's EV (not "fold equity" on a player who cannot fold)
  const stacks = [99.38, 103.5, 19.12, 370.16, 129.01, 33.83];
  const log = [[4, 'raise', 3], [5, 'fold'], [0, 'call'], [1, 'raise', 11], [2, 'call'], [3, 'fold'], [4, 'call'], [0, 'raise', 33], [1, 'raise', 99], [2, 'fold'], [4, 'fold']];
  const replay = (holes) => {
    let s = newHand({ n: 6, btn: 1, stacks, rand: rng(1), holes });
    for (const [seat, type, to] of log) { expect(s.toAct).toBe(seat); s = act(s, to != null ? { type, to } : { type }); }
    return s;
  };
  it('a player owing a tenth of the pot or less never folds', () => {
    const t = createTable({ n: 6, rand: rng(5) });
    const s = act(replay(null), { type: 'allin', to: 99.38 });
    expect(s.toAct).toBe(1);
    const pol = playerPolicyAll(t.players[1], s, 1, context(s, 1, t.players[1], 0, newHeroStats()));
    const fk = pol.opts.findIndex(o => o.type === 'fold');
    expect(Math.max(...pol.P[fk])).toBe(0);
  });
  it('the coach prices the shove like the call', async () => {
    const { ringCoach } = await import('../src/engine/ring/coach.js');
    const { coachTable } = await import('../src/engine/ring/session.js');
    const t = createTable({ n: 6, rand: rng(5) });
    const holes = [[5, 23], [48, 49], [8, 9], [12, 13], [16, 17], [20, 21]]; // hero 73o, the button AA
    t.s = replay(holes);
    t.snap = newHeroStats();
    const k = ringCoach(t.s, 0, coachTable(t), t.snap);
    const call = k.options.find(o => o.type === 'call'), shove = k.options.find(o => o.type === 'allin');
    expect(call && shove).toBeTruthy();
    expect(Math.abs(shove.ev - call.ev)).toBeLessThan(2);
  });
});

describe('a solid player defends by the price', () => {
  // the big blind (a Pro) facing an open from the button: a min-raise is defended wider than a
  // standard 2.5x, a 4x tighter; the standard size itself is where the shares were tuned
  const share = (openTo, arch = 'pro') => {
    // btn 0 opens; seats 1 (SB) folds; seat 2 is the BB
    let s = newHand({ n: 3, btn: 0, stacks: [100, 100, 100], rand: rng(2) });
    s = act(s, { type: 'raise', to: openTo }); s = act(s, { type: 'fold' });
    expect(s.toAct).toBe(2);
    const t = createTable({ n: 3, rand: rng(5) });
    const p = { ...t.players[1], mix: { [arch]: 1 } };
    const pol = playerPolicyAll(p, s, 2, context(s, 2, p, 0, newHeroStats()));
    const fk = pol.opts.findIndex(o => o.type === 'fold');
    let fold = 0, all = 0;
    for (let i = 0; i < N; i++) { fold += pol.P[fk][i]; all += 1; }
    return 1 - fold / all; // share of all hands that continues
  };
  it('min-raise > 2.5x > 4x for a Pro; a Station ignores the price', () => {
    const [mn, std, big] = [share(2), share(2.5), share(4)];
    expect(mn).toBeGreaterThan(std * 1.05);
    expect(big).toBeLessThan(std * 0.9);
    expect(Math.abs(share(2.5, 'station') - share(4, 'station'))).toBeLessThan(0.01);
  });
});

describe('the read beats the price', () => {
  // the big blind facing a 4x open from a hero he has seen raise 40% of hands: a Pro gives the
  // size no credit (defends as against 2.5x, and wider for the read), the Shark most of it, the
  // Reg half; a Station doesn't read sizes at all
  const share = (openTo, arch, stats) => {
    let s = newHand({ n: 3, btn: 0, stacks: [100, 100, 100], rand: rng(2) });
    s = act(s, { type: 'raise', to: openTo }); s = act(s, { type: 'fold' });
    const p = { name: arch, mix: { [arch]: 1 }, learn: ARCHETYPES[arch].learn, ramp: ARCHETYPES[arch].ramp, seen: 0 };
    const pol = playerPolicyAll(p, s, 2, context(s, 2, p, 0, stats));
    const fk = pol.opts.findIndex(o => o.type === 'fold');
    let fold = 0; for (let i = 0; i < N; i++) fold += pol.P[fk][i];
    return 1 - fold / N;
  };
  const aggro = { ...newHeroStats(), hands: 100, vpip: 50, pfr: 40 };
  it('Pro > Shark > Reg against a 4x open from an aggressive hero; the Pro defends at least his 2.5x share', () => {
    const fresh = newHeroStats();
    // each against his own standard-size share: how much credit the 4x still gets
    const credit = (arch, stats) => share(4, arch, stats) / share(2.5, arch, fresh);
    const pro = credit('pro', aggro), shark = credit('shark', aggro), reg = credit('reg', aggro);
    expect(pro).toBeGreaterThan(shark);
    expect(shark).toBeGreaterThan(reg);
    expect(reg).toBeGreaterThan(credit('reg', fresh));
    expect(pro).toBeGreaterThanOrEqual(1);
    expect(Math.abs(share(4, 'station', aggro) - share(2.5, 'station', aggro))).toBeLessThan(0.01); // a fish never reads sizes
  });
});
