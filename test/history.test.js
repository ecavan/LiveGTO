import { describe, it, expect } from 'vitest';
import { rng } from '../src/engine/ring/game.js';
import * as RS from '../src/engine/ring/session.js';
import * as HS from '../src/engine/hu/session.js';
import { styleLabel } from '../src/engine/ring/players.js';
import { packHU, packTable, statesOf, viewOf, decisionAt, leakReport, leakOf, grade, accuracyOf, sessionsOf } from '../src/engine/history.js';

describe('hand history', () => {
  it('live-table hands pack small and replay to the same result', () => {
    const rand = rng(21);
    const t = RS.createTable({ n: 6, rand });
    const packed = [];
    for (let h = 0; h < 25; h++) {
      RS.startHand(t, rand);
      let g = 0;
      while (!t.s.done && g++ < 100) {
        if (RS.heroToAct(t)) { const k = RS.coachNow(t); RS.heroAct(t, h % 4 === 0 ? 0 : k.best); } else RS.botAct(t, rand);
      }
      const hand = RS.endHand(t);
      const p = packTable(t, hand, styleLabel);
      packed.push(p);
      const st = statesOf(p);
      expect(st.length).toBe(p.log.length + 1);
      const last = st.at(-1);
      expect(last.done).toBe(true);
      expect(last.result.net[0]).toBeCloseTo(p.net, 6);
      for (const d of p.decisions) {
        expect(st[d.at].toAct).toBe(0);
        expect(decisionAt(p, d.at)).toBe(d);
      }
      expect(viewOf(p, st[0]).board.length).toBe(0);
    }
    const bytes = JSON.stringify(packed).length / packed.length;
    console.log('bytes per table hand', Math.round(bytes));
    expect(bytes).toBeLessThan(6000);
    const rep = leakReport(packed);
    expect(rep.hands).toBe(25);
    expect(accuracyOf(packed)).toBeGreaterThan(0);
    expect(sessionsOf(packed).length).toBe(1);
  });

  it('heads-up hands replay, with the hero on either seat', () => {
    const rand = rng(5);
    const sess = HS.createSession({ botId: 'station' });
    for (let h = 0; h < 12; h++) {
      HS.startHand(sess, rand);
      let g = 0;
      while (!sess.s.done && g++ < 60) {
        if (HS.heroToAct(sess)) { const k = HS.coachNow(sess); HS.heroAct(sess, h % 3 === 0 ? 0 : k.best); } else HS.botAct(sess, rand);
      }
      const hand = HS.endHand(sess);
      const p = packHU(sess, hand, 'Station');
      const st = statesOf(p);
      expect(st.at(-1).done).toBe(true);
      expect(st.at(-1).result.net[p.hero]).toBeCloseTo(p.net, 6);
      for (const d of p.decisions) expect(st[d.at].toAct).toBe(p.hero);
      expect(p.names[p.hero]).toBe('You');
    }
  });

  it('classifies leaks by what you did vs what was best', () => {
    const base = { street: 1, pot: 10, toCall: 5, verdict: 'mistake', loss: 2, equity: 0.4, best: 1 };
    const opts = [{ type: 'fold', label: 'Fold' }, { type: 'call', label: 'Call 5' }, { type: 'raise', label: 'Raise to 15' }];
    expect(leakOf({ ...base, options: opts, chosen: 0 })).toBe('overfold');
    expect(leakOf({ ...base, options: opts, chosen: 1, best: 0 })).toBe('overcall');
    expect(leakOf({ ...base, options: opts, chosen: 1, best: 2 })).toBe('missed-raise');
    const unopened = [{ type: 'check', label: 'Check' }, { type: 'bet', label: 'Bet 7' }];
    expect(leakOf({ ...base, toCall: 0, options: unopened, chosen: 0, best: 1, equity: 0.7 })).toBe('missed-value');
    expect(leakOf({ ...base, toCall: 0, options: unopened, chosen: 1, best: 0, equity: 0.2 })).toBe('bad-bluff');
    expect(leakOf({ ...base, verdict: 'fine', options: opts, chosen: 0 })).toBe(null);
    expect(grade({ verdict: 'mistake', loss: 0.4, pot: 20 })).toBe('inaccuracy');
    expect(grade({ verdict: 'mistake', loss: 4, pot: 30 })).toBe('mistake');
  });
});
