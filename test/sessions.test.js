import { describe, it, expect } from 'vitest';
import { bbOf, makeSession, startSession, endSession, totals, groupBy, curve, profit, toCSV } from '../src/engine/sessions.js';

const S = (date, stakes, buyin, cashout, hours, casino = 'A') => makeSession({ date, stakes, buyin, cashout, hours, casino }).session;

describe('live sessions', () => {
  it('reads the big blind from the stakes', () => {
    expect(bbOf('1/2')).toBe(2);
    expect(bbOf('2/5')).toBe(5);
    expect(bbOf('$5/$10')).toBe(10);
    expect(bbOf('1/2/5')).toBe(5);
    expect(bbOf('')).toBe(null);
  });
  it('validates the form', () => {
    expect(makeSession({ date: '2026-10-01', stakes: '1/2', buyin: '300', cashout: '0', hours: '4' }).session.cashout).toBe(0);
    expect(makeSession({ date: '', stakes: '1/2', buyin: 300, cashout: 0, hours: 4 }).error).toMatch(/date/);
    expect(makeSession({ date: '2999-01-01', stakes: '1/2', buyin: 300, cashout: 0, hours: 4 }).error).toMatch(/future/);
    expect(makeSession({ date: '2026-10-01', stakes: 'x', buyin: 300, cashout: 0, hours: 4 }).error).toMatch(/stakes/);
    expect(makeSession({ date: '2026-10-01', stakes: '1/2', buyin: '', cashout: 0, hours: 4 }).error).toMatch(/bought in/);
    expect(makeSession({ date: '2026-10-01', stakes: '1/2', buyin: 300, cashout: '', hours: 4 }).error).toMatch(/cashed out/);
    expect(makeSession({ date: '2026-10-01', stakes: '1/2', buyin: 300, cashout: 10, hours: 0 }).error).toMatch(/hours/);
    expect(makeSession({ date: '2026-10-01', stakes: '1/2', buyin: '$1,000', cashout: 10, hours: 2 }).session.buyin).toBe(1000);
  });
  it('totals: profit, $/hour, bb/hour, win rate, best and worst', () => {
    const list = [S('2026-10-01', '1/2', 300, 600, 5), S('2026-10-03', '1/2', 400, 100, 3), S('2026-10-05', '2/5', 1000, 1500, 4, 'B')];
    const t = totals(list);
    expect(t.n).toBe(3);
    expect(t.net).toBe(500);
    expect(t.hours).toBe(12);
    expect(t.perHour).toBeCloseTo(41.67, 2);
    // bb: +150 (300/2), −150 (−300/2), +100 (500/5) = 100 bb over 12 h
    expect(t.bbPerHour).toBeCloseTo(8.33, 2);
    expect(t.winRate).toBeCloseTo(2 / 3);
    expect(profit(t.best)).toBe(500);
    expect(profit(t.worst)).toBe(-300);
    expect(t.ci).toBeGreaterThan(0);
    const g = groupBy(list, 'stakes');
    expect(g.map(x => x.key)).toEqual(['1/2', '2/5']);
    expect(g[0].net).toBe(0);
    expect(curve(list).map(p => p.total)).toEqual([300, 0, 500]);
    expect(totals([])).toBe(null);
  });
  it('a running session ends with the clock hours and counts only when finished', () => {
    const run = startSession({ stakes: '1/3', buyin: 300, casino: 'C' });
    expect(run.running).toBe(true);
    expect(totals([run])).toBe(null);
    const done = endSession({ ...run, buyin: 500 }, 800, run.start + 2.5 * 3600000);
    expect(done.running).toBeUndefined();
    expect(done.hours).toBe(2.5);
    expect(profit(done)).toBe(300);
    expect(done.bb).toBe(3);
  });
  it('exports CSV, quoting notes', () => {
    const s = makeSession({ date: '2026-10-01', stakes: '1/2', buyin: 300, cashout: 450, hours: 3, notes: 'tight, "nitty" table' }).session;
    const csv = toCSV([s]);
    expect(csv.split('\n')[0]).toBe('date,casino,stakes,buyin,cashout,profit,hours,notes');
    expect(csv).toContain('"tight, ""nitty"" table"');
    expect(csv).toContain(',150,3,');
  });
});
