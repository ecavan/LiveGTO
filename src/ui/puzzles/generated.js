/**
 * Flop and multiway spots: puzzles from the Play engines (scripts/gen-spots.mjs). Bots played the
 * hands; at the puzzle's decision the coach priced every option against the real ranges and
 * strategies of the players still in, and one option was clearly best. They're part of the rated
 * puzzles (Puzzles → Rated picks them), and missed ones come back in Review.
 */
import { loadStats, saveStats, updateRating, queueMiss, queueResult } from '../../engine/puzzles.js';
import { statesOf, viewOf, posName } from '../../engine/history.js';
import { AGENTS } from '../../engine/hu/agents.js';
import { cardStr } from '../../engine/hu/hand.js';
import { getIndex } from '../../engine/library.js';
import { ringTable, fmtBB, icon, esc, handText, disc, sprOf, levelSwitch, wireLevel } from '../kit.js';
import { actionBar, coachCard } from '../play/views.js';
import { bucketPlanHtml, bucketStepHtml, gradeBucket, recordBucket } from '../buckets.js';
import { puzzleTabs } from './tabs.js';
import { filterPanel, wireFilters, filters } from './filters.js';
import { navigate } from '../../router.js';

const sets = {};
const STREET = ['Preflop', 'Flop', 'Turn', 'River'];
const byRank = (h) => [...h].sort((a, b) => (b >> 2) - (a >> 2));

export async function loadSet(kind) {
  if (!sets[kind]) {
    const res = await fetch(`/spots/${kind}.json`);
    if (!res.ok) throw new Error('Puzzle set not found');
    sets[kind] = (await res.json()).spots;
  }
  return sets[kind];
}

const genKey = (kind, id) => `gen:${kind}#${id}`;
let index = null;

/**
 * One spot: { rated: { kind, id } } as a rated puzzle, or { review: queue item } (unrated).
 */
export async function render(container, kind, { review = null, rated = null } = {}) {
  container.innerHTML = `<div class="page text-ink-400">Loading puzzles…</div>`;
  let spots;
  try { spots = await loadSet(kind); } catch (e) {
    container.innerHTML = `<div class="page text-rose-300">${esc(e.message)}. Build it with <code>npx vite-node scripts/gen-spots.mjs</code>.</div>`;
    return undefined;
  }
  index = await getIndex().catch(() => null);
  const id = review ? review.i : rated?.id;
  const spot = spots.find(x => x.id === id);
  if (!spot) {
    // the spot sets were rebuilt and this one is gone: drop it from the queue
    if (review) { const st = loadStats(); st.queue = (st.queue || []).filter(x => x.k !== review.k); saveStats(st); }
    navigate(review ? 'puzzles/review' : 'puzzles');
    return undefined;
  }
  const p = make(kind, spot, !!review);
  p.ref = rated;
  draw(container, p);
  const onKey = (e) => {
    if (!container.isConnected) return;
    if (/^[1-9]$/.test(e.key)) {
      const ask = container.querySelectorAll('#bk-ask [data-bk]');
      if (ask.length) ask[Number(e.key) - 1]?.click();
      else container.querySelector(`#gz-acts [data-i="${Number(e.key) - 1}"]`)?.click();
    }
    if (e.key === 'Enter' || e.key === ' ') { const b = container.querySelector('#gz-next'); if (b) { e.preventDefault(); b.click(); } }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

function make(kind, spot, review) {
  const states = statesOf(spot);
  return { kind, spot, s: states.at(-1), answered: null, review };
}

function tableHtml(p) {
  const { spot: h, s } = p;
  const v = viewOf(h, s);
  const order = Array.from({ length: v.n }, (_, j) => (h.hero + j) % v.n);
  const names = h.names || (h.hero === 0 ? ['You', AGENTS[h.opp]?.name ?? 'Villain'] : [AGENTS[h.opp]?.name ?? 'Villain', 'You']);
  const tags = {};
  for (const e of h.log) if (e.street === s.street) tags[e.seat] = { lab: e.type === 'fold' ? 'Fold' : e.type === 'check' ? 'Check' : e.type === 'call' ? `Call ${e.amount}` : e.type === 'bet' ? `Bet ${e.amount ?? e.to}` : e.type === 'raise' ? `Raise ${e.to}` : e.callAllIn ? 'Call all-in' : `All-in ${e.to}`, tone: e.type === 'fold' ? 't-fold' : ['bet', 'raise', 'allin'].includes(e.type) ? 't-aggr' : '' };
  const seats = order.map(i => ({
    name: names[i],
    sub: `${posName(h, i)}${h.styles?.[i] ? ` · ${esc(h.styles[i])}` : ''}`,
    stack: fmtBB(v.stacks[i]),
    cards: i === h.hero ? byRank(h.holes[i]) : v.folded[i] ? null : 'back',
    folded: v.folded[i], dealer: i === v.btn, bet: v.streetBet[i], acting: i === h.hero, hero: i === h.hero,
    tag: tags[i]?.lab, tagTone: tags[i]?.tone,
  }));
  const spr = sprOf({ street: v.street, stacks: v.stacks, streetBet: v.streetBet, pot: v.pot + v.streetBet.reduce((a, b) => a + b, 0), live: order.filter(i => !v.folded[i]), seat: h.hero });
  return ringTable({ seats, board: v.board, pot: v.pot, spr });
}

function lineHtml(p) {
  const h = p.spot;
  const names = h.names || (h.hero === 0 ? ['You', AGENTS[h.opp]?.name ?? 'He'] : [AGENTS[h.opp]?.name ?? 'He', 'You']);
  const rows = [];
  let street = -1;
  for (const e of h.log) {
    if (e.street !== street) { street = e.street; rows.push({ head: STREET[street], cards: street === 0 ? [] : street === 1 ? h.runout.slice(0, 3) : [h.runout[street + 1]], acts: [] }); }
    if (e.type === 'fold' && e.street === 0 && e.seat !== h.hero) continue;
    const you = e.seat === h.hero;
    const a = e.type === 'fold' ? (you ? 'fold' : 'folds') : e.type === 'check' ? (you ? 'check' : 'checks') : e.type === 'call' ? `${you ? 'call' : 'calls'} ${e.amount}` : e.type === 'bet' ? `${you ? 'bet' : 'bets'} ${e.amount ?? e.to}` : e.type === 'raise' ? `${you ? 'raise' : 'raises'} to ${e.to}` : e.callAllIn ? 'calls all-in' : `all-in ${e.to}`;
    rows.at(-1).acts.push(`<span class="${you ? 'text-ink-100' : 'text-amber-200/90'}">${esc(names[e.seat])} ${a}</span>`);
  }
  const bd = [0, 3, 4, 5][p.s.street];
  if (p.s.street > street) rows.push({ head: STREET[p.s.street], cards: p.s.street === 1 ? h.runout.slice(0, 3) : [h.runout[p.s.street + 1]], acts: [] });
  return `<div class="space-y-1 text-sm">${rows.map(l => `<div class="flex gap-2 flex-wrap items-baseline">
    <span class="text-ink-400 w-14 shrink-0">${l.head}</span>${l.cards.length ? `<span class="mr-1">${handText(l.cards.map(cardStr))}</span>` : ''}
    <span class="text-ink-300">${l.acts.join(', ') || '<span class="text-ink-500">—</span>'}</span></div>`).join('')}
    <div class="text-xs text-ink-400 pt-1">${bd ? `Board ${handText(h.runout.slice(0, bd).map(cardStr))} · ` : ''}effective ${fmtBB(Math.min(...h.start))} deep at the start</div></div>`;
}

function whoPanel(p) {
  const h = p.spot;
  if (h.kind === 'hu') {
    const a = AGENTS[h.opp];
    return `<div class="panel panel-pad space-y-1.5"><div class="flex items-center gap-2">
      <span class="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-300 flex items-center justify-center">${icon('bot', 'w-5 h-5')}</span>
      <div><div class="font-semibold text-white">vs ${esc(a?.name ?? h.opp)}</div><div class="text-xs text-ink-400">${esc(a?.blurb ?? '')}</div></div></div></div>`;
  }
  const inHand = h.names.map((n, i) => i).filter(i => i !== h.hero && !p.s.folded[i]);
  return `<div class="panel panel-pad space-y-2"><div class="h-sec">Still in the hand</div>
    ${inHand.map(i => `<div class="flex justify-between text-sm gap-2"><span class="text-white">${esc(h.names[i])} <span class="text-ink-400">${posName(h, i)}</span></span><span class="text-ink-300 text-right">${esc(h.styles[i])}</span></div>`).join('')}</div>`;
}

/** The other level's grade of option `idx` (h.other: { level, best, fine, ev }). */
function otherOf(h, idx) {
  const o = h.other;
  const loss = Math.round(Math.max(0, o.ev[o.best] - o.ev[idx]) * 100) / 100;
  const verdict = idx === o.best ? 'best' : o.fine.includes(idx) ? 'fine' : (loss >= 10 || loss >= 0.25 * h.pot) ? 'blunder' : 'mistake';
  return { level: o.level, best: o.best, fine: o.fine, loss, verdict };
}

function decisionOf(p, idx) {
  const h = p.spot;
  const best = h.options[h.best], o = h.options[idx];
  const loss = idx === h.best || h.fine.includes(idx) ? 0 : Math.round(Math.max(0, best.ev - o.ev) * 100) / 100;
  const verdict = idx === h.best ? 'best' : h.fine.includes(idx) ? 'fine' : (loss >= 10 || loss >= 0.25 * h.pot) ? 'blunder' : 'mistake';
  return {
    street: h.street, board: h.runout.slice(0, [0, 3, 4, 5][h.street]), hole: h.holes[h.hero], pot: h.pot, toCall: h.toCall,
    options: h.options, best: h.best, fine: h.fine, chosen: idx, loss, verdict, equity: h.equity, need: h.need, range: h.range,
    preflop: false, notes: h.notes, opponents: h.opponents, buckets: h.buckets, heroBucket: h.heroBucket,
    other: h.other ? otherOf(h, idx) : null,
  };
}

function draw(container, p) {
  const stats = loadStats();
  const h = p.spot;
  const d = p.answered ? decisionOf(p, p.answered.idx) : null;
  const who = h.kind === 'hu' ? AGENTS[h.opp]?.name ?? 'He' : 'them';
  const evNote = (h.level ?? 2) === 1
    ? `Level 1: EV in bb as if ${h.kind === 'table' ? 'everyone still in' : 'he'} played solid (the baseline), whatever ${h.kind === 'table' ? 'they are' : 'he is'}. ${h.kind === 'table' ? 'Multiway equity by Monte Carlo, one street ahead.' : 'One street ahead.'}`
    : h.kind === 'table' ? `EV in bb against every player still in (${h.opponents}): their ranges and strategies; multiway equity by Monte Carlo, one street ahead.` : null;
  const plan = d && h.plan ? disc('Your range by bucket: a plan for each kind of hand', bucketPlanHtml({ ...h.plan, board: h.runout.slice(0, [0, 3, 4, 5][h.street]) }, {
    hero: h.heroBucket,
    note: h.kind === 'hu' ? 'Your range as a solid player has it on this line; each bucket\'s best play against him.' : 'Your range as a solid player has it; a few hands per bucket priced against everyone still in.',
  }), true) : '';
  const feedback = d ? `<div class="panel panel-pad space-y-3 fade-up">
      ${coachCard(d, { botName: who, evNote })}
      ${plan}
      ${p.review ? '' : `<div class="text-xs text-ink-400 text-center">Rating ${p.answered.before} → <b class="text-white">${stats.rating}</b></div>`}
      <button id="gz-next" class="btn btn-primary btn-lg btn-block">${p.review ? 'Next missed puzzle' : 'Next puzzle'} ${icon('next', 'w-5 h-5')}</button></div>` : '';
  const acc = stats.played ? Math.round((100 * stats.solved) / stats.played) : 0;
  const tag = h.kind === 'hu' ? `Flop · heads-up vs ${esc(AGENTS[h.opp]?.name ?? h.opp)} · ${h.depth ?? 100}bb` : `${STREET[h.street]} · multiway (${h.opponents + 1} players)`;
  container.innerHTML = `<div class="page space-y-4">
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div><div class="h-sec">Puzzles${p.review ? ' · review' : ''}</div><h1 class="h-title">${p.review ? 'Your missed puzzles' : 'Find the best play'}</h1>${p.review ? '' : `<div class="mt-2">${levelSwitch({ blurb: false })}</div>`}
        <p class="muted mt-1 text-sm"><span class="tag">${tag}</span></p></div>
      <div class="flex gap-5 text-right">
        ${p.review ? '' : `<div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Rating · L${stats.level}</div><div class="text-2xl font-semibold num text-emerald-300">${stats.rating}</div></div>
        <div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Solved</div><div class="text-2xl font-semibold num">${acc}%</div></div>`}
        <div><div class="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">Puzzle</div><div class="text-2xl font-semibold num text-ink-200">${h.rating}</div></div>
      </div>
    </div>
    <div>${puzzleTabs(p.review ? 'review' : '')}</div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] gap-5 lg:grid-flow-dense items-start">
      <div class="space-y-4 min-w-0">
        ${tableHtml(p)}
        <div class="text-center text-ink-200">You have ${handText(byRank(h.holes[h.hero]).map(cardStr))}${h.toCall > 0 ? `, facing ${fmtBB(h.toCall)} into ${fmtBB(h.pot - h.toCall)}` : ''}. What's your play?</div>
        ${bucketStepHtml(p.bk, { multiway: h.kind === 'table' && h.opponents > 1, stats, facing: h.toCall > 0, villain: h.kind === 'hu' ? h.opp : null })}
        ${d || !p.bk ? '' : `<div id="gz-acts">${actionBar(h.options)}</div>`}
      </div>
      <div class="space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2">
        ${feedback}
        ${whoPanel(p)}
      </div>
      <div class="space-y-4 min-w-0">
        <div class="panel panel-pad">${lineHtml(p)}</div>
        ${p.review ? '' : filterPanel(index)}
      </div>
    </div>
  </div>`;
  container.querySelectorAll('#gz-acts [data-i]').forEach(b => b.addEventListener('click', (e) => {
    // the second tap of a double tap on a bucket lands on the play buttons that replace them
    if (e.detail && performance.now() - (p.bkAt || 0) < 400) return;
    answer(container, p, Number(b.dataset.i));
  }));
  container.querySelectorAll('#bk-ask [data-bk]').forEach(b => b.addEventListener('click', () => {
    if (p.bk) return;
    p.bkAt = performance.now();
    p.bk = gradeBucket(h.holes[h.hero], h.runout.slice(0, [0, 3, 4, 5][h.street]), b.dataset.bk);
    const st = loadStats();
    recordBucket(st, p.bk);
    saveStats(st);
    draw(container, p);
  }));
  container.querySelector('#gz-next')?.addEventListener('click', () => { navigate(p.review ? 'puzzles/review' : 'puzzles'); window.scrollTo(0, 0); });
  wireFilters(container, () => { if (p.ref) p.ref.answered = true; navigate('puzzles'); });
  wireLevel(container, () => { if (p.ref) p.ref.answered = true; filters.profile = ''; navigate('puzzles'); });
}

function answer(container, p, idx) {
  if (p.answered) return;
  const stats = loadStats();
  const h = p.spot;
  const correct = idx === h.best || h.fine.includes(idx);
  const before = stats.rating;
  const k = genKey(p.kind, h.id);
  if (p.review) queueResult(stats, k, correct);
  else {
    stats.rating = updateRating(stats.rating, h.rating, correct, stats.played);
    stats.played += 1;
    if (correct) stats.solved += 1;
    stats.seen = [...(stats.seen || []), k].slice(-300);
    stats.history = [...(stats.history || []), { id: k, v: correct ? 'best' : 'mistake', d: stats.rating - before }].slice(-500);
    if (!correct) queueMiss(stats, { id: `gen:${p.kind}`, file: null, i: h.id, rating: h.rating });
  }
  saveStats(stats);
  p.answered = { idx, before };
  if (p.ref) p.ref.answered = true;
  window.dispatchEvent(new Event('livegto:ratings'));
  draw(container, p);
}
