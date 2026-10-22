import { describe, it, expect } from 'vitest';
import { bucketOf, composition, plan, boardDangers, bucketsOn, boardKind, BUCKET_KEYS } from '../src/engine/buckets.js';
import { planFor, planOn } from '../src/engine/plans.js';
import { ids } from '../src/engine/hu/hand.js';
import { N } from '../src/engine/hu/equity.js';

const c = (s) => ids(s.match(/../g));

describe('hand buckets', () => {
  it('six buckets: big hands split by the board, pairs, draws, air', () => {
    expect(BUCKET_KEYS).toEqual(['nuts', 'value', 'catcher', 'draw', 'eqair', 'air']);
    expect(bucketOf(c('9h9s'), c('9dKc2s'))).toBe('nuts'); // set, dry board
    expect(bucketOf(c('9s9c'), c('9hKh2h'))).toBe('value'); // set, three hearts
    expect(bucketOf(c('AhQh'), c('9hKh2h'))).toBe('nuts'); // nut flush
    expect(bucketOf(c('KdQc'), c('KsQh5d'))).toBe('nuts'); // top two, rainbow, no straight
    expect(bucketOf(c('KdQc'), c('KsQhJd'))).toBe('value'); // top two, straight possible
    expect(bucketOf(c('AhAd'), c('9dTc2s'))).toBe('value'); // overpair
    expect(bucketOf(c('9c8c'), c('9dKc2s'))).toBe('catcher'); // middle pair
    expect(bucketOf(c('AhKh'), c('9h5h2s'))).toBe('draw'); // flush draw
    expect(bucketOf(c('8c7d'), c('9hTs2d'))).toBe('draw'); // open-ender
    expect(bucketOf(c('AcKd'), c('9h5h2s'))).toBe('eqair'); // two overcards
    expect(bucketOf(c('7h6h'), c('AsKd2c'))).toBe('air'); // nothing to improve to
    expect(bucketOf(c('JsTs'), c('As7h2d'))).toBe('eqair'); // backdoor flush and straight draws
    expect(bucketOf(c('Qs9s'), c('Jh8d2c'))).toBe('eqair'); // gutshot
    expect(bucketOf(c('AcKd'), c('9h5h2sJcQd'))).toBe('air'); // on the river air is just air
    expect(boardDangers(c('9hKh2h'))).toContain('flush possible');
    expect(boardDangers(c('As2d3c'))).toContain('straight possible'); // the wheel
    expect(boardDangers(c('Ks8d2c'))).toEqual([]);
  });
  it('board kinds, decided on the flop', () => {
    expect(boardKind(c('Ks7h2d'))).toBe('dry');
    expect(boardKind(c('AhKd7s'))).toBe('dry'); // A-K only makes gutshots
    expect(boardKind(c('As8d3c'))).toBe('dry');
    expect(boardKind(c('JhTh8c'))).toBe('wet');
    expect(boardKind(c('9s8d4c'))).toBe('wet'); // connected
    expect(boardKind(c('Ks7h2h'))).toBe('wet'); // two-tone
    expect(boardKind(c('9c9d4s'))).toBe('paired');
    expect(boardKind(c('8c7c2c'))).toBe('monotone');
    expect(boardKind(c('Ks7h2dKc'))).toBe('dry'); // the turn doesn't change the kind
  });
  it('plans: one play per bucket, board kind and decision, at both levels', () => {
    for (const lv of ['gto', 'station', 'nit', 'maniac', 'whale']) {
      for (const kind of ['dry', 'wet', 'paired', 'monotone']) {
        for (const dec of ['bet', 'facing']) {
          for (const k of BUCKET_KEYS) {
            const p = planFor(lv, kind, dec, k);
            expect(p, `${lv} ${kind} ${dec} ${k}`).toBeTruthy();
            expect(dec === 'bet' ? ['check', 'bet small', 'bet big'] : ['fold', 'call', 'raise']).toContain(p.act);
          }
        }
      }
    }
    // the baseline: build the pot with the nuts, give up plain air
    expect(planFor('gto', 'dry', 'bet', 'nuts').act).not.toBe('check');
    expect(planFor('gto', 'dry', 'bet', 'air').act).toBe('check');
    expect(planFor('gto', 'dry', 'facing', 'air').act).toBe('fold');
    const p = planOn(c('Ks7h2d'), 'value', false, 'nit');
    expect(p.kind).toBe('dry');
    expect(p.base).toBeTruthy();
    expect(p.exploit).toBeTruthy();
  });
  it('composition and plan add up', () => {
    const board = c('9hKh2h');
    const w = new Float64Array(N).fill(1);
    const rows = composition(w, board, 0);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 6);
    const b = bucketsOn(board);
    const best = new Int8Array(N).map((_, i) => (b[i] < 0 ? -1 : b[i] <= BUCKET_KEYS.indexOf('value') ? 1 : 0));
    const p = plan(w, board, best, 2);
    expect(p.find(r => r.key === 'nuts').best).toBe(1);
    expect(p.find(r => r.key === 'air').best).toBe(0);
    for (const r of p) expect(r.mix.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 6);
  });
});
