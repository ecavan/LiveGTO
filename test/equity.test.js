import { describe, it, expect } from 'vitest';
import { evaluate, ALL_COMBOS } from '../src/engine/hu/hand.js';
import { rng } from '../src/engine/hu/game.js';
import { evalFast, equityVsRange, boardCtx, N, CA, CB } from '../src/engine/hu/equity.js';

function deal(rand, n) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d.slice(0, n);
}

describe('equity engine', () => {
  it('evalFast matches evaluate on 60k random hands', () => {
    const rand = rng(3);
    for (let k = 0; k < 60000; k++) {
      const n = 5 + (k % 3);
      const c = deal(rand, n);
      expect(evalFast(c, n)).toBe(evaluate(c));
    }
  });
  for (const len of [3, 4, 5]) {
    it(`sweep equals brute force on the same runouts (board of ${len})`, () => {
      const rand = rng(10 + len);
      const board = deal(rand, len);
      const w = new Float64Array(N);
      for (let i = 0; i < N; i++) w[i] = rand() < 0.3 ? rand() : 0;
      const eq = equityVsRange(w, board, { perTurn: 1 });
      const ctx = boardCtx(board, { perTurn: 1 });
      for (let t = 0; t < 25; t++) {
        const i = Math.floor(rand() * N);
        const [a, b] = ALL_COMBOS[i];
        if (board.includes(a) || board.includes(b)) { expect(Number.isNaN(eq[i])).toBe(true); continue; }
        let num = 0, den = 0;
        for (const run of ctx.runs) {
          if (run.includes(a) || run.includes(b)) continue;
          const full = [...board, ...run];
          const vi = evaluate([...full, a, b]);
          for (let j = 0; j < N; j++) {
            if (!(w[j] > 0)) continue;
            const c = CA[j], d = CB[j];
            if (c === a || c === b || d === a || d === b || full.includes(c) || full.includes(d)) continue;
            const vj = evaluate([...full, c, d]);
            num += w[j] * (vi > vj ? 1 : vi === vj ? 0.5 : 0);
            den += w[j];
          }
        }
        expect(eq[i]).toBeCloseTo(num / den, 9);
      }
    });
  }
  it('AA vs KK preflop-like sanity on a dry flop', () => {
    // As Ad vs Ks Kd on 2c 7h 9c: AA ~ 91%
    const id = (s) => 4 * '23456789TJQKA'.indexOf(s[0]) + 'cdhs'.indexOf(s[1]);
    const board = ['2c', '7h', '9c'].map(id);
    const w = new Float64Array(N);
    const kk = ALL_COMBOS.findIndex(([a, b]) => [a, b].sort().join() === [id('Ks'), id('Kd')].sort().join());
    w[kk] = 1;
    const aa = ALL_COMBOS.findIndex(([a, b]) => [a, b].sort().join() === [id('As'), id('Ad')].sort().join());
    const eq = equityVsRange(w, board, { perTurn: 44 });
    expect(eq[aa]).toBeGreaterThan(0.88);
    expect(eq[aa]).toBeLessThan(0.94);
  });
});
