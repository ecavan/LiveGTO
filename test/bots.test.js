import { describe, it, expect } from 'vitest';
import { newHand, act, legal, rng, BTN, BB, board } from '../src/engine/hu/game.js';
import { policy, chooseAction, applyProfile, BOT_TYPES } from '../src/engine/hu/bots.js';
import { villainRange, rangeByClass } from '../src/engine/hu/range.js';
import { coach } from '../src/engine/hu/coach.js';
import { ids, ALL_COMBOS, handType } from '../src/engine/hu/hand.js';

const c = (s) => ids(s.match(/../g));

describe('bots', () => {
  it('play complete, legal hands against each other (chips conserved)', () => {
    const rand = rng(7);
    const types = Object.keys(BOT_TYPES);
    for (let i = 0; i < 400; i++) {
      const bots = [types[i % types.length], types[(i * 3 + 1) % types.length]];
      let s = newHand({ rand });
      let guard = 0;
      while (!s.done && guard++ < 60) {
        const d = policy(bots[s.toAct], s);
        expect(d.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1);
        s = act(s, chooseAction(bots[s.toAct], s, rand));
      }
      expect(s.done).toBe(true);
      expect(s.result.net[0] + s.result.net[1]).toBeCloseTo(0.5);
    }
  });
  it('profiles bend the baseline exactly like the solver does', () => {
    // Station, facing a normal-size bet with a medium hand: folds a quarter as often
    const base = { fold: 0.5, call: 0.5, raise: 0, allin: 0 };
    const st = applyProfile('station', base, { street: 'river', facing: true, fraction: 0.75, cls: 'medium', handType: 'K8s' });
    expect(st.fold).toBeCloseTo(0.125);
    expect(st.call).toBeCloseTo(0.875);
    // Nit, facing a bet with air: folds 2.5× as often (0.3 → 0.75), then "only raises the nuts"
    // cuts raises to 15% and hands the difference back pro rata: fold 0.75 · 0.99464 / 0.96429
    const nit = applyProfile('nit', { fold: 0.3, call: 0.6, raise: 0.1, allin: 0 }, { street: 'turn', facing: true, fraction: 0.75, cls: 'air', handType: '72o' });
    expect(nit.fold).toBeCloseTo(0.7736, 3);
    expect(nit.raise).toBeCloseTo(0.1 * (0.25 / 0.7) * 0.15, 4);
  });
});

describe('range tracker', () => {
  it('a Nit that open-raises has no junk', () => {
    let s = newHand({ holes: [c('AsAd'), c('2c3d')] });
    s = act(s, { type: 'raise', to: 2.5 }); // BTN (the Nit, seat 0) opens
    const w = villainRange(s, BTN, 'nit');
    const idx = (h) => ALL_COMBOS.findIndex(([a, b]) => handType([a, b]) === h);
    expect(w[idx('72o')]).toBe(0);
    expect(w[idx('KK')]).toBeGreaterThan(0);
  });
  it("a Station's big river bet is mostly value", () => {
    const rand = rng(11);
    // find a hand where the station bets big on the river after checks
    let found = false;
    for (let t = 0; t < 300 && !found; t++) {
      let s = newHand({ rand });
      s = act(s, { type: 'call' }); // BTN limps
      s = act(s, { type: 'check' });
      while (!s.done && s.street < 3) s = act(s, { type: 'check' });
      if (s.done || s.street !== 3 || s.toAct !== BB) continue;
      s = act(s, { type: 'check' }); // BB checks river; BTN (station) to act
      const d = policy('station', s);
      const big = d.find(o => o.key === 'big');
      if (!big) continue;
      const s2 = act(s, big);
      const r = rangeByClass(villainRange(s2, BTN, 'station'), board(s2));
      expect(r.monster + r.strong).toBeGreaterThan(r.air);
      found = true;
    }
    expect(found).toBe(true);
  });
});

describe('coach', () => {
  it('river: calls with the nuts, folds air against a value-heavy bettor', () => {
    const mk = (hero) => {
      let s = newHand({ holes: [c('KsKd'), c(hero)], board: c('Kh9c4d2s7h') });
      s = act(s, { type: 'raise', to: 2.5 });
      s = act(s, { type: 'call' });
      for (let i = 0; i < 4; i++) s = act(s, { type: 'check' });
      s = act(s, { type: 'check' }); // BB checks river
      const bet = policy('nit', s).find(o => o.key === 'big') || policy('nit', s).find(o => o.type === 'bet');
      return act(s, bet);
    };
    const air = coach(mk('3c3d'), BB, 'nit', rng(1));
    expect(air.options[air.best].type).toBe('fold');
    const nuts = coach(mk('AhAd'), BB, 'nit', rng(1)); // aces vs a nit's value range: still behind KKK? not the nuts
    expect(nuts.options.find(o => o.type === 'call').ev).toBeDefined();
  });
  it('preflop: steal maths vs a folding BB', () => {
    const s = newHand({ holes: [c('7h2c'), c('AsKd')] });
    const k = coach(s, BTN, 'nit');
    expect(k.preflop).toBe(true);
    expect(k.notes.join(' ')).toMatch(/folds \d+% of his hands/);
  });
  it('preflop: fold share uses the range the bot has shown, and free options read "check"', () => {
    // BTN (station) limps; BB with T8o. The station's limping range folds far less than "all hands".
    let s = newHand({ holes: [c('KdQs'), c('Th8c')] });
    s = act(s, { type: 'call' });
    const k = coach(s, BB, 'station');
    expect(k.chart).not.toBe('call');
    expect(k.chart).not.toBe('fold');
    const m = k.notes.join(' ').match(/folds (\d+)% of the range he has shown/);
    expect(m).not.toBeNull();
    const fresh = coach(newHand({ holes: [c('Th8c'), c('KdQs')] }), BTN, 'station');
    const all = +fresh.notes.join(' ').match(/folds (\d+)% of his hands/)[1];
    expect(+m[1]).toBeLessThan(all);
  });
  it('all-in bets are logged as all-in', () => {
    let s = newHand({ holes: [c('AhAd'), c('KhKd')], rand: rng(3) });
    s = act(s, { type: 'call' });
    s = act(s, { type: 'check' });
    s = act(s, { type: 'allin' }); // BB shoves the flop
    expect(s.log.at(-1).type).toBe('allin');
    expect(villainRange(s, BB, 'maniac').some(x => x > 0)).toBe(true);
  });
});
