import { describe, it, expect, beforeEach } from 'vitest';
import { candidates, loadStats, saveStats } from '../src/engine/puzzles.js';
import { otherGrade, getLevel, setLevel } from '../src/engine/level.js';
import { facingRole, applyProfile } from '../src/engine/hu/bots.js';
import { rng } from '../src/engine/ring/game.js';
import { createTable, startHand, heroToAct, coachNow, heroAct, botAct, baselineTable, HERO } from '../src/engine/ring/session.js';
import { createSession, startHand as huStart, heroToAct as huToAct, coachNow as huCoach, heroAct as huAct, botAct as huBot } from '../src/engine/hu/session.js';

// a tiny localStorage for the store
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

describe('levels', () => {
  beforeEach(() => mem.clear());

  it('Level 1 by default; the setting sticks', () => {
    expect(getLevel()).toBe(1);
    setLevel(2);
    expect(getLevel()).toBe(2);
  });

  it('library puzzles: Level 1 is the GTO villain, Level 2 the villain types', () => {
    const index = { records: [
      { id: 'a', file: 'f', street: 'turn', profile: 'gto', decision: 'ip_checked_to', ratings: [900] },
      { id: 'b', file: 'f', street: 'river', profile: 'station', decision: 'oop_vs_bet', ratings: [1000] },
      { id: 'c', file: 'g', street: 'turn', profile: 'nit', decision: 'oop_first', ratings: [1200] },
    ] };
    expect(candidates(index, { level: 1 }).map(c => c.id)).toEqual(['a']);
    expect(candidates(index, { level: 1, profile: 'nit' }).map(c => c.id)).toEqual(['a']);
    expect(candidates(index, { level: 2 }).map(c => c.id)).toEqual(['b', 'c']);
    expect(candidates(index, { level: 2, profile: 'nit' }).map(c => c.id)).toEqual(['c']);
    expect(candidates(index, { level: 2, profile: 'gto' }).map(c => c.id)).toEqual(['b', 'c']);
  });

  it('a rating per level; an old rating becomes Level 2', () => {
    mem.set('livegto.puzzles.v1', JSON.stringify({ rating: 1340, played: 50, solved: 30, seen: [], history: [] }));
    expect(loadStats(2).rating).toBe(1340);
    const s1 = loadStats(1);
    expect(s1.rating).toBe(1000);
    s1.rating = 1100; s1.played = 3;
    saveStats(s1);
    expect(loadStats(1).rating).toBe(1100);
    expect(loadStats(2).rating).toBe(1340);
  });

  it('otherGrade: the verdict of the same choice priced at the other level', () => {
    const k = { options: [{ ev: 0 }, { ev: 1.5 }, { ev: 1.45 }], best: 1, fine: [1, 2] };
    expect(otherGrade(k, 1, 10, 1)).toMatchObject({ level: 1, verdict: 'best', loss: 0 });
    expect(otherGrade(k, 2, 10, 1)).toMatchObject({ verdict: 'fine', loss: 0 });
    expect(otherGrade(k, 0, 10, 2)).toMatchObject({ level: 2, verdict: 'mistake', loss: 1.5 });
  });

  it('facing the c-bet vs any other bet (profile role vs_cbet / vs_bet)', () => {
    const s = (log) => ({ street: 1, log });
    const pre = [{ street: 0, seat: 0, type: 'raise' }, { street: 0, seat: 1, type: 'call' }];
    expect(facingRole(s([...pre, { street: 1, seat: 0, type: 'bet' }]))).toBe('vs_cbet');
    expect(facingRole(s([...pre, { street: 1, seat: 1, type: 'bet' }]))).toBe('vs_bet'); // a donk bet
    expect(facingRole(s([...pre, { street: 1, seat: 0, type: 'bet' }, { street: 1, seat: 1, type: 'raise' }]))).toBe('vs_raise');
    expect(facingRole({ street: 1, log: [{ street: 0, seat: 0, type: 'call' }, { street: 1, seat: 1, type: 'bet' }] })).toBe('vs_bet');
    // a vs_cbet rule only touches the c-bet
    const mix = { fold: 0.4, call: 0.5, raise: 0.1, allin: 0 };
    const ctx = { street: 'flop', facing: true, fraction: 0.6, cls: 'air', role: 'vs_cbet' };
    expect(applyProfile('nit', mix, ctx).fold).not.toBeCloseTo(applyProfile('nit', mix, { ...ctx, role: 'vs_bet' }).fold, 3);
  });

  it('the live table grades every postflop decision at both levels', () => {
    const r = rng(11);
    const t = createTable({ n: 4, level: 'easy', coachLevel: 1, rand: r });
    const base = baselineTable(t);
    expect(base.players.slice(1).every(p => p.mix.pro === 1 && p.learn === 0)).toBe(true);
    expect(t.players[1].mix.pro).toBeUndefined(); // the real table is untouched
    let post = 0;
    for (let h = 0; h < 25 && post < 3; h++) {
      startHand(t, r);
      for (let g = 0; g < 80 && !t.s.done; g++) {
        if (heroToAct(t)) {
          const k = coachNow(t);
          const d = heroAct(t, k.best);
          expect(d.level).toBe(1);
          if (d.street > 0) { post++; expect(d.other.level).toBe(2); expect(['best', 'fine', 'mistake', 'blunder']).toContain(d.other.verdict); }
          else expect(d.other).toBeUndefined();
        } else botAct(t, r);
      }
    }
    expect(post).toBeGreaterThan(0);
  });

  it('heads-up Play keeps the level on every decision', () => {
    const sess = createSession({ botId: 'station', level: 2 });
    let post = 0;
    for (let h = 0; h < 30 && post < 2; h++) {
      huStart(sess);
      for (let g = 0; g < 40 && !sess.s.done; g++) {
        if (huToAct(sess)) { const k = huCoach(sess); const d = huAct(sess, k.best); if (d.street > 0) { post++; expect(d.other.level).toBe(1); } }
        else huBot(sess);
      }
    }
    expect(post).toBeGreaterThan(0);
  });
});
