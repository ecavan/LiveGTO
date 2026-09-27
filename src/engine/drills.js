/**
 * Table-maths drills: endless generated questions with exact answers.
 * Each generator returns { prompt, options: [string], correct: index, explain (HTML), cards?, board? }.
 * Distractors are the classic wrong formulas, so a wrong pick tells you *which* mistake you made.
 */
import { evaluate, category, CAT, ALL_COMBOS, handType, cardStr, rank, suit } from './hu/hand.js';

const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`;
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
const money = (x) => `$${Math.round(x)}`;

/** Shuffle options, keeping track of the correct one; dedupe equal labels. */
function mc(rand, correct, wrong) {
  const seen = new Set([correct]);
  const w = wrong.filter(x => !seen.has(x) && seen.add(x));
  const opts = [correct, ...w.slice(0, 3)];
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return { options: opts, correct: opts.indexOf(correct) };
}

/** Round to a "nice" live bet: multiples of 5 above 20. */
const nice = (x) => (x >= 20 ? Math.round(x / 5) * 5 : Math.round(x));

const SIZES = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25, 1.5, 2];

// ------------------------------------------------------------------ generators

function potOdds(rand) {
  const P = nice(20 + rand() * 280);
  const B = Math.max(5, nice(P * pick(rand, SIZES)));
  const need = B / (P + 2 * B);
  const r = mc(rand, pct(need), [pct(B / (P + B)), pct(B / P > 1 ? 0.5 : B / P), pct(B / (P + 3 * B)), pct(need + 0.08)]);
  return {
    prompt: `The pot is <b>${money(P)}</b>. Villain bets <b>${money(B)}</b>. How much equity do you need to call?`,
    ...r,
    explain: `Call ÷ (final pot) = ${B} ÷ (${P} + ${B} + ${B}) = <b>${pct(need, 1)}</b>. You risk ${money(B)} to win the ${money(P + B)} already out there.
      <div class="text-ink-400 text-xs mt-1">Anchors: ⅓ pot → 20%, ½ → 25%, ⅔ → 28.5%, ¾ → 30%, pot → 33%, 2× → 40%.</div>`,
  };
}

function alphaQ(rand) {
  const P = nice(20 + rand() * 280);
  const B = Math.max(5, nice(P * pick(rand, SIZES)));
  const a = B / (P + B);
  const r = mc(rand, pct(a), [pct(B / (P + 2 * B)), pct(P / (P + B)), pct(Math.min(0.95, B / P)), pct(a + 0.1)]);
  return {
    prompt: `You bluff <b>${money(B)}</b> into <b>${money(P)}</b> with no equity. How often must he fold for the bluff to break even?`,
    ...r,
    explain: `Break-even fold rate α = risk ÷ (risk + reward) = ${B} ÷ (${B} + ${P}) = <b>${pct(a, 1)}</b>.`,
  };
}

function mdfQ(rand) {
  const P = nice(20 + rand() * 280);
  const B = Math.max(5, nice(P * pick(rand, SIZES)));
  const m = P / (P + B);
  const r = mc(rand, pct(m), [pct(B / (P + B)), pct(1 - B / (P + 2 * B)), pct(B / (P + 2 * B)), pct(Math.max(0.05, m - 0.12))]);
  return {
    prompt: `Villain bets <b>${money(B)}</b> into <b>${money(P)}</b>. What is the minimum defence frequency (so his pure bluffs don't profit)?`,
    ...r,
    explain: `MDF = pot ÷ (pot + bet) = ${P} ÷ ${P + B} = <b>${pct(m, 1)}</b>, the other side of his α = ${pct(1 - m, 1)}.
      <div class="text-ink-400 text-xs mt-1">A benchmark, not a rule: live players under-bluff big bets, so fold more against them.</div>`,
  };
}

function bluffShareQ(rand) {
  const P = nice(40 + rand() * 260);
  const s = pick(rand, [0.33, 0.5, 0.75, 1, 1.5, 2]);
  const B = nice(P * s);
  const f = B / (P + 2 * B);
  const r = mc(rand, pct(f), [pct(B / (P + B)), pct(P / (P + B)), pct(B / (2 * P + 2 * B)), pct(f + 0.1)]);
  return {
    prompt: `River. You bet <b>${money(B)}</b> into <b>${money(P)}</b> with a polarised range. What share of your betting range should be bluffs to make his bluff-catchers indifferent?`,
    ...r,
    explain: `He needs ${B} ÷ (${P} + 2·${B}) = <b>${pct(f, 1)}</b> equity to call, so bluffs should be exactly that share of your bets: ${pct(f, 0)} bluffs, ${pct(1 - f, 0)} value.`,
  };
}

function evCallQ(rand) {
  const P = nice(40 + rand() * 200);
  const C = nice(P * pick(rand, [0.5, 0.75, 1, 1.5]));
  const e = pick(rand, [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.55]);
  const ev = e * (P + C) - (1 - e) * C;
  const f = (x) => `${x >= 0 ? '+' : '−'}$${Math.abs(Math.round(x))}`;
  const r = mc(rand, f(ev), [f(e * P - C), f(e * (P + C)), f(e * (P + 2 * C) - (1 - e) * C), f(-ev)]);
  return {
    prompt: `The pot is <b>${money(P)}</b> including his all-in bet. You must call <b>${money(C)}</b> with <b>${pct(e)}</b> equity. EV of calling?`,
    ...r,
    explain: `EV = eq × (what you win) − (1 − eq) × (what you risk) = ${pct(e)} × ${P} − ${pct(1 - e)} × ${C} = <b>${f(ev)}</b>.`,
  };
}

function sprQ(rand) {
  const pot = nice(10 + rand() * 60);
  const stack = nice(pot * (1.5 + rand() * 12));
  const spr = stack / pot;
  const fmt = (x) => x.toFixed(1);
  const r = mc(rand, fmt(spr), [fmt(pot / stack), fmt(spr * 1.5), fmt((stack + pot) / pot), fmt(Math.max(0.5, spr - 2))]);
  const plan = spr <= 3 ? 'Top pair is usually good enough to get it in.' : spr <= 7 ? 'Top pair plays for two streets; commit with overpairs and better.' : 'Deep: one pair is a bluff-catcher; stack off with two pair or better.';
  return {
    prompt: `Flop pot <b>${money(pot)}</b>, effective stack behind <b>${money(stack)}</b>. What is the SPR?`,
    ...r,
    explain: `SPR = stack ÷ pot = ${stack} ÷ ${pot} = <b>${fmt(spr)}</b>. ${plan}`,
  };
}

function geoQ(rand) {
  const pot = nice(10 + rand() * 40);
  const stack = nice(pot * (3 + rand() * 12));
  const streets = pick(rand, [2, 3]);
  const f = (Math.pow(1 + (2 * stack) / pot, 1 / streets) - 1) / 2;
  const r = mc(rand, pct(f), [pct(f * 0.6), pct(Math.min(3, f * 1.5)), pct(stack / pot / streets), pct(f + 0.25)]);
  return {
    prompt: `Pot <b>${money(pot)}</b>, stacks <b>${money(stack)}</b>. What same-size bet (as % of pot) gets all-in over <b>${streets}</b> streets?`,
    ...r,
    explain: `Geometric sizing: f = ((1 + 2S/P)^(1/n) − 1) / 2 = ((1 + 2·${stack}/${pot})^(1/${streets}) − 1)/2 = <b>${pct(f)}</b> of the pot each street.`,
  };
}

// --- outs, from real cards

function deal(rand, n, dead = []) {
  const d = [];
  const used = new Set(dead);
  while (d.length < n) {
    const c = Math.floor(rand() * 52);
    if (!used.has(c)) { used.add(c); d.push(c); }
  }
  return d;
}

/** Cards that turn a non-made hand into a straight or better (clean outs; flush-board/pairing caveats ignored). */
function outsOf(hole, bd) {
  const cur = category(evaluate([...hole, ...bd]));
  if (cur >= CAT.STRAIGHT) return null;
  const dead = new Set([...hole, ...bd]);
  let n = 0;
  for (let c = 0; c < 52; c++) {
    if (dead.has(c)) continue;
    const v = category(evaluate([...hole, ...bd, c]));
    const b = category(evaluate([...bd, c]));
    if (v >= CAT.STRAIGHT && b < CAT.STRAIGHT) n++;
  }
  return n;
}

function outsQ(rand) {
  for (let tries = 0; tries < 400; tries++) {
    const hole = deal(rand, 2);
    const bd = deal(rand, 3, hole);
    if (category(evaluate([...hole, ...bd])) >= CAT.PAIR) continue;
    const n = outsOf(hole, bd);
    if (!n || n < 4) continue;
    const r = mc(rand, String(n), [String(n + 2), String(Math.max(2, n - 2)), String(n + 4), String(n - 1)]);
    return {
      prompt: `You hold these cards on this flop. How many clean outs to a straight or flush?`,
      hole, board: bd,
      ...r,
      explain: `<b>${n} outs</b>. Flush draw 9, open-ended 8, gutshot 4, both a flush draw and an open-ender 15 (the overlap counts once).`,
    };
  }
  return potOdds(rand);
}

function hitQ(rand) {
  const cases = [['a flush draw', 9], ['an open-ended straight draw', 8], ['a gutshot', 4], ['a flush draw plus a gutshot', 12], ['a flush draw plus an open-ender', 15], ['two overcards', 6]];
  const [name, outs] = pick(rand, cases);
  const two = rand() < 0.55;
  const exact = two ? 1 - ((47 - outs) * (46 - outs)) / (47 * 46) : outs / 46;
  const rule = two ? Math.min(outs * 4, 100) / 100 : (outs * 2) / 100;
  const r = mc(rand, pct(exact), [pct(two ? outs / 47 : exact * 2), pct(Math.max(0.02, exact - 0.09)), pct(Math.min(0.9, exact + 0.1)), pct(outs / 100)]);
  return {
    prompt: `On the ${two ? 'flop' : 'turn'}, you have <b>${name}</b> (${outs} outs). Chance to hit by the river${two ? ' (seeing both cards)' : ''}?`,
    ...r,
    explain: `Exact: <b>${pct(exact, 1)}</b>. Rule of ${two ? '4' : '2'}: ${outs} × ${two ? 4 : 2} ≈ ${pct(rule)}.${two ? ' Only use the two-card number if you will see both cards (all-in).' : ''}`,
  };
}

// --- combos, with card removal

const RANKS = '23456789TJQKA';
function combosQ(rand) {
  for (let tries = 0; tries < 200; tries++) {
    const bd = deal(rand, 3);
    const kind = pick(rand, ['pair', 'suited', 'offsuit', 'any', 'set']);
    let key, label, match;
    if (kind === 'set') {
      const r0 = rank(pick(rand, bd));
      label = `sets of ${RANKS[r0]}${RANKS[r0]}`;
      match = (c) => rank(c[0]) === r0 && rank(c[1]) === r0;
    } else {
      const a = Math.floor(rand() * 13);
      const b = kind === 'pair' ? a : Math.floor(rand() * 13);
      if (kind !== 'pair' && a === b) continue;
      const hi = Math.max(a, b), lo = Math.min(a, b);
      key = RANKS[hi] + RANKS[lo];
      label = kind === 'pair' ? `${key}` : kind === 'suited' ? `${key}s` : kind === 'offsuit' ? `${key}o` : `${key} (suited or not)`;
      match = (c) => {
        const t = handType(c);
        if (kind === 'pair') return t === key;
        if (kind === 'suited') return t === key + 's';
        if (kind === 'offsuit') return t === key + 'o';
        return t === key + 's' || t === key + 'o';
      };
    }
    const dead = new Set(bd);
    const n = ALL_COMBOS.filter(c => match(c) && !dead.has(c[0]) && !dead.has(c[1])).length;
    const base = kind === 'pair' || kind === 'set' ? 6 : kind === 'suited' ? 4 : kind === 'offsuit' ? 12 : 16;
    if (n === base && rand() < 0.6) continue; // prefer boards that block something
    const r = mc(rand, String(n), [String(base), String(Math.max(0, n - 1)), String(n + 2), String(Math.max(1, Math.round(n / 2)))]);
    return {
      prompt: `How many combos of <b>${label}</b> are possible on this board?`,
      board: bd,
      ...r,
      explain: `Unblocked: pair 6, suited 4, offsuit 12, any 16. Each board card of that rank removes combos: <b>${n}</b> here.
        <div class="text-ink-400 text-xs mt-1">Pair: C(k,2) for k cards left of the rank. Unpaired: (a × b) for the cards left of each rank; suited only where both suits remain.</div>`,
    };
  }
  return potOdds(rand);
}

function impliedQ(rand) {
  const P = nice(20 + rand() * 80);
  const C = nice(P * pick(rand, [0.5, 0.75, 1]));
  const outs = pick(rand, [4, 8, 9]);
  const e = outs / 46;
  const X = C / e - (P + C);
  const r = mc(rand, money(Math.max(0, X)), [money(C / e), money(Math.max(0, X * 0.5)), money(X + P), money(C * 2)]);
  return {
    prompt: `Turn. Pot <b>${money(P)}</b> after his bet of <b>${money(C)}</b>… you have ${outs} outs (${pct(e, 0)}). How much more must you win on the river when you hit, to break even on the call?`,
    ...r,
    explain: `Break-even: e × (P + C + X) = C → X = C/e − P − C = ${C}/${e.toFixed(3)} − ${P} − ${C} ≈ <b>${money(Math.max(0, X))}</b>.`,
  };
}

// ------------------------------------------------------------------ bet-size feel (timed)

const SIZE_BUCKETS = [
  { max: 0.4, label: 'Small (under 40%)' },
  { max: 0.6, label: 'Half pot (40–60%)' },
  { max: 0.85, label: 'Big (60–85%)' },
  { max: 1.2, label: 'Pot (85–120%)' },
  { max: Infinity, label: 'Overbet (120%+)' },
];
const bucketOf = (f) => SIZE_BUCKETS.findIndex(b => f < b.max);

/**
 * Live dollar amounts, read fast: "the pot is $35, he bets $60". Either name the size or the price.
 * Timed: at the table you get a few seconds, not a calculator.
 */
function feelQ(rand) {
  const raw = 10 + Math.pow(rand(), 1.6) * 390;
  const P = raw > 40 ? Math.round(raw / 5) * 5 : Math.round(raw);
  const f = pick(rand, [0.28, 0.33, 0.4, 0.5, 0.55, 0.66, 0.75, 0.8, 1, 1.1, 1.3, 1.6, 2, 2.5]) * (0.93 + rand() * 0.14);
  const B = Math.max(3, Math.round(P * f / (P * f > 40 ? 5 : 1)) * (P * f > 40 ? 5 : 1));
  const frac = B / P;
  const street = pick(rand, ['flop', 'turn', 'river']);
  if (rand() < 0.5) {
    const k = bucketOf(frac);
    const labels = SIZE_BUCKETS.map(b => b.label);
    const wrong = labels.filter((_, i) => i !== k).sort((a, b) => Math.abs(labels.indexOf(a) - k) - Math.abs(labels.indexOf(b) - k));
    const r = mc(rand, labels[k], wrong);
    return {
      prompt: `${street[0].toUpperCase() + street.slice(1)}. The pot is <b>${money(P)}</b>. He bets <b>${money(B)}</b>. How big is that?`,
      ...r,
      explain: `${B} ÷ ${P} = <b>${(100 * frac).toFixed(0)}% of the pot</b>. Quick read: compare the bet with half the pot (${money(P / 2)}) and the whole pot (${money(P)}).
        <div class="text-ink-400 text-xs mt-1">Live, most big bets on the turn and river are value. Small bets get called wide.</div>`,
    };
  }
  const need = B / (P + 2 * B);
  const anchors = [0.17, 0.2, 0.23, 0.25, 0.27, 0.29, 0.31, 0.33, 0.36, 0.38, 0.4, 0.42, 0.45];
  const near = anchors.reduce((a, x) => (Math.abs(x - need) < Math.abs(a - need) ? x : a), anchors[0]);
  const lab = (x) => `About ${Math.round(100 * x)}%`;
  const wrong = [lab(B / (P + B)), lab(Math.min(0.6, frac)), ...anchors.filter(x => Math.abs(x - near) >= 0.06).sort((a, b) => Math.abs(a - near) - Math.abs(b - near)).map(lab)];
  const r = mc(rand, lab(near), wrong);
  return {
    prompt: `${street[0].toUpperCase() + street.slice(1)}. The pot is <b>${money(P)}</b>. He bets <b>${money(B)}</b>. What equity do you need to call?`,
    ...r,
    explain: `Call ÷ final pot = ${B} ÷ (${P} + ${B} + ${B}) = <b>${(100 * need).toFixed(1)}%</b>. The bet is ${(100 * frac).toFixed(0)}% of the pot.
      <div class="text-ink-400 text-xs mt-1">Anchors: ⅓ pot → 20%, ½ → 25%, ¾ → 30%, pot → 33%, 1.5× → 37.5%, 2× → 40%.</div>`,
  };
}

export const DRILLS = {
  feel: { name: 'Bet-size feel', blurb: 'Dollar bets at table speed: size and price in 8 seconds.', gen: feelQ, group: 'Speed', timed: 8 },
  potodds: { name: 'Pot odds', blurb: 'Equity you need to call a bet.', gen: potOdds, group: 'Price' },
  ev: { name: 'EV of a call', blurb: 'Win × equity − risk × (1 − equity).', gen: evCallQ, group: 'Price' },
  alpha: { name: 'Bluff break-even', blurb: 'How often a bluff must work (α).', gen: alphaQ, group: 'Bluffing' },
  mdf: { name: 'Defence (MDF)', blurb: 'How much of your range to keep vs a bet.', gen: mdfQ, group: 'Bluffing' },
  bluffs: { name: 'Bluff-to-value', blurb: 'The share of bluffs in a river bet.', gen: bluffShareQ, group: 'Bluffing' },
  outs: { name: 'Count your outs', blurb: 'Real cards: straight and flush draws.', gen: outsQ, group: 'Draws' },
  hit: { name: 'Outs to equity', blurb: 'Rule of 2 and 4 vs the exact number.', gen: hitQ, group: 'Draws' },
  implied: { name: 'Implied odds', blurb: 'What you must win later to call now.', gen: impliedQ, group: 'Draws' },
  combos: { name: 'Combos & blockers', blurb: 'Count hands with the board removed.', gen: combosQ, group: 'Ranges' },
  spr: { name: 'SPR', blurb: 'Stack-to-pot ratio and commitment.', gen: sprQ, group: 'Sizing' },
  geo: { name: 'Geometric sizing', blurb: 'One size to get it in over n streets.', gen: geoQ, group: 'Sizing' },
};

export { cardStr, suit };
