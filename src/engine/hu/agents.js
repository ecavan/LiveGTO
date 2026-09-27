/**
 * Every opponent in Play behind one interface.
 *
 *   profile bots  whale · station · nit · maniac · reg   a style by hand class (bots.js)
 *   thinking bots shark · pro                            EV vs a read of your range (thinker.js)
 *
 * Every bot learns you, like a chess bot of its rating would: each keeps a read of your player
 * type (thinker.js `learn`, at its own learning rate). A profile bot then shifts part of its play,
 * α ≤ α_max, from its style towards the thinking bot's exploit of that read; α grows with the
 * hands it has seen (ramp). A whale adjusts little and late, a reg more and sooner, the Pro fully.
 *
 * policyAll(agent, s) gives the strategy for every combo at once, which is what the coach and
 * the range reader need. Elo ratings come from scripts/ladder.mjs (round robin, fitted).
 */
import { profilePolicyAll, probOf, stateKey, matchOption, keyedMenu } from './policy.js';
import { thinkerPolicyAll, newModel, learn, topRead, HERO_TYPES } from './thinker.js';
import { replay } from './game.js';
import { comboIndex } from './equity.js';
import { BOT_TYPES } from './bots.js';
import LADDER from './ladder.json';

export const AGENTS = {
  whale: {
    name: 'Whale', kind: 'profile', learn: { rate: 0.15, max: 0.2, ramp: 300 },
    blurb: 'Plays half his hands, limps and calls, chases every draw, bets only when he hits. Notices you only very slowly.',
  },
  station: {
    name: 'Station', kind: 'profile', learn: { rate: 0.2, max: 0.25, ramp: 250 },
    blurb: 'Calls far too much and rarely raises. When he bets, he has it. Value-bet him thin; never bluff.',
  },
  nit: {
    name: 'Nit', kind: 'profile', learn: { rate: 0.25, max: 0.35, ramp: 150 },
    blurb: 'Tight and scared. Folds too much to aggression; his big bets are the nuts. Steal and fold.',
  },
  maniac: {
    name: 'Maniac', kind: 'profile', learn: { rate: 0.2, max: 0.3, ramp: 200 },
    blurb: 'Raises and bluffs relentlessly. Call him down lighter and let him hang himself.',
  },
  reg: {
    name: 'Reg', kind: 'profile', learn: { rate: 0.35, max: 0.5, ramp: 100 },
    blurb: 'A solid regular with sensible ranges and few leaks. Adjusts to you over a session.',
  },
  shark: {
    name: 'Shark', kind: 'thinker', tau: 0.08, adaptive: true, preflopEV: true, learn: { rate: 0.3 },
    blurb: 'Plays every hand by EV against your likely range. A little looser than the Pro, and slower to adjust.',
  },
  pro: {
    name: 'Pro', kind: 'thinker', tau: 0.03, adaptive: true, preflopEV: true, learn: { rate: 0.5 },
    blurb: 'Reads your range, learns your habits fast and adjusts: bluff too much and he calls you down.',
  },
};
/** The exploit a profile bot drifts towards (a thinking bot with its read of you). */
const EXPLOIT = { kind: 'thinker', tau: 0.08, preflopEV: true };
export const AGENT_IDS = Object.keys(AGENTS);

/** Elo from the ladder (fitted), with a fallback ordering. */
export const eloOf = (id) => LADDER.elo?.[id] ?? { whale: 900, station: 1000, nit: 1100, maniac: 1150, reg: 1400, shark: 1600, pro: 1750 }[id];

/** A word for an Elo. */
export function levelOf(elo) {
  return elo < 1000 ? 'Beginner' : elo < 1250 ? 'Easy' : elo < 1500 ? 'Intermediate' : elo < 1800 ? 'Strong' : 'Expert';
}

export function createAgent(id) {
  return { id, ...AGENTS[id], model: newModel() };
}

const memo = new Map();
const piSig = (a) => HERO_TYPES.map(t => (a.model.pi[t] ?? 0).toFixed(4)).join(',');

/** How far a profile bot has shifted from its style towards exploiting you (0 … α_max). */
export function adaptation(agent) {
  if (agent.kind !== 'profile' || !agent.learn) return agent.kind === 'thinker' ? 1 : 0;
  const { max, ramp } = agent.learn;
  return max * Math.min(1, (agent.model?.hands ?? 0) / ramp);
}

function memoGet(k, make) {
  let v = memo.get(k);
  if (!v) {
    v = make();
    memo.set(k, v);
    if (memo.size > 200) memo.delete(memo.keys().next().value);
  }
  return v;
}

/** (1 − α)·a + α·b, over the union of their options. */
function blend(a, b, alpha) {
  const opts = a.opts.map(o => ({ ...o }));
  const P = a.P.map(arr => arr.map(x => x * (1 - alpha)));
  b.opts.forEach((o, k) => {
    let j = opts.findIndex(x => x.type === o.type && Math.abs((x.to ?? -1) - (o.to ?? -1)) < 0.011);
    if (j < 0) { j = opts.length; opts.push({ ...o }); P.push(new Float64Array(a.P[0].length)); }
    const src = b.P[k];
    for (let i = 0; i < src.length; i++) P[j][i] += alpha * src[i];
  });
  return { opts, P };
}

/** The agent's strategy at `s` for every combo (the agent is the player to act). */
export function policyAll(agent, s) {
  if (agent.kind === 'profile') {
    const base = profilePolicyAll(agent.id, s, s.toAct);
    const alpha = adaptation(agent);
    if (alpha < 0.01) return base;
    const k = `${agent.id}|${alpha.toFixed(3)}|${piSig(agent)}|${stateKey(s)}`;
    return memoGet(k, () => blend(base, thinkerPolicyAll(EXPLOIT, agent.model, s, replay), alpha));
  }
  const k = `${agent.id}|${piSig(agent)}|${stateKey(s)}`;
  return memoGet(k, () => thinkerPolicyAll(agent, agent.model, s, replay, (b) => policyAll(agent, b)));
}

/** Pick the agent's action for its real hand. */
export function choose(agent, s, rand = Math.random) {
  const seat = s.toAct;
  const [a, b] = s.holes[seat];
  const i = comboIndex(a, b);
  const pol = policyAll(agent, s);
  let x = rand();
  let pick = pol.opts[pol.opts.length - 1];
  for (let k = 0; k < pol.opts.length; k++) {
    x -= pol.P[k][i];
    if (x <= 0) { pick = pol.opts[k]; break; }
  }
  // map back onto the live menu (labels, exact amounts)
  const m = keyedMenu(s);
  const j = matchOption(m, pick);
  return j >= 0 ? m[j] : pick;
}

/** Probability, per combo, that the agent took `action` at `s`. */
export function actionProb(agent, s, action) {
  return probOf(policyAll(agent, s), action);
}

/** Let the agent learn from a finished hand: every bot updates its read of you, at its own rate. */
export function handEnded(agent, s, agentSeat) {
  const rate = agent.learn?.rate ?? 0.5;
  learn(agent.model, s, 1 - agentSeat, replay, { adaptive: agent.adaptive !== false, rate });
}

/** "He reads you as: Maniac (64%)" once he has seen enough hands to start adjusting. */
export function readOfYou(agent) {
  if (agent.model.hands < 5 || (agent.kind === 'profile' && adaptation(agent) < 0.03)) return null;
  const r = topRead(agent.model);
  return { ...r, name: r.type === 'random' ? 'Wild' : (BOT_TYPES[r.type]?.name ?? r.type), adapt: adaptation(agent) };
}
