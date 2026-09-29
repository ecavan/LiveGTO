// Regressions for bugs found in review (side pots in the table coach, the EV drill, buckets, leaks).
import { describe, it, expect } from 'vitest';
import { newHand, act, legal } from '../src/engine/ring/game.js';
import { ringCoach } from '../src/engine/ring/coach.js';
import { newHeroStats } from '../src/engine/ring/players.js';
import { ids, classify } from '../src/engine/hu/hand.js';
import { bucketOf } from '../src/engine/buckets.js';
import { DRILLS } from '../src/engine/drills.js';
import { leakOf } from '../src/engine/history.js';
import { createLog, logAction, gradeLog, toHistory } from '../src/engine/livelog.js';

const c = (s) => ids(s.match(/../g));
const pl = (mix) => ({ name: 'x', mix, learn: 0, ramp: 120 });

describe('table coach: side pots and all-ins', () => {
  it('a bluff can\'t win the main pot from a player who is already all-in', () => {
    const table = { players: [null, pl({ nit: 1 }), pl({ nit: 1 })] };
    let s = newHand({ n: 3, btn: 0, stacks: [100, 20, 100], holes: [c('3s2h'), c('AhAd'), c('9c8c')], board: c('KsQd7h4c5d') });
    for (const a of [{ type: 'raise', to: 3 }, { type: 'allin' }, { type: 'call' }, { type: 'call' }, { type: 'check' }]) s = act(s, a);
    const k = ringCoach(s, 0, table, newHeroStats());
    const check = k.options.find(o => o.type === 'check');
    for (const o of k.options) if (o.type !== 'check') expect(o.ev).toBeLessThan(check.ev + 1);
    expect(k.options[k.best].type).toBe('check');
  });
  it('a call only wins what you can match from each player', () => {
    const table = { players: [null, pl({ station: 1 }), pl({ station: 1 })] };
    let s = newHand({ n: 3, btn: 1, stacks: [20, 100, 100], holes: [c('9s8s'), c('AhKh'), c('QdQc')], board: c('2c7h9d3cTh') });
    s = act(s, { type: 'raise', to: 50 });
    s = act(s, { type: 'call' });
    const k = ringCoach(s, 0, table, newHeroStats());
    const call = k.options.find(o => o.type === 'call');
    const C = legal(s).callAmount;
    const winnable = 20 + 20 + 1 + C; // 20 from each opponent, your 1, your call
    expect(call.ev).toBeCloseTo(k.equity * winnable - C, 1);
    expect(call.info.need).toBeCloseTo(C / winnable, 3);
  });
  it('a bet bigger than his stack only risks what he can call', () => {
    const table = { players: [null, pl({ station: 1 })] };
    let s = newHand({ n: 2, btn: 0, stacks: [100, 25], holes: [c('AsAd'), c('KhQh')], board: c('Ac7h2d3cTh') });
    for (const a of [{ type: 'call' }, { type: 'check' }, { type: 'check' }]) s = act(s, a);
    const k = ringCoach(s, 0, table, newHeroStats(), { type: 'raise', to: 24 });
    const bet24 = k.options.find(o => Math.abs(o.to - 24) < 0.01);
    const shove = k.options.find(o => o.type === 'allin');
    // the shove and a bet of his whole stack are the same bet for him
    expect(shove.info.fold).toBeCloseTo(bet24.info.fold, 2);
    expect(shove.ev).toBeCloseTo(bet24.ev, 0);
  });
});

describe('small fixes', () => {
  it('EV of a call: the pot already holds his bet', () => {
    let seed = 1; const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 200; i++) {
      const q = DRILLS.ev.gen(r);
      const [P, C] = [...q.prompt.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
      const e = Number(q.prompt.match(/(\d+)% equity|<b>(\d+)%<\/b>/).slice(1).find(Boolean)) / 100;
      const ev = e * P - (1 - e) * C;
      const want = `${ev >= 0 ? '+' : '−'}$${Math.abs(Math.round(ev))}`;
      expect(q.options[q.correct]).toBe(want);
    }
  });
  it('buckets: the nut flush with the ace on board; quads on board', () => {
    expect(bucketOf(c('KhQc'), c('Ah7h4h2h9c'))).toBe('nutted');
    expect(bucketOf(c('QhJc'), c('Ah7h4h2h9c'))).toBe('vulnerable');
    expect(classify(c('3c2d'), c('7h7c7d7s'))).toBe('air');
    expect(classify(c('Ac2d'), c('7h7c7d7s'))).toBe('strong');
  });
  it('preflop leaks: a check where the chart raises is passive, not sizing', () => {
    const d = { street: 0, pot: 2, toCall: 0, verdict: 'mistake', loss: 0.5, best: 1, chosen: 0, options: [{ type: 'check' }, { type: 'raise' }] };
    expect(leakOf(d)).toBe('pre-passive');
    expect(leakOf({ ...d, best: 0, chosen: 1 })).toBe('pre-overaggro');
  });
  it('live log: when you folded, your result is known even if they showed nothing', () => {
    const L = createLog({ stakes: '1/2', pos: 'BB', hole: c('7c2d'), stack: 200 });
    logAction(L, { type: 'raise', to: 3 }); // UTG
    for (let i = 0; i < 3; i++) logAction(L, { type: 'call' }); // HJ, CO, BTN
    logAction(L, { type: 'fold' }); // SB
    logAction(L, { type: 'fold' }); // you
    L.boardCards = c('KsQd7h4c5d');
    for (let st = 0; st < 3; st++) for (let i = 0; i < 4; i++) logAction(L, { type: 'check' });
    const h = toHistory(L, gradeLog(L));
    expect(h.net).toBe(-1);
  });
});

describe('uncalled chips come back, and are not a pot', () => {
  it('a shove called by a shorter stack: the loser is not tagged a winner', async () => {
    const { cardId } = await import('../src/engine/hu/hand.js');
    const { potShown } = await import('../src/engine/ring/game.js');
    const c = (x) => x.split(' ').map(cardId);
    // seat 0 BTN (100bb) shoves 72o, seat 1 SB folds, seat 2 BB (30bb) calls with AA
    let s = newHand({ n: 3, btn: 0, stacks: [100, 100, 30], holes: [c('7h 2c'), c('9d 8d'), c('As Ad')], board: c('Kc Qd 5s 4h 3c') });
    s = act(s, { type: 'allin' });
    s = act(s, { type: 'fold' });
    s = act(s, { type: 'call' });
    expect(s.done).toBe(true);
    expect(s.result.winners).toEqual([2]);
    expect(s.result.won[0]).toBe(0);
    expect(s.result.refund[0]).toBeCloseTo(70, 5);
    expect(s.result.won[2]).toBeCloseTo(60.5, 5);
    expect(potShown(s)).toBeCloseTo(60.5, 5);
    expect(s.stacks[0]).toBeCloseTo(70, 5);
  });
  it('everyone folds to a shove: the pot is the blinds plus the matched part', async () => {
    const { potShown } = await import('../src/engine/ring/game.js');
    let s = newHand({ n: 3, btn: 0, stacks: [100, 100, 100] });
    s = act(s, { type: 'allin' });
    s = act(s, { type: 'fold' });
    s = act(s, { type: 'fold' });
    expect(s.result.won[0]).toBeCloseTo(2.5, 5); // SB 0.5 + BB 1 + the 1bb of the shove the BB level matched
    expect(potShown(s)).toBeCloseTo(2.5, 5);
    expect(s.result.refund[0]).toBeCloseTo(99, 5);
  });
});

describe('a type that "never" takes an action still gets a range', () => {
  it('a Station who raises preflop is read as holding something, not nothing', async () => {
    const { createLog, logAction, stateOf, legal, posOf, gradeLog } = await import('../src/engine/livelog.js');
    const { cardId } = await import('../src/engine/hu/hand.js');
    const L = createLog({ stakes: '1/3', pos: 'CO', hole: [cardId('Kd'), cardId('Qh')], stack: 400, others: 250 });
    const UTG = [0, 1, 2, 3, 4, 5].find(i => posOf(stateOf(L), i) === 'UTG');
    L.types[UTG] = 'station';
    logAction(L, { type: 'raise', to: 4 }); logAction(L, { type: 'fold' }); logAction(L, { type: 'raise', to: 10 });
    for (let k = 0; k < 3; k++) logAction(L, { type: 'fold' });
    logAction(L, { type: 'call' });
    L.boardCards.push(cardId('Ah'), cardId('7c'), cardId('2d'));
    logAction(L, { type: 'check' }); logAction(L, { type: 'raise', to: 11 }); logAction(L, { type: 'call' });
    L.boardCards.push(cardId('9s'));
    logAction(L, { type: 'allin', to: legal(stateOf(L)).maxTo });
    logAction(L, { type: 'call' });
    const { decisions } = gradeLog(L);
    const turn = decisions.find(d => d.street === 2);
    const tot = Object.values(turn.range).reduce((a, b) => a + b, 0);
    expect(tot).toBeGreaterThan(0.5);
    expect(turn.equity).toBeLessThan(0.3);
    expect(turn.options[turn.best].type).toBe('fold');
  });
});
