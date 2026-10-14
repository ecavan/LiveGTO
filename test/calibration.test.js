import { describe, it, expect } from 'vitest';
import { newHand, act } from '../src/engine/ring/game.js';
import { playerPolicyAll, ARCHETYPES } from '../src/engine/ring/players.js';
import { streetRole, applyProfile, BASE_OPEN } from '../src/engine/hu/bots.js';
import { ALL_COMBOS } from '../src/engine/hu/hand.js';
import { N } from '../src/engine/hu/equity.js';
import PROFILES from '../src/engine/hu/profiles.json';

const NONE = { adj: 0, vsHero: false, heroInBlinds: false, heroTight: false, heroAggro: false, heroBluffy: false, heroHonest: false };
const pure = (arch) => ({ name: arch, mix: { [arch]: 1 }, learn: 0, ramp: 1 });
/** Share of all 1326 combos that take option `type` (raise / call / fold) at this node. */
function share(arch, s, seat, type) {
  const pol = playerPolicyAll(pure(arch), s, seat, NONE);
  const j = pol.opts.findIndex(o => o.type === type);
  let t = 0;
  for (let i = 0; i < N; i++) t += pol.P[j][i];
  return t / N;
}

describe('whose street it is', () => {
  it('c-bettor, donk bettor, checked to', () => {
    let s = newHand({ n: 3, btn: 0 }); // BTN 0, SB 1, BB 2
    s = act(s, { type: 'raise', to: 3 }); // BTN opens
    s = act(s, { type: 'fold' }); // SB
    s = act(s, { type: 'call' }); // BB
    expect(s.street).toBe(1);
    expect(s.toAct).toBe(2);
    expect(streetRole(s, 2)).toBe('donk'); // the raiser is still to act
    s = act(s, { type: 'check' });
    expect(streetRole(s, 0)).toBe('aggr');
    s = act(s, { type: 'check' }); // no c-bet
    expect(streetRole(s, 2)).toBe('free');
    s = act(s, { type: 'check' });
    expect(streetRole(s, 0)).toBe('free');
  });

  it('role rules only touch their own spots', () => {
    PROFILES.__t = { rules: [{ role: ['donk'], scale: { aggressive: 3 } }] };
    const base = { check: 0.9, small: 0.05, big: 0.05, allin: 0 };
    const ctx = (role) => ({ facing: false, role, street: 'flop', cls: 'air', handType: null });
    const donk = applyProfile('__t', base, ctx('donk'));
    const aggr = applyProfile('__t', base, ctx('aggr'));
    delete PROFILES.__t;
    expect(donk.small + donk.big).toBeCloseTo(0.3, 9);
    expect(aggr.check).toBeCloseTo(0.9, 9);
  });

  it('the baseline barely donk-bets and c-bets often', () => {
    const bet = (t) => t.small + t.big + t.allin;
    for (const c of ['monster', 'strong', 'medium', 'weak', 'draw', 'air']) expect(bet(BASE_OPEN.donk[c])).toBeLessThan(0.12);
    expect(bet(BASE_OPEN.aggr.monster)).toBeGreaterThan(0.6);
    expect(bet(BASE_OPEN.aggr.air)).toBeGreaterThan(bet(BASE_OPEN.donk.air));
  });
});

describe('preflop numbers mean what they say', () => {
  it('first in, a tight archetype raises exactly its open share and never limps', () => {
    for (const arch of ['reg', 'nit', 'pro']) {
      const a = ARCHETYPES[arch].pre;
      // 6-handed, button at 0: UTG is seat 3
      const s = newHand({ n: 6, btn: 0 });
      const r = share(arch, s, 3, 'raise');
      expect(Math.abs(r - a.open.UTG)).toBeLessThan(0.012); // up to one hand type of rounding
      expect(share(arch, s, 3, 'call')).toBeLessThan(a.openLimp.UTG + 0.012);
    }
  });

  it('the opener facing a 3-bet keeps the fitted share of his opening range', () => {
    const a = ARCHETYPES.reg.pre;
    let s = newHand({ n: 6, btn: 0 });
    s = act(s, { type: 'fold' }); // UTG
    s = act(s, { type: 'fold' }); // HJ
    s = act(s, { type: 'raise', to: 3 }); // CO opens (seat 5)
    s = act(s, { type: 'raise', to: 9 }); // BTN 3-bets
    s = act(s, { type: 'fold' }); // SB
    s = act(s, { type: 'fold' }); // BB
    expect(s.toAct).toBe(5);
    const cont = share('reg', s, 5, 'call') + share('reg', s, 5, 'raise') + share('reg', s, 5, 'allin');
    expect(Math.abs(cont - a.vs2[1] * a.open.CO)).toBeLessThan(0.012);
  });

  it('every archetype has the fitted fields', () => {
    for (const a of Object.values(ARCHETYPES)) {
      for (const k of ['open', 'openLimp', 'behind', 'bbIso', 'vs1', 'bb', 'vsIso', 'vs2', 'vs3', 'noise']) expect(a.pre[k]).toBeDefined();
      for (const p of ['UTG', 'HJ', 'CO', 'BTN', 'SB']) expect(a.pre.open[p]).toBeGreaterThan(0);
    }
    expect(ALL_COMBOS.length).toBe(N);
  });
});
