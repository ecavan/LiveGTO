import { describe, it, expect } from 'vitest';
import { flopTexture, textureLabel, boardTags, randomSuitMap, remapCard } from '../src/engine/texture.js';
import { handType, ids } from '../src/engine/hu/hand.js';
const handToKey = (a, b) => handType(ids([a, b]));

const t = (s) => flopTexture(s.match(/../g));

describe('flop texture classes', () => {
  it('suits', () => {
    expect(t('Jh5h9s').suits).toBe('two-tone');
    expect(t('Jd5d9s').suits).toBe('two-tone');
    expect(t('Jc6c3c').suits).toBe('monotone');
    expect(t('Kh9s4d').suits).toBe('rainbow');
  });
  it('connectedness', () => {
    expect(t('9h8c7d').connect).toBe('connected');
    expect(t('QsJh8h').connect).toBe('connected'); // Q-J-8 inside 8..Q
    expect(t('5d4c3h').connect).toBe('connected');
    expect(t('As4d2c').connect).toBe('connected'); // the wheel: A-2-4
    expect(t('Jh9s4d').connect).toBe('semi'); // J-9: gutshots and open-enders
    expect(t('Kh9s4d').connect).toBe('dry');
    expect(t('Jd6s2c').connect).toBe('dry'); // the user's J-6-2
    expect(t('Kc7s2h').connect).toBe('dry');
  });
  it('pairing and height', () => {
    expect(t('7h7d3c').paired).toBe('paired');
    expect(t('7h7d7c').paired).toBe('trips');
    expect(t('As7d2c').height).toBe('ace');
    expect(t('Kh9s4d').height).toBe('big');
    expect(t('Td9d6c').height).toBe('mid');
    expect(t('8s5h2d').height).toBe('mid');
    expect(t('7h5d3c').height).toBe('low');
    expect(textureLabel(t('Jh5h9s'))).toBe('J–8-high · two-tone · semi-connected');
  });
});

describe('what the current board makes possible', () => {
  it('flushes, straights, pairs', () => {
    expect(boardTags('Kh9h4dQh'.match(/../g))).toContain('flush possible');
    expect(boardTags('Kh9h4dQc'.match(/../g))).toContain('flush draw');
    expect(boardTags('Kh9h4dQc2s'.match(/../g))).not.toContain('flush draw');
    expect(boardTags('9h8c7d2s'.match(/../g))).toContain('straight possible');
    expect(boardTags('9h8c7d6s'.match(/../g))).toContain('4 to a straight');
    expect(boardTags('7h7d3c3s'.match(/../g))).toContain('double-paired');
  });
});

describe('suit relabelling keeps the spot identical', () => {
  it('is a permutation and preserves hand type and texture', () => {
    for (let k = 0; k < 50; k++) {
      const m = randomSuitMap();
      expect(new Set(Object.values(m)).size).toBe(4);
      const board = 'Jh5h9sKd'.match(/../g);
      const mapped = board.map(c => remapCard(c, m));
      expect(flopTexture(mapped)).toEqual(flopTexture(board));
      expect(boardTags(mapped)).toEqual(boardTags(board));
      const hole = remapCard('AhKh', m);
      expect(handToKey(hole.slice(0, 2), hole.slice(2))).toBe('AKs');
    }
  });
  it('leaves non-card text alone', () => {
    const m = { s: 'h', h: 's', d: 'c', c: 'd' };
    expect(remapCard('Kc', m)).toBe('Kd');
    expect(remapCard('BTN bet 1.8bb (33%)', m)).toBe('BTN bet 1.8bb (33%)');
    expect(remapCard('AKs', m)).toBe('AKs');
  });
});
