import { describe, it, expect } from 'vitest';
import { createLog, logAction, foldToHero, stateOf, boardNeeded, gradeLog, toHistory, undo, HERO } from '../src/engine/livelog.js';
import { ids } from '../src/engine/hu/hand.js';
import { statesOf } from '../src/engine/history.js';

describe('live hand log', () => {
  it('logs a real hand in dollars, asks for the board, grades every decision with real sizes', () => {
    const L = createLog({ stakes: '1/2', pos: 'BTN', hole: ids(['Ah', 'Kh']), stack: 300, others: 400 });
    expect(L.start[HERO]).toBe(150);
    expect(L.start[1]).toBe(200);
    // UTG limps, HJ folds, CO folds, you raise to $14 (7bb), SB folds, BB calls, UTG calls
    logAction(L, { type: 'call' }); // UTG
    foldToHero(L);
    expect(stateOf(L).toAct).toBe(HERO);
    logAction(L, { type: 'raise', to: 7 });
    logAction(L, { type: 'fold' }); // SB
    L.types[2] = 'station';
    logAction(L, { type: 'call' }); // BB
    logAction(L, { type: 'call' }); // UTG
    expect(boardNeeded(L)).toBe(3);
    L.boardCards = ids(['Kd', '7c', '2s']);
    expect(boardNeeded(L)).toBe(0);
    logAction(L, { type: 'check' }); // BB
    logAction(L, { type: 'check' }); // UTG
    logAction(L, { type: 'bet', to: 11 }); // you bet $22 into $43 (~half pot)
    logAction(L, { type: 'call' }); // BB
    logAction(L, { type: 'fold' }); // UTG
    expect(boardNeeded(L)).toBe(1);
    // undo and redo
    undo(L);
    expect(stateOf(L).street).toBe(1);
    logAction(L, { type: 'fold' });
    L.boardCards.push(ids(['9h'])[0]);
    logAction(L, { type: 'check' });
    logAction(L, { type: 'bet', to: 30 });
    logAction(L, { type: 'fold' });
    const s = stateOf(L);
    expect(s.done).toBe(true);
    const g = gradeLog(L);
    expect(g.decisions.length).toBe(3);
    // the real sizes were priced
    expect(g.decisions[0].options[g.decisions[0].chosen].to).toBeCloseTo(7, 6);
    expect(g.decisions[1].options[g.decisions[1].chosen].to).toBeCloseTo(11, 6);
    const h = toHistory(L, g);
    expect(h.net).toBeGreaterThan(0);
    const st = statesOf(h);
    expect(st.at(-1).done).toBe(true);
    for (const d of h.decisions) expect(st[d.at].toAct).toBe(HERO);
  });
});
