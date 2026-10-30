/**
 * The play to grade against after the flop: the solver's plan for your bucket of hand on this kind
 * of board (plans.json), not the best response to a bot.
 *
 * The coach's EV model prices every option against one opponent's exact range and fixed strategy,
 * one street ahead, with no raise from him. The best option under that model is a max-exploit of
 * a model — it bluffs whenever the model villain folds a little too much (a donk bet with air into
 * the raiser, a river shove with king-high), which is the opposite of the solid play a learner
 * should be graded on. So the EVs stay (they size the mistakes and show what each option is
 * worth), but "best" and "fine" come from the plan:
 *
 *   Level 1  the GTO plan (how the solver plays against a solver)
 *   Level 2  the solver's exploit of the villain type in front of you (Station, Nit, Maniac,
 *            Whale); against a Reg, a Shark or a Pro there is nothing to exploit, so the GTO plan
 *   Multiway the written multiway plan (buckets.js): bluff much less, fold bluff-catchers
 *
 * The plan is read by role, as the bots see it (bots.js streetRole / facingRole): betting as the
 * previous street's aggressor ('aggr') or after a checked street ('free'); facing the aggressor's
 * bet ('vs_cbet') or anyone else's ('vs_bet'). Two roles the library never solves have rules here:
 * leading into the aggressor ('donk': the solver hardly ever does) and facing a raise ('vs_raise').
 *
 * On the plan = any play the solver takes at least CHART_MIN of the time with that bucket, there.
 */
import { planFor, PLAN_VILLAINS } from './plans.js';
import { bucketOf, boardKind, BUCKET } from './buckets.js';

export const CHART_MIN = 0.25;
/** A play the plan takes less often than this is off the plan (costs the model's loss, at least the nominal). */
const RARE = 0.1;

/** Multiway (two or more opponents): the written plan in buckets.js, as shares. */
export const MULTIWAY_PLAN = {
  nuts: { bet: { 'bet big': 0.8, 'bet small': 0.2 }, facing: { raise: 0.7, call: 0.3 } },
  value: { bet: { 'bet big': 0.6, check: 0.4 }, facing: { call: 0.8, raise: 0.2 } },
  catcher: { bet: { check: 1 }, facing: { call: 0.5, fold: 0.5 } },
  draw: { bet: { check: 0.6, 'bet big': 0.4 }, facing: { call: 0.8, raise: 0.2 } },
  eqair: { bet: { check: 0.9, 'bet small': 0.1 }, facing: { fold: 1 } },
  air: { bet: { check: 1 }, facing: { fold: 1 } },
};

/** Leading into the previous street's aggressor: the solver almost never does, with anything. */
export const DONK_PLAN = {
  nuts: { check: 0.75, 'bet big': 0.15, 'bet small': 0.1 },
  value: { check: 0.85, 'bet small': 0.15 },
  catcher: { check: 1 },
  draw: { check: 0.9, 'bet big': 0.1 },
  eqair: { check: 1 },
  air: { check: 1 },
};
/** Your bet was raised: nuts and strong draws continue, bluff-catchers mostly go, air goes. */
export const VS_RAISE_PLAN = {
  nuts: { raise: 0.6, call: 0.4 },
  value: { call: 0.7, fold: 0.2, raise: 0.1 },
  catcher: { fold: 0.7, call: 0.3 },
  draw: { call: 0.7, fold: 0.2, raise: 0.1 },
  eqair: { fold: 0.95, raise: 0.05 },
  air: { fold: 0.95, raise: 0.05 },
};
const ROLE_KEY = { aggr: 'aggr', free: 'free', vs_cbet: 'vs_cbet', vs_bet: 'vs_bet' };

/** The plan's category of an option: fold · check · call · bet small · bet big · raise. */
export function actCategory(o, { myBet, pot, facing }) {
  if (o.type === 'fold' || o.type === 'check' || o.type === 'call') return o.type;
  if (o.type === 'raise') return 'raise';
  if (o.type === 'allin') return facing ? 'raise' : 'bet big';
  return o.to - myBet < 0.5 * pot - 1e-9 ? 'bet small' : 'bet big';
}

/**
 * The plan for this decision: { source, level, kind, bucket, dist } or null when the solver has
 * nothing for it. `villain`: the profile id of the one opponent (Level 2), or null.
 */
export function solidPlan({ board, hole, facing, role = null, level = 1, villain = null, opponents = 1 }) {
  if (!board?.length) return null;
  const bucket = bucketOf(hole, board);
  const kind = boardKind(board);
  const dec = facing ? 'facing' : 'bet';
  if (opponents >= 2) {
    const dist = MULTIWAY_PLAN[bucket]?.[dec];
    return dist ? { source: 'multiway', role, level, kind, bucket, dist } : null;
  }
  const exploit = level === 2 && villain && PLAN_VILLAINS[villain] ? villain : null;
  // leading into the raiser: not in the library; against a fish who checks back too much, a lead
  // with a strong hand is on the plan too (the EVs say how much it is worth)
  if (role === 'donk') return { source: 'donk', role, level, kind, bucket, dist: exploit && (bucket === 'nuts' || bucket === 'value') ? { check: 0.5, 'bet big': 0.3, 'bet small': 0.2 } : DONK_PLAN[bucket] };
  if (role === 'vs_raise') return { source: 'vs_raise', role, level, kind, bucket, dist: VS_RAISE_PLAN[bucket] };
  const key = ROLE_KEY[role] || dec;
  const pl = planFor(exploit || 'gto', kind, key, bucket) || planFor(exploit || 'gto', kind, dec, bucket);
  if (!pl?.dist) return null;
  return { source: exploit || 'gto', role, level, kind, bucket, dist: pl.dist };
}

/**
 * Grade the options against a plan. `options` carry the model's `ev`; `natural(i)` says whether
 * an option may be the benchmark (an all-in of many times the pot is not).
 * Returns { best, fine, losses, cats, chart, planBest } — losses per option (0 on the plan).
 */
export function gradeWithPlan(options, plan, { myBet, pot, facing, natural = () => true, nominal = 0.25 }) {
  const cats = options.map(o => actCategory(o, { myBet, pot, facing }));
  const offered = new Set(cats);
  // the plan restricted to the plays on offer (a raise the menu lacks goes to its neighbours)
  let tot = 0;
  const share = {};
  for (const [k, v] of Object.entries(plan.dist)) if (offered.has(k)) { share[k] = v; tot += v; }
  if (!(tot > 0)) return null;
  for (const k of Object.keys(share)) share[k] /= tot;
  const ranked = Object.entries(share).sort((a, b) => b[1] - a[1]);
  const chart = ranked.filter(([, v]) => v >= CHART_MIN).map(([k]) => k);
  if (!chart.length) chart.push(ranked[0][0]);
  // within a category, the option the model likes most (the size); the plan's first play is best
  const bestIn = (cat) => {
    let b = -1;
    options.forEach((o, i) => { if (cats[i] === cat && natural(i) && (b < 0 || o.ev > options[b].ev)) b = i; });
    if (b < 0) options.forEach((o, i) => { if (cats[i] === cat && (b < 0 || o.ev > options[b].ev)) b = i; });
    return b;
  };
  const best = bestIn(chart[0]);
  const fine = [];
  options.forEach((o, i) => { if (chart.includes(cats[i]) && (natural(i) || o.ev >= options[bestIn(cats[i])].ev - 1e-9)) fine.push(i); });
  const ref = options[best].ev;
  const losses = options.map((o, i) => {
    if (fine.includes(i)) return 0;
    const s = share[cats[i]] || 0;
    const model = Math.max(0, ref - o.ev);
    // a play the solver takes sometimes (10–25%) is a small mistake whatever the model says;
    // one it hardly ever takes costs what the model says, and at least the nominal
    return Math.round(100 * (s >= RARE ? Math.max(nominal, Math.min(model, 4 * nominal)) : Math.max(nominal, model))) / 100;
  });
  return { best, fine, losses, cats, chart, share, planBest: chart[0] };
}

const SOURCE_NAME = { gto: 'the solid play', multiway: 'the multiway plan', donk: 'the solid play', vs_raise: 'the solid play', station: 'the play against a Station', nit: 'the play against a Nit', maniac: 'the play against a Maniac', whale: 'the play against a Whale' };
const ROLE_NAME = { aggr: 'after your bet', free: 'after a checked street', vs_cbet: 'facing his continuation', vs_bet: 'facing his lead', donk: 'first to act against the raiser', vs_raise: 'facing a raise' };
const KIND_NAME = { dry: 'a dry board', wet: 'a wet board', paired: 'a paired board', monotone: 'a monotone board' };
const CAT_NAME = { fold: 'fold', check: 'check', call: 'call', 'bet small': 'bet small', 'bet big': 'bet big', raise: 'raise' };
const CAT_DOES = { fold: 'folds', check: 'checks', call: 'calls', 'bet small': 'bets small', 'bet big': 'bets big', raise: 'raises' };

/** Where you are, in a few words: "Air with equity on a dry board, after your bet". */
export function planWhere(plan) {
  if (!plan) return '';
  const where = plan.source === 'multiway' ? 'multiway' : `on ${KIND_NAME[plan.kind] || plan.kind}${ROLE_NAME[plan.role] ? `, ${ROLE_NAME[plan.role]}` : ''}`;
  return `${BUCKET[plan.bucket]?.name || plan.bucket} ${where}`;
}

/**
 * One action, never frequencies: "Air with equity on a dry board, after your bet: check. Betting
 * big is fine too (the size of the pot and what is behind decide)." The numbers behind it go in
 * planDetail, for "Why".
 */
export function planSentence(plan, share) {
  if (!plan) return '';
  const ranked = Object.entries(share).sort((a, b) => b[1] - a[1]);
  const chart = ranked.filter(([, v]) => v >= CHART_MIN).map(([k]) => k);
  if (!chart.length) chart.push(ranked[0][0]);
  const [first, ...rest] = chart;
  const also = rest.length ? ` ${rest.map(k => cap(CAT_NAME[k] || k)).join(' or ')} ${rest.length > 1 ? 'are' : 'is'} fine too (the size of the bet and what is behind decide).` : '';
  return `${planWhere(plan)}: ${SOURCE_NAME[plan.source] || plan.source} is ${CAT_NAME[first] || first}.${also}`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The numbers: "the solver checks 59% here, bets big 41%". */
export function planDetail(plan, share) {
  if (!plan) return '';
  const parts = Object.entries(share).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 0.05).map(([k, v]) => `${CAT_DOES[k] || k} ${Math.round(100 * v)}%`);
  const who = plan.source === 'gto' ? 'the solver' : plan.source === 'multiway' ? 'the multiway plan' : plan.source === 'donk' || plan.source === 'vs_raise' ? 'the rule' : `the solver against a ${cap(plan.source)}`;
  return `${who} ${parts.join(', ')} with ${BUCKET[plan.bucket]?.name?.toLowerCase() || plan.bucket} here.`;
}
