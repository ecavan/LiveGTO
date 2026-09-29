/**
 * Rendering pieces for Play: the table from a hand state, the coach card, the hand recap,
 * the session panel and the review.
 */
import { board, pot, BTN } from '../../engine/hu/game.js';
import { evaluate, category, cardStr, ALL_COMBOS, handType } from '../../engine/hu/hand.js';
import { AGENTS, eloOf, readOfYou } from '../../engine/hu/agents.js';
import { pct } from '../../engine/potmath.js';
import { bucketPlanHtml, bucketBarsHtml, bucketName } from '../buckets.js';
import { optionLabel,
  pokerTable, card, cards, fmtBB, evBars, disc, stat, verdict, icon, esc, rangeGrid, GRID, handText, sprOf,
} from '../kit.js';

export const POS = ['BTN', 'BB'];
const CAT_NAME = ['High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'];
const STREET = ['Preflop', 'Flop', 'Turn', 'River'];

export function handName(hole, bd) {
  return CAT_NAME[category(evaluate([...hole, ...bd]))];
}

/** The table for the live hand. */
const byRank = (h) => [...h].sort((a, b) => (b >> 2) - (a >> 2));

export function liveTable(sess, { thinking = false } = {}) {
  const s = sess.s;
  const hero = sess.hero, vil = 1 - hero;
  const a = AGENTS[sess.botId];
  const bd = s.done ? s.runout.slice(0, s.result?.showdown ? 5 : board(s).length) : board(s);
  const reveal = s.done && s.result.showdown;
  const inPot = s.done ? pot(s) : pot(s) - s.streetBet[0] - s.streetBet[1];
  return pokerTable({
    top: {
      name: a.name, sub: `${eloOf(sess.botId)} · ${POS[vil]}`, stack: fmtBB(s.stacks[vil]),
      cards: reveal ? byRank(s.holes[vil]) : s.folded === vil ? null : 'back', folded: s.folded === vil, dealer: vil === BTN,
    },
    bottom: {
      name: 'You', sub: POS[hero], stack: fmtBB(s.stacks[hero]), cards: byRank(s.holes[hero]), folded: s.folded === hero, dealer: hero === BTN,
    },
    board: bd,
    pot: inPot,
    spr: s.done ? null : sprOf({ street: s.street, stacks: s.stacks, streetBet: s.streetBet, pot: pot(s), live: [0, 1], seat: hero }),
    note: thinking ? `${a.name} is thinking…` : '',
    bets: s.done ? {} : { top: s.streetBet[vil], bottom: s.streetBet[hero] },
    acting: s.done ? null : s.toAct === hero ? 'bottom' : 'top',
  });
}

/** Action buttons for the hero. */
export function actionBar(options, disabled = false) {
  return `<div class="grid gap-2" style="grid-template-columns: repeat(${Math.min(options.length, 3)}, minmax(0, 1fr))">
    ${options.map((o, i) => {
      const cls = o.type === 'fold' ? 'act-fold' : o.type === 'check' || o.type === 'call' ? 'act-pass' : o.type === 'allin' ? 'act-shove' : 'act-aggr';
      const [main, sub] = splitLabel(o.label);
      return `<button class="act ${cls}" data-i="${i}" ${disabled ? 'disabled' : ''}>${main}${sub ? `<small>${sub}</small>` : ''}<span class="absolute top-1.5 right-2 text-[10px] text-ink-400 hidden lg:block">${i + 1}</span></button>`;
    }).join('')}</div>`;
}

/** An option label with its amount in units: "Raise to 9" → "Raise to 9bb" (or dollars in the logger). */
let LABEL_FMT = null;
export const labelText = (label) => optionLabel(label, LABEL_FMT || fmtBB);

function splitLabel(label) {
  // "Bet 3.3 (33%)" → ["Bet 3.3bb", "33% pot"]; "Raise to 9" → ["Raise", "to 9bb"]
  const m = label.match(/^Bet ([\d.]+) \((\d+)%\)$/);
  if (m) return [`Bet ${fmtBB(Number(m[1]))}`, `${m[2]}% pot`];
  const r = label.match(/^Raise to ([\d.]+)$/);
  if (r) return ['Raise', `to ${fmtBB(Number(r[1]))}`];
  const c = label.match(/^Call ([\d.]+)$/);
  if (c) return ['Call', fmtBB(Number(c[1]))];
  const a = label.match(/^All-in ([\d.]+)$/);
  if (a) return ['All-in', fmtBB(Number(a[1]))];
  return [label, ''];
}

/** "Preflop: You raise to 2.5, BB call · Flop K♥9♠4♦: BB check…" */
export function historyHtml(s, hero, names = null, botName = null) {
  const lines = [];
  let street = -1;
  for (const e of s.log) {
    if (e.street !== street) {
      street = e.street;
      const cs = street === 0 ? [] : street === 1 ? s.runout.slice(0, 3) : [s.runout[street + 1]];
      lines.push({ head: STREET[street], cards: cs, acts: [] });
    }
    const who = names ? names[e.seat] : e.seat === hero ? 'You' : (botName || 'Bot');
    let a = e.type;
    if (e.type === 'call') a = `call ${e.amount}`;
    if (e.type === 'raise') a = `raise to ${e.to}`;
    if (e.type === 'bet') a = `bet ${e.to}`;
    if (e.type === 'allin') a = `all-in ${e.to}`;
    lines.at(-1).acts.push(`<span class="${e.seat === hero ? 'text-ink-100' : 'text-amber-200/90'}">${who} ${a}</span>`);
  }
  if (!lines.length) return '<div class="text-sm text-ink-400">Blinds 0.5/1 posted. SB folded (0.5 dead).</div>';
  return `<div class="space-y-1 text-sm">${lines.map(l => `<div class="flex gap-2 flex-wrap items-baseline">
    <span class="text-ink-400 w-14 shrink-0">${l.head}</span>${l.cards.length ? `<span class="mr-1">${handText(l.cards.map(cardStr))}</span>` : ''}
    <span class="text-ink-300">${l.acts.join(', ')}</span></div>`).join('')}</div>`;
}

// ------------------------------------------------------------------ coach

const CLASS_LABEL = { monster: 'Monsters', strong: 'Strong', medium: 'Medium', weak: 'Weak pairs', draw: 'Draws', air: 'Air' };
const CLASS_COL = { monster: '#f43f5e', strong: '#f59e0b', medium: '#eab308', weak: '#84cc16', draw: '#38bdf8', air: '#64748b' };

/** One-line reasons, built from the numbers behind each option. */
export function whyLines(d) {
  const out = [];
  const add = (i) => {
    const o = d.options[i];
    const f = o.info || {};
    const lab = `<b class="text-white">${esc(labelText(o.label))}</b>`;
    if (o.type === 'fold') out.push(`${lab}: give up the ${fmtBB(d.pot)} pot. EV 0.`);
    else if (o.type === 'call') out.push(`${lab}: you need <b>${pct(f.need ?? d.need)}</b> equity and have <b>${pct(f.eq ?? d.equity)}</b> against his range.`);
    else if (o.type === 'check') {
      if (f.botBets != null) out.push(`${lab}: he bets ${pct(f.botBets)} of the time, then you call or fold.`);
      else out.push(`${lab}: take your ${pct(d.equity)} equity to ${d.street === 3 ? 'showdown' : 'the next card'} for free.`);
    } else if (f.fold != null) {
      out.push(`${lab}: he folds <b>${pct(f.fold)}</b> (a pure bluff needs ${pct(f.breakEven)}); when he calls you have <b>${f.eqCalled != null ? pct(f.eqCalled) : '—'}</b>.`);
    }
  };
  add(d.best);
  if (d.chosen !== d.best) add(d.chosen);
  return out;
}

/** Composition of his range by hand class, as stacked bars. */
export function rangeBars(range) {
  const rows = Object.entries(range).filter(([, v]) => v >= 0.005).sort((a, b) => b[1] - a[1]);
  return `<div class="space-y-1.5">${rows.map(([c, v]) => `
    <div class="grid items-center gap-2 text-sm" style="grid-template-columns: 96px 1fr 44px">
      <span class="text-ink-300">${CLASS_LABEL[c]}</span>
      <div class="evbar"><i style="width:${Math.max(2, 100 * v)}%;background:${CLASS_COL[c]}"></i></div>
      <span class="text-right num text-ink-200">${pct(v)}</span></div>`).join('')}</div>`;
}

/** 13×13 heat map of a combo-weight array (1326). */
export function weightGrid(w, heroHole = null) {
  const byKey = new Map();
  let mx = 0;
  ALL_COMBOS.forEach((c, i) => {
    if (!(w[i] > 0)) return;
    const k = handType(c);
    const n = k.length === 2 ? 6 : k.endsWith('s') ? 4 : 12;
    byKey.set(k, (byKey.get(k) || 0) + w[i] / n);
  });
  for (const v of byKey.values()) mx = Math.max(mx, v);
  const me = heroHole ? handType(heroHole) : null;
  return rangeGrid(GRID.map(label => {
    const v = (byKey.get(label) || 0) / (mx || 1);
    return { label, me: label === me, bg: v > 0.01 ? `rgba(245, 158, 11, ${0.12 + 0.85 * v})` : 'rgb(var(--ink-800))', title: `${label}: ${pct(v)} of max weight` };
  }));
}

/** The coach card after a decision. `weights` = his range (for the grid), if available. */
export function coachCard(d, { weights = null, botName = 'He', live = false, evNote = null, fmt = null } = {}) {
  LABEL_FMT = fmt;
  const chosen = { ...d.options[d.chosen], label: labelText(d.options[d.chosen].label) };
  const best = { ...d.options[d.best], label: labelText(d.options[d.best].label) };
  let head;
  if (d.verdict === 'best') head = verdict('best', `Best move: ${esc(chosen.label)}`);
  else if (d.verdict === 'fine') head = verdict('fine', `Good: ${esc(chosen.label)}`, d.preflop ? `On the chart too. The coach's pick: ${esc(best.label)}.` : d.loss >= 0.05 ? `Best was ${esc(best.label)}, within ${fmtBB(d.loss)}.` : `Best was ${esc(best.label)}; the difference is tiny.`);
  else if (d.preflop) head = verdict(d.verdict, `Off the chart: ${esc(chosen.label)}`, `Chart: <b>${d.chart}</b>. Counted as ${fmtBB(d.loss)} of EV.`);
  else head = verdict(d.verdict, `${d.verdict === 'blunder' ? 'Blunder' : 'Mistake'}: ${esc(chosen.label)} costs ${fmtBB(d.loss)}`, `Best: <b>${esc(best.label)}</b>.`);
  if (d.preflop) {
    return `<div class="space-y-3">${head}
      ${disc('Why', `<div class="space-y-1.5">${(d.notes || []).map(n => `<p>${n}</p>`).join('')}</div>`)}</div>`;
  }
  const why = whyLines(d).map(l => `<p>${l}</p>`).join('');
  const his = d.buckets?.length ? bucketBarsHtml(d.buckets) : d.range ? rangeBars(d.range) : '';
  return `<div class="space-y-3">${head}
    ${d.heroBucket ? `<div class="text-sm text-ink-300">Your hand: <b class="text-amber-200">${esc(bucketName(d.heroBucket))}</b>${d.board?.length ? ` on ${handText(d.board.map(cardStr))}` : ''}</div>` : ''}
    ${evBars(d.options, { best: d.best, fine: d.fine, chosen: d.chosen })}
    <div class="text-xs text-ink-400">${evNote ?? `EV in bb vs ${esc(botName)}'s actual range and strategy. ${d.street === 3 ? 'Exact on the river.' : 'One street ahead, equity treated as realised.'}`}</div>
    ${live ? `<details class="disc" data-rangeview open><summary>Your range by bucket: a plan for each kind of hand</summary><div class="body"><div class="text-ink-400 text-sm">Working it out…</div></div></details>` : ''}
    ${disc('Why', `<div class="space-y-1.5">${why}</div>`)}
    ${his ? disc(`His range${d.buckets?.length ? ' by bucket' : ''} · you have ${pct(d.equity)} against it`, his + (weights ? `<div class="pt-2">${weightGrid(weights, d.hole)}</div>` : '')) : ''}
  </div>`;
}

// ------------------------------------------------------------------ session panel

export function sessionPanel(sess, sum) {
  const a = AGENTS[sess.botId];
  const read = readOfYou(sess.agent);
  const tone = (x) => (x > 0 ? 'text-emerald-300' : x < 0 ? 'text-rose-300' : '');
  return `<div class="panel panel-pad space-y-3">
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center">${icon('bot', 'w-6 h-6')}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2"><span class="font-semibold text-white">${a.name}</span><span class="pill">${eloOf(sess.botId)}</span></div>
        <div class="text-xs text-ink-300 mt-0.5">${a.blurb}</div>
      </div>
    </div>
    ${read ? `<div class="text-xs rounded-lg bg-ink-850 border border-ink-700 px-3 py-2 text-ink-200">He reads you as <b class="text-amber-200">${read.name}</b> (${pct(read.p)})${read.adapt < 0.999 ? ` and has shifted ${pct(read.adapt)} of his play to exploit it` : ''}.</div>` : ''}
    <div class="grid grid-cols-3 gap-2">
      ${stat('Hands', `${sum.hands}${sess.length ? `<span class="text-ink-400 text-base">/${sess.length}</span>` : ''}`)}
      ${stat('EV lost', sum.hands ? `−${sum.evLost.toFixed(1)}` : '0', 'by your decisions', sum.evLost > 0 ? 'text-rose-300' : '')}
      ${stat('Rating', sum.rating ?? '—', sum.rating ? 'this session' : 'after 5 hands')}
    </div>
    <div class="grid grid-cols-2 gap-2">
      ${stat('Result', `<span class="${tone(sum.net)}">${fmtBB(sum.net, { sign: true })}</span>`)}
      ${stat('All-in luck', `<span class="${tone(sum.luck)}">${fmtBB(sum.luck, { sign: true })}</span>`, 'result minus all-in EV')}
    </div>
  </div>`;
}

/** Recap of a finished hand: result, EV lost, luck, and each decision. */
export function handRecap(sess, h, { showDecisions = true } = {}) {
  const s = sess.s;
  const won = h.net > 0, lost = h.net < 0;
  let line;
  if (h.showdown) {
    line = `You: ${handName(s.holes[sess.hero], s.runout)} · ${AGENTS[sess.botId].name}: ${handName(s.holes[1 - sess.hero], s.runout)} ${handText(h.holes[1 - sess.hero])}`;
  } else line = s.folded === sess.hero ? 'You folded.' : 'He folded.';
  const decisions = showDecisions && h.decisions.length ? `<div class="space-y-2">${h.decisions.map((d, i) => decisionRow(d, i)).join('')}</div>` : '';
  const quality = h.evLost > 0.005
    ? `<span class="text-rose-300">Your decisions cost ${fmtBB(h.evLost)} of EV.</span>`
    : `<span class="text-emerald-300">No EV lost: every decision was best or fine.</span>`;
  const luck = Math.abs(h.luck) >= 0.05 ? ` All-in luck: <b class="${h.luck > 0 ? 'text-emerald-300' : 'text-rose-300'}">${fmtBB(h.luck, { sign: true })}</b> (you had ${pct(h.allinEq)} when the money went in).` : '';
  return `<div class="space-y-3 fade-up">
    <div class="verdict ${won ? 'v-best' : lost ? 'v-mistake' : 'v-fine'}">
      <div class="text-lg font-semibold ${won ? 'text-emerald-300' : lost ? 'text-rose-300' : 'text-sky-300'}">${won ? 'You won' : lost ? 'You lost' : 'Split'} ${fmtBB(Math.abs(h.net))}</div>
      <div class="text-sm text-ink-200 mt-1">${line}</div>
      <div class="text-sm mt-1">${quality}${luck}</div>
    </div>
    ${decisions}
  </div>`;
}

export function decisionRow(d, i, opts = {}) {
  LABEL_FMT = opts.fmt || null;
  const tone = { best: 'text-emerald-300', fine: 'text-sky-300', mistake: 'text-rose-300', blunder: 'text-red-300' }[d.verdict];
  const title = `${STREET[d.street]}${d.board.length ? ' ' + handText(d.board.map(cardStr)) : ''} · ${esc(labelText(d.options[d.chosen].label))}`;
  const right = d.verdict === 'best' ? 'Best' : d.verdict === 'fine' ? 'Good' : `${d.preflop ? 'off chart · ' : ''}−${d.loss.toFixed(2)}bb`;
  return disc(`<span class="flex-1 flex items-center gap-2 min-w-0"><span class="truncate">${title}</span><span class="ml-auto ${tone} text-xs font-semibold pr-2">${right}</span></span>`,
    coachCard(d, opts), false, '');
}

// ------------------------------------------------------------------ review

export function reviewHtml(sess, sum, pastSessions) {
  const all = sess.hands.flatMap(h => h.decisions.map(d => ({ ...d, hand: h.no })));
  const worst = all.filter(d => d.street > 0 && d.loss > 0.01).sort((a, b) => b.loss - a.loss).slice(0, 6);
  const pre = all.filter(d => d.street === 0 && d.loss > 0.01).sort((a, b) => b.loss - a.loss).slice(0, 6);
  const tone = (x) => (x > 0 ? 'text-emerald-300' : x < 0 ? 'text-rose-300' : '');
  const byStreet = [1, 2, 3].map(st => {
    const ds = all.filter(d => d.street === st);
    const g = ds.filter(d => d.verdict === 'best' || d.verdict === 'fine').length;
    const lost = ds.reduce((a, d) => a + d.loss, 0);
    return { st, n: ds.length, acc: ds.length ? g / ds.length : 0, lost };
  });
  const row = (d) => disc(`<span class="flex-1 flex items-center gap-2 min-w-0"><span class="text-ink-400 text-xs w-14">Hand ${d.hand}</span>
      <span class="truncate">${handText(byRank(d.hole).map(cardStr))} ${d.board.length ? 'on ' + handText(d.board.map(cardStr)) : ''}</span>
      <span class="ml-auto text-rose-300 text-xs font-semibold pr-2">${d.preflop ? 'off chart · ' : ''}−${d.loss.toFixed(2)}bb</span></span>`, coachCard(d));
  return `<div class="space-y-5 fade-up">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div><div class="h-sec">Session review</div><h1 class="h-title">vs ${AGENTS[sess.botId].name} <span class="text-ink-400 text-lg font-medium">${eloOf(sess.botId)}</span></h1></div>
      <div class="flex gap-2 flex-wrap"><a class="btn" href="#play/review/s/${sess.startedAt}">${icon('review', 'w-4 h-4')} Game review</a><button class="btn" id="rv-again">Play again</button><button class="btn btn-primary" id="rv-new">New session</button></div>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${stat('Played like', sum.rating ?? '—', sum.rating ? `EV lost ${sum.lossPer100.toFixed(1)}bb/100` : 'play 5+ hands', 'text-amber-200')}
      ${stat('Best or good', pct(sum.accuracy), `of your decisions · ${sum.blunders} blunders · ${sum.mistakes} mistakes`)}
      ${stat('Result', `<span class="${tone(sum.net)}">${fmtBB(sum.net, { sign: true })}</span>`, `${sum.hands} hands · ${sum.bbPer100.toFixed(0)}bb/100`)}
      ${stat('Luck', `<span class="${tone(sum.luck)}">${fmtBB(sum.luck, { sign: true })}</span>`, `all-in adjusted: ${fmtBB(sum.adjusted, { sign: true })}`)}
    </div>
    <div class="panel panel-pad">
      <div class="h-sec mb-3">By street</div>
      <div class="grid grid-cols-3 gap-3">${byStreet.map(b => `<div>
        <div class="text-sm text-ink-300">${STREET[b.st]}</div>
        <div class="text-xl font-semibold num">${b.n ? pct(b.acc) : '—'}</div>
        <div class="text-xs text-ink-400">${b.n} decisions · −${b.lost.toFixed(1)}bb</div></div>`).join('')}</div>
    </div>
    <div class="grid md:grid-cols-2 gap-4">
      <div class="space-y-2"><div class="h-sec">Biggest mistakes</div>${worst.length ? worst.map(row).join('') : '<p class="text-sm text-ink-400">None. Clean session.</p>'}</div>
      <div class="space-y-2"><div class="h-sec">Preflop, off the chart</div>${pre.length ? pre.map(row).join('') : '<p class="text-sm text-ink-400">All preflop decisions on the chart.</p>'}</div>
    </div>
    ${pastSessions.length ? `<div class="panel panel-pad"><div class="h-sec mb-2">Recent sessions</div>
      <div class="divide-y divide-ink-800">${pastSessions.map(p => `<div class="flex justify-between py-2 text-sm">
        <span class="text-ink-300">${new Date(p.at).toLocaleDateString()} · vs ${AGENTS[p.bot]?.name ?? p.bot}</span>
        <span class="num">${p.hands} hands · <span class="${tone(p.net)}">${fmtBB(p.net, { sign: true })}</span> · <b class="text-amber-200">${p.rating ?? '—'}</b></span></div>`).join('')}</div></div>` : ''}
  </div>`;
}

export { card, cards };

/** The bucket plan, with every hand's grid underneath. */
export function bucketViewHtml(bv, heroHole, note = '') {
  if (!bv) return '<div class="text-sm text-ink-400">Not available here.</div>';
  return `${bucketPlanHtml(bv, { note: note || (bv.read ? 'Your range as he reads you; each bucket\'s best play against him.' : 'Your range as a solid player has it on this line; each bucket\'s best play against him.') })}
    ${bv.v ? `<details class="disc mt-2"><summary>Every hand in your range</summary><div class="body">${rangeViewHtml(bv.v, heroHole)}</div></details>` : ''}`;
}

const ACT_COL = { fold: '#475569', check: '#0ea5e9', call: '#38bdf8', bet: '#10b981', raise: '#f59e0b', allin: '#f43f5e' };
/** Grid of the best action for every hand in your range (from coach.rangeView). */
export function rangeViewHtml(v, heroHole) {
  if (!v) return '<div class="text-sm text-ink-400">Not available here.</div>';
  const byKey = new Map();
  const share = new Float64Array(v.options.length);
  let tot = 0;
  ALL_COMBOS.forEach((c, i) => {
    if (v.best[i] < 0) return;
    const k = handType(c);
    if (!byKey.has(k)) byKey.set(k, { w: 0, per: new Float64Array(v.options.length) });
    const e = byKey.get(k);
    e.w += v.weights[i];
    e.per[v.best[i]] += v.weights[i];
    share[v.best[i]] += v.weights[i];
    tot += v.weights[i];
  });
  let mx = 0;
  for (const e of byKey.values()) mx = Math.max(mx, e.w / (e.per.length ? 1 : 1));
  const col = (o, k) => {
    if (o.type === 'bet') {
      const bets = v.options.filter(x => x.type === 'bet');
      return bets.indexOf(o) === 0 ? '#34d399' : '#059669';
    }
    return ACT_COL[o.type] || '#64748b';
  };
  const me = handType(heroHole);
  const cells = GRID.map(label => {
    const e = byKey.get(label);
    if (!e || e.w <= 0) return { label, bg: 'rgb(var(--ink-800))', me: label === me, title: `${label}: not in your range` };
    let b = 0;
    for (let k = 1; k < e.per.length; k++) if (e.per[k] > e.per[b]) b = k;
    const a = 0.25 + 0.75 * Math.min(1, e.w / mx);
    const hex = col(v.options[b], b);
    const rgb = [1, 3, 5].map(j => parseInt(hex.slice(j, j + 2), 16)).join(',');
    return { label, me: label === me, bg: `rgba(${rgb},${a.toFixed(2)})`, title: `${label}: ${v.options[b].label}` };
  });
  const legend = v.options.map((o, k) => share[k] > 0.005 * tot ? `<span class="inline-flex items-center gap-1.5 mr-3"><i class="inline-block w-3 h-3 rounded-sm" style="background:${col(o, k)}"></i>${esc(labelText(o.label))} <b class="text-white num">${pct(share[k] / tot)}</b></span>` : '').join('');
  return `<div class="space-y-2">
    <p class="text-ink-300">Every hand you could have here, as ${v.read ? 'he reads you' : 'a solid player would have it on this line'}, and its best play against him. Brighter = more of your range.</p>
    ${v.inRange ? '' : '<p class="text-amber-200">Your actual hand is not one you would normally have on this line.</p>'}
    <div class="text-xs text-ink-200 leading-6">${legend}</div>
    ${rangeGrid(cells)}
  </div>`;
}

/** Heads-up · Live table · Watch · Review */
export function playTabs(active) {
  return `<div class="seg">${[['', 'Heads-up'], ['table', 'Live table'], ['watch', 'Watch'], ['review', 'Review']].map(([v, l]) =>
    `<a href="#play${v ? '/' + v : ''}" class="px-3 py-1.5 rounded-lg text-sm font-medium ${v === active ? 'bg-ink-700 text-white shadow-card' : 'text-ink-300 hover:text-ink-100'}">${l}</a>`).join('')}</div>`;
}
