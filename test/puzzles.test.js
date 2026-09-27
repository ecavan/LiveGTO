import { describe, it, expect } from 'vitest';
import {
  requiredEquity, alpha, mdf, bluffShare, bluffsPerValue, geometricFraction, hitChance,
} from '../src/engine/potmath.js';
import {
  candidates, pickPuzzle, grade, expectedScore, updateRating, explain, cellOf, cellLabel,
} from '../src/engine/puzzles.js';
import { handType, ids } from '../src/engine/hu/hand.js';
const handToKey = (a, b) => handType(ids([a, b]));

const close = (x, y, d = 1e-3) => expect(Math.abs(x - y)).toBeLessThan(d);

// Reference values: docs/THEORY.md §1 (MoP, Gaines, Acevedo, Janda).
describe('pot math matches the textbooks', () => {
  it('required equity = s/(1+2s)', () => {
    const req = (s) => requiredEquity(1 + s, s); // pot 1, bet s
    close(req(0.25), 1 / 6);
    close(req(1 / 3), 0.2);
    close(req(0.5), 0.25);
    close(req(2 / 3), 2 / 7);
    close(req(0.75), 0.3);
    close(req(1), 1 / 3);
    close(req(2), 0.4);
    expect(requiredEquity(10, 0)).toBe(0);
  });
  it('alpha = s/(1+s), MDF = 1/(1+s)', () => {
    close(alpha(1, 0.5), 1 / 3);
    close(alpha(1, 0.75), 3 / 7);
    close(alpha(1, 1), 0.5);
    close(alpha(1, 2), 2 / 3);
    close(mdf(1, 1), 0.5);
    close(mdf(1, 0.25), 0.8);
    close(alpha(1, 0.6) + mdf(1, 0.6), 1);
  });
  it('bluff share of a polar range = s/(1+2s), not s/(1+s)', () => {
    close(bluffShare(1, 1), 1 / 3); // pot bet: 2 value : 1 bluff
    close(bluffsPerValue(1, 1), 0.5);
    close(bluffShare(1, 0.5), 0.25); // half pot: 3 : 1
    close(bluffShare(1, 0.5), requiredEquity(1.5, 0.5)); // the bluff-catcher is indifferent
  });
  it('geometric sizing (MoP ch.19, Janda)', () => {
    close(geometricFraction(1, 13, 3), 1);
    close(geometricFraction(1, 3.5, 3), 0.5);
    close(geometricFraction(1, 4, 2), 1);
    close(geometricFraction(1, 1, 2), 0.366);
    // Janda: a 7bb pot grows to a ~200bb pot in 3 streets (stacks 96.5bb): ~1.03 pot per street
    close(geometricFraction(7, (200 - 7) / 2, 3), 1.03, 0.01);
  });
  it('exact outs vs the rule of 2/4 (Gaines p.50)', () => {
    close(hitChance(15, 2), 0.541);
    close(hitChance(9, 1), 9 / 47);
    close(hitChance(8, 2), 0.315);
  });
});

describe('13×13 grid cells', () => {
  it('every combo lands in the cell of its hand key', () => {
    const ranks = 'AKQJT98765432';
    const suits = 'shdc';
    const cards = [];
    for (const r of ranks) for (const s of suits) cards.push(r + s);
    let n = 0;
    for (let i = 0; i < 52; i++) {
      for (let j = i + 1; j < 52; j++) {
        const c = cards[i] + cards[j];
        expect(cellLabel(cellOf(c))).toBe(handToKey(cards[i], cards[j]));
        n++;
      }
    }
    expect(n).toBe(1326);
  });
});

const record = {
  pot: 20, to_call: 5, street: 'river',
  actions_short: ['fold', 'call', 'raise'],
  villain: { profile: 'station', name: 'Station', notes: ["doesn't bluff"] },
  villain_range: [['monster', 0.2, 0.3], ['strong', 0.5, 0.6], ['air', 0.3, 0.1]],
  classes: [{ class: 'medium', gto: { weight: 0.3, pure: [0.7, 0.3, 0] }, exploit: { weight: 0.3, pure: [1, 0, 0] } }],
};
const puzzle = { hand: 'K8s', class: 'medium', answer: 0, fine: [0], gto_answer: 1, ev: [0, -3.1, -9], eq: 0.22, rating: 1300 };

describe('grading is by EV', () => {
  it('best / fine / mistake with the cost in bb and % pot', () => {
    expect(grade(puzzle, record, 0)).toMatchObject({ verdict: 'best', correct: true, loss_bb: 0 });
    const g = grade(puzzle, record, 1);
    expect(g.verdict).toBe('mistake');
    close(g.loss_bb, 3.1);
    close(g.loss_pct, 3.1 / 20);
    const fine = grade({ ...puzzle, fine: [0, 1] }, record, 1);
    expect(fine.verdict).toBe('fine');
    expect(fine.correct).toBe(true);
  });
});

describe('Elo like chess puzzles', () => {
  it('expected score and update', () => {
    close(expectedScore(1000, 1000), 0.5);
    close(expectedScore(1000, 1400), 1 / 11, 1e-3);
    expect(updateRating(1000, 1000, true, 50)).toBe(1012);
    expect(updateRating(1000, 1000, false, 50)).toBe(988);
    expect(updateRating(1000, 1000, true, 0)).toBe(1020); // provisional K = 40
  });
});

describe('selection', () => {
  const index = { records: [
    { id: 'a', file: 'f', street: 'turn', profile: 'gto', decision: 'ip_checked_to', family: 'srp', ratings: [900, 1500] },
    { id: 'b', file: 'f', street: 'river', profile: 'station', decision: 'oop_vs_bet', family: 'srp', ratings: [1000] },
    { id: 'c', file: 'g', street: 'turn', profile: 'nit', decision: 'oop_first', family: '3bp', ratings: [1200] },
  ] };
  it('defaults to exploit spots; GTO is opt-in', () => {
    expect(candidates(index).map(c => c.id)).toEqual(['b', 'c']);
    expect(candidates(index, { profile: 'all' })).toHaveLength(4);
    expect(candidates(index, { profile: 'gto' }).map(c => c.rating)).toEqual([900, 1500]);
  });
  it('filters by street, decision type and pot family', () => {
    expect(candidates(index, { street: 'river' })).toHaveLength(1);
    expect(candidates(index, { decision: 'facing' }).map(c => c.id)).toEqual(['b']);
    expect(candidates(index, { decision: 'betting', profile: 'all' }).map(c => c.id)).toEqual(['a', 'a', 'c']);
    expect(candidates(index, { family: '3bp' }).map(c => c.id)).toEqual(['c']);
  });
  it('picks near the rating, skipping seen ones', () => {
    const c = candidates(index, { profile: 'all' });
    expect(pickPuzzle(c, 1480, new Set(), () => 0).rating).toBe(1500);
    expect(pickPuzzle(c, 1480, new Set(['a#1']), () => 0).rating).not.toBe(1500);
    expect(pickPuzzle([], 1000)).toBeNull();
  });
});

describe('explanations', () => {
  it('talk about price, his range and the exploit', () => {
    const pts = explain(record, puzzle);
    const text = pts.map(p => `${p.title}: ${p.body}`).join('\n');
    expect(text).toMatch(/needs 20% equity/); // 5 into 20 → 5/25
    expect(text).toMatch(/A solver would call here/);
    expect(text).toMatch(/Value 70% → 90%/);
    expect(text).toMatch(/doesn't bluff/);
  });
});
