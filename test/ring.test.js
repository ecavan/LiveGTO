import { describe, it, expect } from 'vitest';
import { newHand, act, menu, legal, rng, replay, pot, posOf } from '../src/engine/ring/game.js';
import { ids } from '../src/engine/hu/hand.js';

const c = (s) => ids(s.match(/../g));

describe('ring engine', () => {
  it('random legal play: chips conserved, hands finish, replay reproduces', () => {
    const rand = rng(5);
    for (let t = 0; t < 3000; t++) {
      const n = 2 + (t % 5);
      const stacks = Array.from({ length: n }, () => Math.round(5 + rand() * 150));
      let s = newHand({ n, btn: t % n, stacks, rand });
      let guard = 0;
      while (!s.done && guard++ < 200) {
        const m = menu(s);
        s = act(s, m[Math.floor(rand() * m.length)]);
      }
      expect(s.done).toBe(true);
      const tot = s.stacks.reduce((a, b) => a + b, 0);
      expect(tot).toBeCloseTo(stacks.reduce((a, b) => a + b, 0), 6);
      if (t % 100 === 0) {
        const steps = replay(s);
        expect(steps.length).toBe(s.log.length);
      }
    }
  });
  it('blinds and first to act, 6-max and heads-up', () => {
    const s = newHand({ n: 6, btn: 0 });
    expect(posOf(s, 1)).toBe('SB');
    expect(s.streetBet[1]).toBe(0.5);
    expect(s.streetBet[2]).toBe(1);
    expect(s.toAct).toBe(3); // UTG
    const h = newHand({ n: 2, btn: 0 });
    expect(h.streetBet[0]).toBe(0.5); // button posts the small blind heads-up
    expect(h.toAct).toBe(0);
  });
  it('the big blind gets the option after limps', () => {
    let s = newHand({ n: 3, btn: 0 });
    s = act(s, { type: 'call' }); // BTN limps
    s = act(s, { type: 'call' }); // SB completes
    expect(s.toAct).toBe(2);
    expect(legal(s).check).toBe(true);
    expect(legal(s).canRaise).toBe(true);
  });
  it('side pot: short all-in wins only the main pot', () => {
    // seat 0 AA (10bb), seat 1 KK (100), seat 2 QQ (100); board bricks
    let s = newHand({ n: 3, btn: 0, stacks: [10, 100, 100], holes: [c('AsAd'), c('KsKd'), c('QsQd')], board: c('2c7h9d3cTh') });
    s = act(s, { type: 'allin' }); // BTN 10
    s = act(s, { type: 'raise', to: 30 }); // SB
    s = act(s, { type: 'call' }); // BB
    while (!s.done) s = act(s, menu(s).find(o => o.type === 'check') || menu(s).find(o => o.type === 'call'));
    expect(s.result.net[0]).toBeCloseTo(20, 6); // wins 3×10
    expect(s.result.net[1]).toBeCloseTo(10, 6); // KK wins the 40 side pot, put in 30
    expect(s.result.net[2]).toBeCloseTo(-30, 6);
  });
  it('a short all-in does not reopen the betting', () => {
    let s = newHand({ n: 3, btn: 0, stacks: [100, 100, 12] });
    s = act(s, { type: 'raise', to: 10 }); // BTN opens 10
    s = act(s, { type: 'fold' }); // SB
    s = act(s, { type: 'allin' }); // BB all-in 12 (raise of 2 < 9)
    expect(s.toAct).toBe(0);
    expect(legal(s).canRaise).toBe(false);
  });
});
