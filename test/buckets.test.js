import { describe, it, expect } from 'vitest';
import { bucketOf, composition, plan, boardDangers, bucketsOn, BUCKET_KEYS } from '../src/engine/buckets.js';
import { ids } from '../src/engine/hu/hand.js';
import { N } from '../src/engine/hu/equity.js';

const c = (s) => ids(s.match(/../g));

describe('hand buckets', () => {
  it('splits monsters by the board and draws by kind', () => {
    expect(bucketOf(c('9h9s'), c('9dKc2s'))).toBe('nutted'); // set, dry board
    expect(bucketOf(c('9s9c'), c('9hKh2h'))).toBe('vulnerable'); // set, three hearts
    expect(bucketOf(c('AhQh'), c('9hKh2h'))).toBe('nutted'); // nut flush
    expect(bucketOf(c('KdQc'), c('KsQh5d'))).toBe('nutted'); // top two, rainbow, no straight
    expect(bucketOf(c('KdQc'), c('KsQhJd'))).toBe('vulnerable'); // top two, straight possible
    expect(bucketOf(c('AhAd'), c('9dTc2s'))).toBe('strong');
    expect(bucketOf(c('AhKh'), c('9h5h2s'))).toBe('fdraw');
    expect(bucketOf(c('8c7d'), c('9hTs2d'))).toBe('sdraw');
    expect(bucketOf(c('AcKd'), c('9h5h2s'))).toBe('air');
    expect(boardDangers(c('9hKh2h'))).toContain('flush possible');
    expect(boardDangers(c('As2d3c'))).toContain('straight possible'); // the wheel
    expect(boardDangers(c('Ks8d2c'))).toEqual([]);
  });
  it('composition and plan add up', () => {
    const board = c('9hKh2h');
    const w = new Float64Array(N).fill(1);
    const rows = composition(w, board, 0);
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 6);
    const b = bucketsOn(board);
    const best = new Int8Array(N).map((_, i) => (b[i] < 0 ? -1 : b[i] <= BUCKET_KEYS.indexOf('strong') ? 1 : 0));
    const p = plan(w, board, best, 2);
    const monsters = p.find(r => r.key === 'nutted');
    expect(monsters.best).toBe(1);
    expect(p.find(r => r.key === 'air').best).toBe(0);
    for (const r of p) expect(r.mix.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 6);
  });
});
