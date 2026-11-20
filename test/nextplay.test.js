import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { statesOf } from '../src/engine/history.js';
import { nextPlayHU } from '../src/engine/hu/nextplay.js';
import { cardId } from '../src/engine/hu/hand.js';

const spots = JSON.parse(readFileSync(new URL('../public/spots/flop.json', import.meta.url)));
const list = (spots.spots || spots).filter(s => s.kind === 'hu');

describe('the next card, worked out (heads-up engine spots)', () => {
  it('covers every card that can come, once, and names a play for each', () => {
    let seen = 0;
    for (const sp of list.slice(0, 40)) {
      const s = statesOf(sp).at(-1);
      const best = sp.options[sp.best];
      const r = nextPlayHU(s, sp.hero, best, sp.level === 2 ? sp.opp : 'reg', sp.level);
      if (best.type === 'fold' || best.type === 'allin' || sp.street === 3) { expect(r).toBeNull(); continue; }
      if (!r) continue;
      seen++;
      const used = new Set([...sp.holes[sp.hero], ...sp.runout.slice(0, [0, 3, 4, 5][sp.street])]);
      const total = r.acts.reduce((a, x) => a + x[3], 0);
      expect(total).toBe(52 - used.size); // every card you cannot see

      const named = r.acts.filter(a => a[1] !== '*').flatMap(a => a[1].match(/../g));
      expect(new Set(named).size).toBe(named.length);
      for (const c of named) expect(used.has(cardId(c))).toBe(false);
      expect(r.acts.filter(a => a[1] === '*').length).toBeLessThanOrEqual(1);
      for (const a of r.acts) expect(a[0]).toMatch(/^(Check|Call|Fold|All-in|Bet|Raise)/);
      expect(['hero', 'villain']).toContain(r.first);
    }
    expect(seen).toBeGreaterThan(10);
  }, 120000);
});
