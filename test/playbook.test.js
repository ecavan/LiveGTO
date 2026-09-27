import { describe, it, expect } from 'vitest';
import { actionCategory, aggregate, rule } from '../src/engine/playbook.js';

describe('playbook', () => {
  it('normalises action labels', () => {
    expect(actionCategory('bet 33%')).toBe('bet small');
    expect(actionCategory('bet 34%')).toBe('bet small');
    expect(actionCategory('bet 75%')).toBe('bet big');
    expect(actionCategory('all-in')).toBe('all-in');
    expect(actionCategory('call')).toBe('call');
  });
  const book = { entries: [
    { f: 'a', s: 'river', d: 'facing', v: 'station', t: ['rainbow', 'dry', 'unpaired', 'big'],
      c: { medium: [0.4, { fold: 1 }, 0.4, { call: 0.7, fold: 0.3 }], air: [0.2, { fold: 1 }, 0.2, { fold: 1 }] } },
    { f: 'a', s: 'river', d: 'facing', v: 'station', t: ['two-tone', 'connected', 'unpaired', 'mid'],
      c: { medium: [0.2, { call: 1 }, 0.2, { call: 1 }] } },
    { f: 'a', s: 'river', d: 'facing', v: 'gto', t: ['rainbow', 'dry', 'unpaired', 'big'],
      c: { medium: [0.4, { call: 1 }, 0.4, { call: 1 }] } },
  ] };
  it('averages classes weighted by range share, per filter', () => {
    const all = aggregate(book, { profile: 'station' });
    expect(all.n).toBe(2);
    const med = all.rows.find(r => r.class === 'medium');
    expect(med.exploit.fold).toBeCloseTo(0.4 / 0.6); // 0.4 weight folds, 0.2 calls
    expect(med.exploit.call).toBeCloseTo(0.2 / 0.6);
    expect(med.gto.call).toBeCloseTo((0.4 * 0.7 + 0.2) / 0.6);
    const dry = aggregate(book, { profile: 'station', connect: 'dry' });
    expect(dry.n).toBe(1);
    expect(rule(dry.rows.find(r => r.class === 'medium').exploit)).toBe('fold');
    expect(aggregate(book, { profile: '' }).n).toBe(2); // default excludes GTO entries
  });
});
