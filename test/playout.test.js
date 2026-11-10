import { describe, it, expect } from 'vitest';
import { nextCards, spotOfDecision, playoutHtml } from '../src/ui/playout.js';
import { streakOf } from '../src/engine/path.js';
import { cardId } from '../src/engine/hu/hand.js';

const c = (s) => s.match(/../g).map(cardId);

describe('play it out', () => {
  it('the next card: every unseen card lands in one bucket, improvements first', () => {
    // top pair good kicker with a backdoor: Value now
    const nc = nextCards(c('QcJd'), c('2c7dJs'));
    expect(nc.now).toBe('value');
    expect(nc.n).toBe(47);
    expect(nc.groups.reduce((a, g) => a + g.n, 0)).toBe(47);
    expect(nc.groups[0].dir).toBeGreaterThanOrEqual(nc.groups.at(-1).dir);
    const same = nc.groups.find(g => g.key === 'value');
    expect(same.n).toBeGreaterThan(20); // most turns change nothing
    expect(nextCards(c('QcJd'), c('2c7dJs4h9s'))).toBe(null); // nothing to come on the river
  });
  it('a bet shows both branches and they add up to the option\'s EV', () => {
    const d = {
      street: 1, board: c('2c7dJs'), hole: c('QcJd'), pot: 6, toCall: 0, chosen: 0, best: 1, fine: [], verdict: 'mistake', loss: 1.5, equity: 0.7, level: 1,
      options: [{ type: 'check', label: 'Check', ev: 4.2, info: {} }, { type: 'bet', to: 4, label: 'Bet 4 (66%)', ev: 5.7, info: { fold: 0.4, eqCalled: 0.6, risk: 4, breakEven: 0.4 } }],
      heroBucket: 'value', solid: { source: 'gto', text: 'Value on a dry board: the solid play is bet big.' },
    };
    const sp = spotOfDecision(d);
    expect(sp.bucket).toBe('value');
    const html = playoutHtml(sp, { open: true });
    expect(html).toContain('The better play: Bet 4bb (66%)');
    expect(html).toContain('40%'); // he folds
    expect(html).toContain('+5.5bb'); // the called branch: (5.7 − 0.4·6) / 0.6
    expect(html).toContain('Then the turn comes');
    expect(html).toContain('What to take away');
    expect(spotOfDecision({ ...d, preflop: true })).toBe(null);
  });
});

describe('today\'s path', () => {
  it('the streak counts back from today or yesterday', () => {
    const now = new Date(2026, 10, 10);
    expect(streakOf(['2026-11-08', '2026-11-09', '2026-11-10'], now)).toBe(3);
    expect(streakOf(['2026-11-08', '2026-11-09'], now)).toBe(2); // today not done yet
    expect(streakOf(['2026-11-07'], now)).toBe(0);
  });
});
