import { describe, it, expect } from 'vitest';
import { rng } from '../src/engine/ring/game.js';
import { createTable, startHand, heroToAct, coachNow, heroAct, botAct, endHand, summary } from '../src/engine/ring/session.js';
import { playerPolicyAll, context, randomPlayer, newHeroStats } from '../src/engine/ring/players.js';
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
      expect(t.s.stacks.reduce((a, b) => a + b, 0)).toBeCloseTo(600, 6);
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
    for (const p of t.players.slice(1)) expect(Object.keys(p.mix).every(k => ['station', 'whale', 'nit', 'maniac'].includes(k))).toBe(true);
    const h = createTable({ n: 6, level: 'hard', rand: r });
    expect(h.players.slice(1).filter(p => p.mix.pro || p.mix.shark).length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(LEVELS)).toEqual(['easy', 'medium', 'hard']);
  });
});
