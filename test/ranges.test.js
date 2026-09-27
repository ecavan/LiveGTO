import { describe, it, expect } from 'vitest';
import { RFI_RANGES, FACING_OPEN, FACING_OPEN_KEYS, expand, comboShare } from '../src/engine/ranges.js';

describe('preflop charts (The Course)', () => {
  it('every seat has an opening range; UTG is tighter than BTN', () => {
    for (const pos of ['UTG', 'MP', 'CO', 'BTN', 'SB']) expect(RFI_RANGES[pos].has('AA')).toBe(true);
    expect(comboShare(RFI_RANGES.UTG)).toBeLessThan(comboShare(RFI_RANGES.BTN));
  });
  it('facing an open: raise and call sets are disjoint', () => {
    for (const [hero, opener] of FACING_OPEN_KEYS) {
      const { raise, call } = FACING_OPEN[`${hero}|${opener}`];
      for (const k of raise) expect(call.has(k)).toBe(false);
    }
  });
  it('the SB is 3-bet or fold', () => {
    for (const k of Object.keys(FACING_OPEN).filter(k => k.startsWith('SB|'))) expect(FACING_OPEN[k].call.size).toBe(0);
  });
  it('range notation expands correctly', () => {
    expect([...expand('QQ-TT')].sort()).toEqual(['JJ', 'QQ', 'TT']);
    expect([...expand('JTs-98s')].sort()).toEqual(['98s', 'JTs', 'T9s']);
    expect(expand('A2s+').size).toBe(12);
    expect(expand('22+').size).toBe(13);
  });
});
