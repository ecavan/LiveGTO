import { describe, it, expect } from 'vitest';
import { newHand, act, rng, menu, BTN, BB } from '../src/engine/hu/game.js';
import { createAgent, choose, handEnded, policyAll, AGENT_IDS } from '../src/engine/hu/agents.js';
import { coach } from '../src/engine/hu/coach.js';
import { ids } from '../src/engine/hu/hand.js';
import { N } from '../src/engine/hu/equity.js';

const c = (s) => ids(s.match(/../g));

describe('agents', () => {
  it('every agent plays complete legal hands (chips conserved) and policies are distributions', () => {
    const rand = rng(21);
    for (const id of AGENT_IDS) {
      const a = createAgent(id), b = createAgent('reg');
      for (let i = 0; i < 12; i++) {
        let s = newHand({ rand });
        while (!s.done) {
          const ag = s.toAct === 0 ? a : b;
          const pol = policyAll(ag, s);
          for (let k = 0; k < N; k += 97) {
            const tot = pol.P.reduce((t, arr) => t + arr[k], 0);
            if (tot > 0) expect(tot).toBeCloseTo(1, 6);
          }
          s = act(s, choose(ag, s, rand));
        }
        expect(s.stacks[0] + s.stacks[1]).toBeCloseTo(200.5, 6);
        handEnded(a, s, 0);
      }
    }
  });
  it('the Pro stops reading a limp-and-shove player as a reg', () => {
    const rand = rng(5);
    const pro = createAgent('pro');
    for (let i = 0; i < 40; i++) {
      let s = newHand({ rand });
      while (!s.done) {
        if (s.toAct === BTN) {
          const m = menu(s);
          s = act(s, (s.street === 3 && m.find(o => o.type === 'allin')) || m.find(o => o.type === 'check' || o.type === 'call'));
        } else s = act(s, choose(pro, s, rand));
      }
      handEnded(pro, s, BB);
    }
    // limps every hand and calls down, then shoves rivers: a whale who goes wild
    expect(pro.model.pi.reg).toBeLessThan(0.1);
    expect(pro.model.pi.random + pro.model.pi.whale + pro.model.pi.maniac).toBeGreaterThan(0.6);
  });
  it('the coach works against a thinking bot', () => {
    const pro = createAgent('pro');
    let s = newHand({ holes: [c('AhKd'), c('7c7d')], board: c('Ks8d2c5h9s') });
    s = act(s, { type: 'raise', to: 2.5 });
    s = act(s, { type: 'call' });
    s = act(s, { type: 'check' }); // BB checks the flop
    const k = coach(s, BTN, pro);
    expect(k.options.length).toBeGreaterThan(2);
    expect(k.options.every(o => Number.isFinite(o.ev))).toBe(true);
    expect(k.equity).toBeGreaterThan(0.5);
  });
});

import { rangeView } from '../src/engine/hu/coach.js';
describe('your whole range', () => {
  it('gives one best action per hand in your range, vs a profile bot and a thinking bot', () => {
    for (const ag of ['station', createAgent('pro')]) {
      let s = newHand({ holes: [c('AhKd'), c('7c7d')], board: c('Ks8d2c5h9s') });
      s = act(s, { type: 'raise', to: 2.5 });
      s = act(s, { type: 'call' });
      s = act(s, { type: 'check' });
      const v = rangeView(s, BTN, ag);
      expect(v).not.toBeNull();
      const inRange = [...v.best].filter(x => x >= 0).length;
      expect(inRange).toBeGreaterThan(50);
      expect(v.inRange).toBe(true); // AK on K-high flop is in any sensible BTN range
    }
  });
});

describe('thinking bots stay sane', () => {
  it('never open-shove 100bb preflop, never overbet-shove a small flop pot', () => {
    const pro = createAgent('pro');
    const s = newHand({ holes: [c('7h2c'), c('AsAd')] });
    const pol = policyAll(pro, s);
    expect(pol.opts.some(o => o.type === 'allin')).toBe(false);
    let f = newHand({ holes: [c('7h2c'), c('AsAd')], board: c('Kd8s3c2h9d') });
    f = act(f, { type: 'raise', to: 2.5 });
    f = act(f, { type: 'call' });
    const pf = policyAll(pro, f); // BB first to act on the flop, pot 5.5, stacks 97.5
    expect(pf.opts.some(o => o.type === 'allin')).toBe(false);
  });
});

import { adaptation } from '../src/engine/hu/agents.js';
describe('every bot learns, weaker bots slower', () => {
  it('a whale shifts little and late; a reg more; both keep a read', () => {
    const whale = createAgent('whale'), reg = createAgent('reg');
    whale.model.hands = 60; reg.model.hands = 60;
    expect(adaptation(whale)).toBeLessThan(adaptation(reg));
    expect(adaptation(createAgent('whale'))).toBe(0);
    reg.model.hands = 1000;
    expect(adaptation(reg)).toBeCloseTo(0.5, 6);
    // a blended policy is still a distribution
    const s = newHand({ holes: [c('AhKd'), c('7c7d')], board: c('Ks8d2c5h9s') });
    let t = act(s, { type: 'raise', to: 2.5 });
    t = act(t, { type: 'call' });
    const pol = policyAll(reg, t);
    for (let k = 0; k < N; k += 131) {
      const tot = pol.P.reduce((a, arr) => a + arr[k], 0);
      if (tot > 0) expect(tot).toBeCloseTo(1, 6);
    }
  });
});
