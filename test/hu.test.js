import { describe, it, expect } from 'vitest';
import { newHand, act, legal, menu, pot, board, rng, BTN, BB } from '../src/engine/hu/game.js';
import { evaluate, classify, ids, cardId, CAT, category, handType } from '../src/engine/hu/hand.js';

const c = (s) => ids(s.match(/../g));
const run = (s, actions) => actions.reduce((st, a) => act(st, typeof a === 'string' ? { type: a } : a), s);
const conserve = (s) => expect(s.result.net[0] + s.result.net[1]).toBeCloseTo(0.5); // the SB's dead 0.5

describe('hand evaluation (port of ps-core)', () => {
  it('categories and kickers', () => {
    expect(category(evaluate(c('AhKhQhJhTh')))).toBe(CAT.STRAIGHT_FLUSH);
    expect(category(evaluate(c('5h4h3h2hAh')))).toBe(CAT.STRAIGHT_FLUSH);
    expect(category(evaluate(c('9c9d9h2s2c2d')))).toBe(CAT.FULL_HOUSE);
    expect(category(evaluate(c('As2c3d4h5s')))).toBe(CAT.STRAIGHT);
    expect(evaluate(c('AcAsKc5d2d'))).toBeGreaterThan(evaluate(c('AhAd9c5s2h')));
    expect(evaluate(c('AhAdKhKd2c2dQs'))).toBe(evaluate(c('AsAcKsKcQh3d4d')));
  });
  it('classes match the solver', () => {
    const cls = (h, b) => classify(c(h), c(b));
    expect(cls('9h9s', '9dTc2s')).toBe('monster');
    expect(cls('Th9h', '9dTc2s')).toBe('monster');
    expect(cls('Th2h', '9dTc2s')).toBe('strong');
    expect(cls('AhAd', '9dTc2s')).toBe('strong');
    expect(cls('Th5d', '9dTc2s')).toBe('medium');
    expect(cls('2h5d', '9dTc2s')).toBe('weak');
    expect(cls('AhKh', '9h5h2s')).toBe('draw');
    expect(cls('JdQc', '9hTs2d3c4h')).toBe('air');
    expect(cls('2c3d', 'AhKhQhJhTh')).toBe('air');
    expect(handType(c('AhKh'))).toBe('AKs');
  });
});

describe('heads-up engine', () => {
  it('blinds: BTN first preflop, BB option after a limp', () => {
    let s = newHand({ rand: rng(1) });
    expect(pot(s)).toBe(1.5);
    expect(s.toAct).toBe(BTN);
    expect(legal(s)).toMatchObject({ call: true, callAmount: 1, minTo: 2 });
    s = act(s, { type: 'call' });
    expect(s.toAct).toBe(BB);
    expect(legal(s).check).toBe(true);
    s = act(s, { type: 'check' });
    expect(s.street).toBe(1);
    expect(s.toAct).toBe(BB); // BB first postflop
    expect(board(s)).toHaveLength(3);
  });
  it('fold hands the pot over and conserves chips', () => {
    let s = run(newHand({ rand: rng(2) }), [{ type: 'raise', to: 2.5 }, 'fold']);
    expect(s.done).toBe(true);
    expect(s.result.winner).toBe(BTN);
    expect(s.result.net).toEqual([1.5, -1]);
    conserve(s);
  });
  it('min-raise follows the last raise size', () => {
    let s = act(newHand({ rand: rng(3) }), { type: 'raise', to: 3 }); // raise of 2
    expect(legal(s).minTo).toBe(5);
    expect(() => act(s, { type: 'raise', to: 4 })).toThrow();
    s = act(s, { type: 'raise', to: 10 }); // raise of 7
    expect(legal(s).minTo).toBe(17);
  });
  it('checks around to showdown and splits exactly', () => {
    let s = newHand({ holes: [c('AhKd'), c('AsKc')], board: c('2c7d9hJs3c') });
    s = run(s, ['call', 'check', 'check', 'check', 'check', 'check', 'check', 'check']);
    expect(s.done).toBe(true);
    expect(s.result.winner).toBe(-1);
    expect(s.result.net).toEqual([0.25, 0.25]);
  });
  it('all-in for less: uncalled chips return, board runs out', () => {
    let s = newHand({ stacks: [100, 30], holes: [c('AhAd'), c('KsKc')], board: c('2c7d9h3s4c') });
    s = act(s, { type: 'raise', to: 50 });
    expect(legal(s).minTo).toBe(30); // BB can only go all-in for less or call
    s = act(s, { type: 'call' }); // all-in for 30
    expect(s.done).toBe(true);
    expect(s.result.showdown).toBe(true);
    expect(s.result.winner).toBe(BTN);
    expect(s.result.net).toEqual([30.5, -30]);
    conserve(s);
  });
  it('a short all-in raise does not reopen the betting', () => {
    let s = newHand({ stacks: [100, 12] });
    s = act(s, { type: 'raise', to: 10 }); // raise of 9
    s = act(s, { type: 'allin' }); // BB to 12: raise of 2 < 9
    const L = legal(s);
    expect(L.canRaise).toBe(false);
    expect(L.call).toBe(true);
  });
  it('the menu offers human-sized actions only', () => {
    let s = run(newHand({ rand: rng(5) }), [{ type: 'raise', to: 2.5 }, 'call']);
    expect(s.street).toBe(1);
    const labels = menu(s).map(m => m.label);
    expect(labels[0]).toBe('Check');
    expect(labels.some(l => l.includes('(33%)'))).toBe(true);
    expect(labels.some(l => l.includes('(75%)'))).toBe(true);
    expect(labels.at(-1)).toMatch(/All-in/);
  });
  it('random hands always conserve chips (property)', () => {
    const rand = rng(99);
    for (let i = 0; i < 2000; i++) {
      let s = newHand({ rand, stacks: [20 + Math.floor(rand() * 180), 20 + Math.floor(rand() * 180)] });
      let guard = 0;
      while (!s.done && guard++ < 50) {
        const m = menu(s);
        s = act(s, m[Math.floor(rand() * m.length)]);
      }
      expect(s.done).toBe(true);
      conserve(s);
      expect(s.stacks[0]).toBeGreaterThanOrEqual(0);
      expect(s.stacks[1]).toBeGreaterThanOrEqual(0);
    }
  });
});
