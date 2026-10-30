// Postflop grading is the solver's plan for the hero's bucket, not the best response to a bot:
// the two hands from a real session that the old coach got backwards.
import { describe, it, expect } from 'vitest';
import { newHand, act, menu, BTN, BB } from '../src/engine/hu/game.js';
import { ids } from '../src/engine/hu/hand.js';
import { coach } from '../src/engine/hu/coach.js';
import { createAgent } from '../src/engine/hu/agents.js';
import { actCategory, gradeWithPlan, solidPlan, CHART_MIN } from '../src/engine/solid.js';

const pick = (s, type, to = null) => { const o = menu(s).find(m => m.type === type && (to == null || Math.abs(m.to - to) < 0.02)); if (!o) throw new Error(`no ${type} ${to}`); return act(s, o); };

/** BTN opens 2.5, BB calls; then the flop. Hero = BB. */
function bbCallsOpen(heroCards, villainCards, board) {
  let s = newHand({ holes: [ids(villainCards), ids(heroCards)], board: ids(board) });
  s = pick(s, 'raise', 2.5);
  s = pick(s, 'call');
  return s;
}

describe('solid grading', () => {
  it('categorises the menu: 33% is a small bet, 75% a big one, an all-in facing a bet is a raise', () => {
    const s = bbCallsOpen(['Kd', 'Jd'], ['Ks', '4d'], ['3h', '9d', '2c', 'Qd', '3s']);
    const ctx = { myBet: 0, pot: 5.5, facing: false };
    const cats = menu(s).map(o => actCategory(o, ctx));
    expect(cats).toEqual(['check', 'bet small', 'bet big', 'bet big']);
    const s2 = act(s, menu(s)[2]); // BB bets 75%
    const ctx2 = { myBet: 0, pot: 9.6, facing: true };
    expect(menu(s2).map(o => actCategory(o, ctx2))).toEqual(['fold', 'call', 'raise', 'raise']);
  });

  it('K♦J♦ in the big blind on 3♥9♦2♣: checking to the raiser is on the plan, a donk bet with air is not', () => {
    const s = bbCallsOpen(['Kd', 'Jd'], ['Ks', '4d'], ['3h', '9d', '2c', 'Qd', '3s']);
    expect(s.toAct).toBe(BB);
    const k = coach(s, BB, createAgent('reg'), { level: 1 });
    expect(k.solid).toBeTruthy();
    expect(k.solid.bucket).toBe('eqair');
    expect(k.solid.source).toBe('donk'); // first to act against the raiser: the library has no such spot, the rule applies
    expect(k.options[k.best].type).toBe('check');
    expect(k.losses[k.best]).toBe(0);
    const big = k.options.findIndex(o => o.type === 'bet' && /75%/.test(o.label));
    expect(k.fine).not.toContain(big);
    expect(k.losses[big]).toBeGreaterThanOrEqual(0.25);
  });

  it('king-high on the river facing a bet: fold is the play, shoving is a mistake whatever the model says', () => {
    let s = bbCallsOpen(['Kd', 'Jd'], ['Ks', '4d'], ['3h', '9d', '2c', 'Qd', '3s']);
    // check-call, check-call, check, bet
    s = pick(s, 'check'); s = act(s, menu(s).find(o => o.type === 'bet' && /75%/.test(o.label))); s = pick(s, 'call');
    s = pick(s, 'check'); s = act(s, menu(s).find(o => o.type === 'bet' && /75%/.test(o.label))); s = pick(s, 'call');
    s = pick(s, 'check'); s = act(s, menu(s).find(o => o.type === 'bet' && /75%/.test(o.label)));
    expect(s.street).toBe(3);
    expect(s.toAct).toBe(BB);
    const k = coach(s, BB, createAgent('reg'), { level: 1 });
    expect(k.solid.bucket).toBe('air');
    expect(k.solid.role).toBe('vs_cbet');
    expect(k.options[k.best].type).toBe('fold');
    const shove = k.options.findIndex(o => o.type === 'allin');
    expect(k.fine).not.toContain(shove);
    expect(k.losses[shove]).toBeGreaterThan(0);
    // the model may still like the shove: that is what the EV bars show, not what is graded
    expect(k.solid.modelBest).toBeDefined();
  });

  it('Level 2 exploits a villain type the solver knows; a Reg, a Shark or a Pro get the GTO plan', () => {
    // hero on the button, checked to after his own raise: the aggressor's spot the library solves
    let s = newHand({ holes: [ids(['Kd', 'Jd']), ids(['Ks', '4d'])], board: ids(['3h', '9d', '2c', 'Qd', '3s']) });
    s = pick(s, 'raise', 2.5); s = pick(s, 'call'); s = pick(s, 'check');
    expect(s.toAct).toBe(BTN);
    const st = coach(s, BTN, createAgent('station'), { level: 2 }).solid;
    expect(st.source).toBe('station');
    expect(st.role).toBe('aggr');
    expect(coach(s, BTN, createAgent('nit'), { level: 2 }).solid.source).toBe('nit');
    expect(coach(s, BTN, createAgent('reg'), { level: 2 }).solid.source).toBe('gto');
    expect(coach(s, BTN, createAgent('pro'), { level: 2 }).solid.source).toBe('gto');
    expect(coach(s, BTN, createAgent('station'), { level: 1 }).solid.source).toBe('gto');
  });

  it('on the plan = any play the solver takes at least a quarter of the time; rare plays are small mistakes', () => {
    const options = [{ type: 'fold', ev: 0 }, { type: 'call', to: 5, ev: 1.2 }, { type: 'raise', to: 15, ev: 2.5 }];
    const g = gradeWithPlan(options, { dist: { fold: 0.5, call: 0.35, raise: 0.15 } }, { myBet: 0, pot: 10, facing: true, nominal: 0.5 });
    expect(g.chart).toEqual(['fold', 'call']);
    expect(g.best).toBe(0);
    expect(g.fine).toEqual([0, 1]);
    expect(g.losses[0]).toBe(0);
    expect(g.losses[1]).toBe(0);
    expect(g.losses[2]).toBe(0.5); // 15%: a small mistake, not what the model says (+2.5)
    const g2 = gradeWithPlan(options, { dist: { fold: 0.9, call: 0.08, raise: 0.02 } }, { myBet: 0, pot: 10, facing: true, nominal: 0.5 });
    expect(g2.fine).toEqual([0]);
    expect(g2.losses[1]).toBe(0.5); // the model says calling beats folding; off the plan still costs the nominal
    expect(CHART_MIN).toBe(0.25);
  });

  it('multiway: bluffs are off the plan, bluff-catchers fold to a big bet', () => {
    const board = ids(['3h', '9d', '2c']);
    const air = solidPlan({ board, hole: ids(['Kd', 'Jd']), facing: false, level: 1, opponents: 3 });
    expect(air.source).toBe('multiway');
    expect(Object.keys(air.dist)).toContain('check');
    const catcher = solidPlan({ board, hole: ids(['9s', '7s']), facing: true, level: 2, villain: 'station', opponents: 2 });
    expect(catcher.source).toBe('multiway');
    expect(catcher.dist.fold).toBeGreaterThan(0);
  });
});
