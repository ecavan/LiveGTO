// Head-to-head duplicate matches between two agents (or a crude hero strategy vs an agent).
import { newHand, act, rng, menu } from '../../src/engine/hu/game.js';
import { createAgent, choose, handEnded, AGENTS } from '../../src/engine/hu/agents.js';

const CRUDE = {
  raiser: (s) => menu(s).find(m => m.type === 'raise' && s.street > 0) || menu(s).find(m => m.type === 'check' || m.type === 'call'),
  cbettor: (s) => (s.street > 0 ? menu(s).find(m => m.type === 'bet') : null) || menu(s).find(m => m.type === 'check' || m.type === 'call'),
  shover: (s) => (s.street === 3 ? menu(s).find(m => m.type === 'allin') : null) || menu(s).find(m => m.type === 'check' || m.type === 'call'),
  calldown: (s) => menu(s).find(m => m.type === 'check' || m.type === 'call'),
  flopshover: (s) => (s.street >= 1 ? menu(s).find(m => m.type === 'allin') : null) || menu(s).find(m => m.type === 'check' || m.type === 'call'),
};
/**
 * Duplicate match: each deal is played twice with the seats swapped, so card luck largely
 * cancels. Returns A's win rate in bb/100 with a 95% CI (over deal pairs).
 */
export function match(aId, bId, hands, seed = 1) {
  const rand = rng(seed);
  const A = CRUDE[aId] ? null : createAgent(aId);
  const B = createAgent(bId);
  if (A && process.env.THINK_A) Object.assign(A, JSON.parse(process.env.THINK_A));
  if (process.env.THINK_B) Object.assign(B, JSON.parse(process.env.THINK_B));
  const pairs = [];
  for (let i = 0; i < Math.ceil(hands / 2); i++) {
    const deal = newHand({ rand });
    let pairNet = 0;
    for (const aSeat of [0, 1]) {
      // same cards: A gets what seat aSeat held in the first hand
      const holes = aSeat === 0 ? deal.holes : [deal.holes[1], deal.holes[0]];
      let s = newHand({ holes, board: deal.runout, rand });
      while (!s.done) {
        if (s.toAct === aSeat) s = act(s, A ? choose(A, s, rand) : CRUDE[aId](s));
        else s = act(s, choose(B, s, rand));
      }
      if (A) handEnded(A, s, aSeat);
      handEnded(B, s, 1 - aSeat);
      pairNet += s.result.net[aSeat] - 0.25;
    }
    pairs.push(pairNet / 2);
  }
  const n = pairs.length;
  const m = pairs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(pairs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return { mean: 100 * m, ci: 196 * sd / Math.sqrt(n), model: B.model };
}
