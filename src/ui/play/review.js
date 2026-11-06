/**
 * Review: chess-style game review of the hands you played, and the leak report across sessions.
 *   #review                    your sessions, newest first: pick one to review it
 *   #review/insights           your numbers across every hand: trend, by street, by spot, leaks
 *   #review/s/<sid>            one session: accuracy, grades, key moments, every hand
 *   #review/h/<id>[/<step>]    the hand replayer: step through it move by move; before each of
 *                                   your decisions you can guess first, and the grade shows after
 */
import {
  loadHands, sessionsOf, statesOf, viewOf, posName, decisionAt, grade, GRADES, accuracyOf, gradeCounts,
  moveAccuracy, leakReport, getHand, clearHands,
} from '../../engine/history.js';
import { AGENTS, eloOf } from '../../engine/hu/agents.js';
import { LEVELS } from '../../engine/ring/players.js';
import { cardStr } from '../../engine/hu/hand.js';
import { ringTable, fmtBB, icon, esc, stat, handText, seg, wireSeg, disc, sprOf, optionLabel } from '../kit.js';
import { coachCard, actionBar, reviewTabs, evNoteFor, handName } from './views.js';
import { settings, saveSettings, loadRaw, KEYS } from '../../store.js';
import { pct } from '../../engine/potmath.js';
import { navigate } from '../../router.js';
import { ratingFromLoss } from '../../engine/hu/session.js';

const STREET = ['Preflop', 'Flop', 'Turn', 'River'];
const byRank = (h) => [...h].sort((a, b) => (b >> 2) - (a >> 2));
const tone = (x) => (x > 0 ? 'text-emerald-300' : x < 0 ? 'text-rose-300' : '');
const accTone = (a) => (a == null ? '' : a >= 90 ? 'text-emerald-300' : a >= 75 ? 'text-sky-300' : a >= 60 ? 'text-yellow-300' : 'text-rose-300');

let rv = null; // replayer state
let keyHandler = null;

export function render(container, params = []) {
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  if (params[0] === 'log') return import('./logger.js').then(m => m.render(container, params.slice(1)));
  if (params[0] === 'sessions') return import('./sessions.js').then(m => m.render(container, params.slice(1)));
  if (params[0] === 'insights') home(container, 'insights');
  else if (params[0] === 's') sessionView(container, Number(params[1]));
  else if (params[0] === 'h') replayer(container, params[1], params[2]);
  else home(container);
  return () => { if (keyHandler) window.removeEventListener('keydown', keyHandler); keyHandler = null; };
}

export function sessionTitle(x) {
  if (x.level === 'live') return 'Your live hands';
  if (x.kind === 'hu') return `vs ${AGENTS[x.opp]?.name ?? x.opp} <span class="text-ink-400 font-medium">${eloOf(x.opp) ?? ''}</span>`;
  return `Live table · ${LEVELS[x.level]?.name ?? ''} · ${x.n}-handed`;
}

const glyph = (d, size = 'text-xs') => {
  const g = GRADES[grade(d)];
  return `<span class="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1 rounded-md border ${g.bg} ${g.tone} ${size} font-bold" title="${g.label}">${g.glyph}</span>`;
};

// ------------------------------------------------------------------ insights

/**
 * Where your accuracy comes from: the trend over your sessions, accuracy by street and by kind of
 * decision, how your moves grade, and the single biggest mistakes to replay.
 */
function insights(hands, sessions) {
  const ds = hands.flatMap(h => h.decisions.map(d => ({ h, d })));
  if (ds.length < 5) return '';
  const accOf = (list) => (list.length ? Math.round(list.reduce((a, x) => a + moveAccuracy(x.d), 0) / list.length) : null);
  const bar = (label, list, sub) => {
    const a = accOf(list);
    return `<div class="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
      <div class="text-ink-200 min-w-0">${label}<div class="text-[11px] text-ink-400 leading-tight">${list.length} decision${list.length === 1 ? '' : 's'}${sub ? ` · ${sub}` : ''}</div></div>
      <span class="evbar"><i style="width:${a == null ? 0 : Math.max(3, a)}%" class="${a == null ? '' : a >= 90 ? 'bg-emerald-400' : a >= 75 ? 'bg-sky-400' : a >= 60 ? 'bg-yellow-400' : 'bg-rose-400'}"></i></span>
      <div class="text-right num font-semibold ${accTone(a)}">${a ?? '—'}</div></div>`;
  };
  const lost = (list) => list.reduce((a, x) => a + (x.d.loss || 0), 0);
  const byStreet = STREET.map((n, i) => ({ n, list: ds.filter(x => x.d.street === i) })).filter(x => x.list.length);
  const post = ds.filter(x => x.d.street > 0);
  const facing = post.filter(x => x.d.toCall > 0.001), open = post.filter(x => !(x.d.toCall > 0.001));
  const worst = (by) => { const m = [...by].sort((a, b) => lost(b.list) - lost(a.list))[0]; return m && lost(m.list) > 0.05 ? m : null; };
  const ws = worst(byStreet);

  // trend: accuracy of each session, oldest first (the last 12)
  const trend = [...sessions].reverse().slice(-12).map(x => ({ x, a: accuracyOf(x.hands) })).filter(t => t.a != null);
  const trendHtml = trend.length >= 2 ? `<div class="flex items-end gap-1.5 h-24">${trend.map(t => `<a href="#review/s/${t.x.sid}" class="flex-1 min-w-0 flex flex-col items-center justify-end h-full gap-1 group" title="${new Date(t.x.sid).toLocaleDateString([], { month: 'short', day: 'numeric' })}: ${t.a} accuracy, ${t.x.hands.length} hands">
      <span class="text-[10px] num text-ink-400 group-hover:text-white">${t.a}</span>
      <span class="w-full rounded-t ${t.a >= 90 ? 'bg-emerald-400' : t.a >= 75 ? 'bg-sky-400' : t.a >= 60 ? 'bg-yellow-400' : 'bg-rose-400'} opacity-80 group-hover:opacity-100" style="height:${Math.max(6, t.a)}%"></span></a>`).join('')}</div>
    <div class="flex justify-between text-[11px] text-ink-400 mt-1"><span>older</span><span>latest session</span></div>`
    : '<p class="text-sm text-ink-400">Play a second session and your accuracy trend shows here.</p>';

  const c = gradeCounts(hands);
  const tot = Object.values(c).reduce((a, b) => a + b, 0) || 1;
  const COL = { best: '#34d399', good: '#38bdf8', inaccuracy: '#facc15', mistake: '#fb923c', blunder: '#f43f5e' };
  const grades = `<div class="flex h-3 rounded-full overflow-hidden bg-ink-800">${Object.keys(GRADES).map(k => c[k] ? `<span style="width:${(100 * c[k]) / tot}%;background:${COL[k]}" title="${GRADES[k].label}: ${c[k]}"></span>` : '').join('')}</div>
    <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-2">${Object.entries(GRADES).map(([k, g]) => `<span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full" style="background:${COL[k]}"></span><span class="text-ink-300">${g.label}</span><b class="num text-white">${c[k]}</b></span>`).join('')}</div>`;

  const big = ds.filter(x => x.d.loss > 0.05 && x.d.verdict !== 'best' && x.d.verdict !== 'fine').sort((a, b) => b.d.loss - a.d.loss).slice(0, 5);
  const bigHtml = big.length ? big.map(({ h, d }) => `<a href="#review/h/${h.id}/${d.at + 1}" class="flex items-center gap-2 text-sm rounded-lg bg-ink-850 border border-ink-700 px-3 py-2 hover:border-ink-500">
      ${glyph(d)}<span>${handText(byRank(d.hole).map(cardStr))}</span><span class="text-ink-400 whitespace-nowrap">${d.board.length ? 'on ' + handText(d.board.map(cardStr)) : STREET[d.street]}</span>
      <span class="truncate text-ink-300">· ${esc(optionLabel(d.options[d.chosen].label))} <span class="text-ink-500">(best: ${esc(optionLabel(d.options[d.best].label))})</span></span>
      <span class="ml-auto text-rose-300 text-xs font-semibold num">−${d.loss.toFixed(1)}</span></a>`).join('')
    : '<p class="text-sm text-ink-400">No real mistakes yet.</p>';

  const summary = ws ? `You lose the most EV on the <b class="text-white">${ws.n.toLowerCase()}</b> (${fmtBB(lost(ws.list))} over ${ws.list.length} decisions).`
    : 'No street stands out yet.';
  return `<section class="space-y-3">
    <div class="flex items-baseline justify-between gap-3 flex-wrap"><div class="h-sec">Where your accuracy comes from</div><span class="text-xs text-ink-400">100 = the coach's play every time</span></div>
    <div class="grid lg:grid-cols-3 gap-4 items-start">
      <div class="panel panel-pad space-y-2"><div class="text-sm font-semibold text-white">Accuracy by session</div>${trendHtml}</div>
      <div class="panel panel-pad space-y-3"><div class="text-sm font-semibold text-white">By street</div>
        ${byStreet.map(x => bar(x.n, x.list, lost(x.list) > 0.05 ? `−${lost(x.list).toFixed(1)}bb` : '')).join('')}
        <p class="text-xs text-ink-400">${summary}</p></div>
      <div class="panel panel-pad space-y-3"><div class="text-sm font-semibold text-white">By decision (after the flop)</div>
        ${post.length ? `${bar('Facing a bet', facing, lost(facing) > 0.05 ? `−${lost(facing).toFixed(1)}bb` : '')}${bar('Bet or check', open, lost(open) > 0.05 ? `−${lost(open).toFixed(1)}bb` : '')}` : '<p class="text-sm text-ink-400">No postflop decisions yet.</p>'}
        <div class="pt-1">${grades}</div></div>
    </div>
    <div class="panel panel-pad space-y-2"><div class="flex items-baseline justify-between"><div class="text-sm font-semibold text-white">Your biggest mistakes</div><span class="text-xs text-ink-400">tap one to replay it</span></div>${bigHtml}</div>
  </section>`;
}

// ------------------------------------------------------------------ review home

function home(container, page = '') {
  const hands = loadHands();
  const sessions = sessionsOf(hands);
  const rep = leakReport(hands);
  const acc = accuracyOf(hands);
  const maxLost = Math.max(0.01, ...rep.leaks.map(l => l.lost));
  const empty = `<div class="panel panel-pad text-center py-12 space-y-3">
    <div class="mx-auto w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-300 flex items-center justify-center">${icon('review', 'w-6 h-6')}</div>
    <div class="text-lg font-semibold text-white">No hands yet</div>
    <p class="text-sm text-ink-300 max-w-md mx-auto">Every hand you play heads-up or at the live table lands here. Replay it move by move, guess your move before the coach shows the grade, and see which leaks cost you the most.</p>
    <div class="flex gap-2 justify-center flex-wrap"><a class="btn btn-primary" href="#play">Play heads-up</a><a class="btn" href="#play/table">Live table</a><a class="btn" href="#review/log">${icon('pen', 'w-4 h-4')} Log a hand from the casino</a></div></div>`;

  const leaks = rep.leaks.length ? rep.leaks.slice(0, 8).map(l => disc(`<span class="flex-1 min-w-0">
      <span class="flex items-center gap-2"><span class="font-semibold text-white truncate">${esc(l.name)}</span>
        <span class="ml-auto text-rose-300 text-xs font-semibold num whitespace-nowrap pr-2">−${l.per100.toFixed(1)}bb/100</span></span>
      <span class="evbar mt-1.5 block"><i style="width:${Math.max(3, (100 * l.lost) / maxLost)}%;background:#f43f5e"></i></span></span>`,
    `<p class="text-ink-200">${esc(l.fix)}</p>
     <p class="text-xs text-ink-400">${l.count} time${l.count === 1 ? '' : 's'} · ${fmtBB(l.lost)} of EV in total.</p>
     <a class="btn btn-primary btn-sm" href="${l.key.startsWith('pre-') ? '#train/preflop' : `#puzzles/drill/${l.key}`}">${icon('target', 'w-4 h-4')} ${l.key.startsWith('pre-') ? 'Practise preflop' : 'Drill this leak'}</a>
     <div class="space-y-1.5 pt-1">${l.examples.map(e => `<a href="#review/h/${e.id}/${e.at + 1}" class="flex items-center gap-2 text-sm rounded-lg bg-ink-850 border border-ink-700 px-3 py-2 hover:border-ink-500">
       <span>${handText(byRank(e.hole).map(cardStr))}</span><span class="text-ink-400">${e.board.length ? 'on ' + handText(e.board.map(cardStr)) : STREET[e.street]}</span>
       <span class="truncate text-ink-300">· ${esc(e.label)} <span class="text-ink-500">(best: ${esc(e.best)})</span></span>
       <span class="ml-auto text-rose-300 text-xs font-semibold num">−${e.loss.toFixed(1)}</span></a>`).join('')}</div>`)).join('')
    : '<p class="text-sm text-ink-400">No leaks found yet. Play more hands.</p>';

  const header = (title, sub, tab) => `<div class="flex items-end justify-between gap-4 flex-wrap">
      <div><div class="h-sec">Review</div><h1 class="h-title">${title}</h1>
        <p class="muted mt-1 text-sm max-w-2xl">${sub}</p></div>
      <div class="flex items-center gap-2 flex-wrap max-w-full">${reviewTabs(tab)}</div>
    </div>`;

  if (page === 'insights') {
    container.innerHTML = `<div class="page space-y-6 fade-up">
    ${header('Insights', 'Across every hand you have stored: where your accuracy comes from and which leaks cost the most.', 'insights')}
    ${!hands.length ? empty : `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${stat('Accuracy', `<span class="${accTone(acc)}">${acc ?? '—'}</span>`, `last ${hands.length} hands`)}
      ${stat('EV lost', `−${rep.per100.toFixed(1)}`, 'bb per 100 hands', 'text-rose-200')}
      ${stat('Decisions', rep.spots, `${sessions.length} session${sessions.length === 1 ? '' : 's'}`)}
      ${stat('Result', `<span class="${tone(hands.reduce((a, h) => a + (h.net ?? 0), 0))}">${fmtBB(hands.reduce((a, h) => a + (h.net ?? 0), 0), { sign: true })}</span>`, 'all stored hands')}
    </div>
    ${insights(hands, sessions)}
    <div class="space-y-2">
      <div class="flex items-baseline justify-between"><div class="h-sec">Your leaks</div><span class="text-xs text-ink-400">cost per 100 hands</span></div>
      ${leaks}
    </div>
    <button id="clear" class="btn btn-quiet text-xs !px-0 text-ink-400">Clear hand history</button>`}
  </div>`;
  } else {
    // sessions, newest first, grouped by day
    const day = (t) => new Date(t).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    const groups = [];
    for (const x of sessions) { const d = day(x.sid); if (groups.at(-1)?.d !== d) groups.push({ d, xs: [] }); groups.at(-1).xs.push(x); }
    const card = (x) => {
      const a = accuracyOf(x.hands);
      const net = x.hands.reduce((q, h) => q + (h.net ?? 0), 0);
      const c = gradeCounts(x.hands);
      const tot = Object.values(c).reduce((q, v) => q + v, 0) || 1;
      const pl = playedLike(x);
      const COL = { best: '#34d399', good: '#38bdf8', inaccuracy: '#facc15', mistake: '#fb923c', blunder: '#f43f5e' };
      return `<a href="#review/s/${x.sid}" class="card-link panel panel-pad flex flex-col gap-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0"><div class="font-semibold text-white truncate">${sessionTitle(x)}</div>
            <div class="text-xs text-ink-400 mt-0.5">${x.level === 'live' || x.hands[0]?.live ? 'Logged from the casino' : new Date(x.sid).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${x.hands.length} hand${x.hands.length === 1 ? '' : 's'} · <span class="${tone(net)}">${fmtBB(net, { sign: true })}</span></div></div>
          <span class="btn btn-sm shrink-0">Review</span>
        </div>
        <div class="flex items-end gap-6">
          <div><div class="text-[10px] uppercase tracking-wider text-ink-400">Accuracy</div><div class="text-2xl font-semibold num ${accTone(a)}">${a ?? '—'}</div></div>
          ${pl ? `<div><div class="text-[10px] uppercase tracking-wider text-ink-400">Played like</div><div class="text-2xl font-semibold num text-amber-300">${pl.rating}</div></div>` : ''}
          <div class="flex-1 min-w-0 pb-1.5">
            <div class="flex h-2 rounded-full overflow-hidden bg-ink-800">${Object.keys(GRADES).map(k => c[k] ? `<span style="width:${(100 * c[k]) / tot}%;background:${COL[k]}" title="${GRADES[k].label}: ${c[k]}"></span>` : '').join('')}</div>
            <div class="text-[11px] text-ink-400 mt-1">${c.best + c.good} good${c.inaccuracy ? ` · ${c.inaccuracy} inaccurac${c.inaccuracy === 1 ? 'y' : 'ies'}` : ''}${c.mistake ? ` · ${c.mistake} mistake${c.mistake === 1 ? '' : 's'}` : ''}${c.blunder ? ` · <span class="text-rose-300">${c.blunder} blunder${c.blunder === 1 ? '' : 's'}</span>` : ''}</div>
          </div>
        </div></a>`;
    };
    container.innerHTML = `<div class="page space-y-6 fade-up">
    ${header('Your sessions', 'Pick a session and go through it decision by decision, like a chess game review: what you did, how it graded, and what the coach would play.', '')}
    ${!hands.length ? empty : groups.map(g => `<section class="space-y-2">
      <div class="h-sec">${g.d}</div>
      <div class="grid md:grid-cols-2 gap-3">${g.xs.map(card).join('')}</div>
    </section>`).join('')}
  </div>`;
  }
  const clr = container.querySelector('#clear');
  clr?.addEventListener('click', () => {
    if (clr.dataset.armed) { clearHands(); home(container, page); return; }
    clr.dataset.armed = '1';
    clr.textContent = 'Tap again to delete every stored hand';
    clr.classList.add('!text-rose-300');
  });
}

// ------------------------------------------------------------------ one session

/**
 * "Played like": the rating a session was played at, like chess.com's game rating. Heads-up
 * with 20+ hands: the Play rating for that session (your result against the bot on the same
 * cards, blended with your decisions). Otherwise: from the EV your decisions gave up per 100
 * hands, on the bot ladder. Not for logged live hands (you pick which ones to log).
 */
function playedLike(x) {
  if (x.level === 'live' || x.hands[0]?.live) return null;
  const row = x.kind === 'hu' ? (loadRaw(KEYS.play, { sessions: [] }).sessions || []).find(r => r.at === x.sid) : null;
  if (row?.rating) return { rating: row.rating, how: `Your result against ${esc(AGENTS[x.opp]?.name ?? 'the bot')} on the same cards, with your decisions, over ${row.hands} hands.` };
  const decisions = x.hands.reduce((a, h) => a + h.decisions.length, 0);
  if (decisions < 5) return null;
  const lost = x.hands.reduce((a, h) => a + h.evLost, 0);
  return { rating: ratingFromLoss((100 * lost) / x.hands.length), how: `From the EV your decisions gave up (${((100 * lost) / x.hands.length).toFixed(1)}bb per 100 hands), on the bot ladder.${x.hands.length < 50 ? ' A rough read over this few hands.' : ''}` };
}

function sessionView(container, sid) {
  const x = sessionsOf().find(q => q.sid === sid);
  if (!x) { container.innerHTML = `<div class="page text-ink-300">That session is no longer stored. <a class="underline" href="#review">Back to Review</a></div>`; return; }
  const acc = accuracyOf(x.hands);
  const c = gradeCounts(x.hands);
  const net = x.hands.reduce((a, h) => a + (h.net ?? 0), 0);
  const lost = x.hands.reduce((a, h) => a + h.evLost, 0);
  const luck = x.hands.reduce((a, h) => a + (h.luck || 0), 0);
  const key = x.hands.flatMap(h => h.decisions.filter(d => ['inaccuracy', 'mistake', 'blunder'].includes(grade(d))).map(d => ({ h, d })))
    .sort((a, b) => b.d.loss - a.d.loss).slice(0, 10);
  const firstKey = [...key].sort((a, b) => a.h.no - b.h.no || a.d.at - b.d.at)[0];
  const played = playedLike(x);
  container.innerHTML = `<div class="page space-y-5 fade-up">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div><a href="#review" class="text-sm text-ink-400 hover:text-white inline-flex items-center gap-1">${icon('back', 'w-4 h-4')} Review</a>
        <h1 class="h-title mt-1">${sessionTitle(x)}</h1>
        <div class="text-sm text-ink-400">${new Date(x.sid).toLocaleString()} · ${x.hands.length} hands</div></div>
      <div class="flex gap-2 flex-wrap">
        <a class="btn btn-primary btn-lg" href="#review/h/${x.hands[0].id}">${icon('play', 'w-5 h-5')} Start review</a>
        ${firstKey ? `<a class="btn btn-lg" id="quiz-mistakes" href="#review/h/${firstKey.h.id}/${firstKey.d.at}">${icon('target', 'w-4 h-4')} Retry your mistakes</a>` : ''}</div>
    </div>
    <div class="panel panel-pad grid md:grid-cols-[auto_minmax(0,1fr)] gap-6 items-center">
      <div class="flex gap-8">
        <div><div class="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">Accuracy</div>
          <div class="text-5xl font-semibold num ${accTone(acc)}">${acc ?? '—'}</div>
          <div class="text-xs text-ink-400 mt-1">100 = the coach's play every time</div></div>
        ${played ? `<div><div class="text-[11px] uppercase tracking-wider text-ink-400 font-semibold">Played like</div>
          <div class="text-5xl font-semibold num text-amber-300">${played.rating}</div>
          <div class="text-xs text-ink-400 mt-1 max-w-[16rem]">${played.how}</div></div>` : ''}
      </div>
      <div class="grid grid-cols-5 gap-2 text-center">
        ${Object.entries(GRADES).map(([k, g]) => `<div><div class="mx-auto w-10 h-10 rounded-xl border ${g.bg} ${g.tone} flex items-center justify-center font-bold">${g.glyph}</div>
          <div class="text-xl font-semibold num text-white mt-1">${c[k]}</div><div class="text-[11px] text-ink-400">${g.label}</div></div>`).join('')}
      </div>
    </div>
    <div class="grid grid-cols-3 gap-3">
      ${stat('EV lost', `−${lost.toFixed(1)}bb`, `${x.hands.length ? ((100 * lost) / x.hands.length).toFixed(1) : 0}bb/100`, 'text-rose-200')}
      ${stat('Result', `<span class="${tone(net)}">${fmtBB(Math.abs(net) >= 100 ? Math.round(net) : net, { sign: true })}</span>`, x.kind === 'hu' ? `luck ${fmtBB(luck, { sign: true })}` : '')}
      ${stat('Decisions', x.hands.reduce((a, h) => a + h.decisions.length, 0), '')}
    </div>
    <div class="grid lg:grid-cols-2 gap-5 items-start">
      <div class="space-y-2"><div class="h-sec">Key moments</div>
        ${key.length ? key.map(({ h, d }) => `<a href="#review/h/${h.id}/${d.at + 1}" class="panel flex items-center gap-3 px-4 py-3 hover:border-ink-500">
          ${glyph(d)}<span class="text-xs text-ink-400 w-14">Hand ${h.no}</span>
          <span class="text-sm">${handText(byRank(d.hole).map(cardStr))}</span>
          <span class="text-sm text-ink-400 truncate">${d.board.length ? handText(d.board.map(cardStr)) : 'preflop'}</span>
          <span class="ml-auto text-xs text-rose-300 num">−${d.loss.toFixed(1)}bb</span>${icon('next', 'w-4 h-4 text-ink-400')}</a>`).join('')
          : '<p class="text-sm text-ink-400">No mistakes this session. Clean.</p>'}
      </div>
      <div class="space-y-2"><div class="h-sec">Every hand</div>
        <div class="panel divide-y divide-ink-800">${x.hands.map(h => `<a href="#review/h/${h.id}" class="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-850/60">
          <span class="text-xs text-ink-400 w-12">#${h.no}</span><span class="text-xs text-ink-300 w-9">${posName(h, h.hero)}</span>
          <span class="text-sm">${handText(byRank(h.holes[h.hero]).map(cardStr))}</span>
          <span class="flex gap-1">${h.decisions.map(d => glyph(d, 'text-[10px]')).join('')}</span>
          <span class="ml-auto text-sm num ${tone(h.net ?? 0)}">${h.net == null ? '—' : fmtBB(h.net, { sign: true })}</span></a>`).join('')}</div>
      </div>
    </div>
  </div>`;
  container.querySelector('#quiz-mistakes')?.addEventListener('click', () => saveSettings({ ...settings(), reviewGuess: 'mistakes' }));
}

// ------------------------------------------------------------------ replayer

function replayer(container, id, stepParam) {
  const hand = getHand(id);
  if (!hand) { container.innerHTML = `<div class="page text-ink-300">That hand is no longer stored. <a class="underline" href="#review">Back to Review</a></div>`; return; }
  if (!rv || rv.hand.id !== id) {
    const states = statesOf(hand);
    const session = sessionsOf().find(q => q.sid === hand.sid);
    rv = { hand, states, step: 0, guess: {}, showCards: false, session };
  }
  const L = hand.log.length;
  // no step: your first decision (or the end of a hand you had none in); 'end': the result
  rv.step = stepParam === 'end' ? L : stepParam != null ? Math.max(0, Math.min(L, Number(stepParam) || 0)) : stopsOf(hand)[0];
  rv.ask = stepParam != null && stepParam !== 'end'; // a link to a move to guess ("Retry your mistakes") opens on the quiz
  keyHandler = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName)) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); container.querySelector('#rv-next')?.click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); container.querySelector('#rv-prev')?.click(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); container.querySelector('#rv-next-hand')?.click(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); container.querySelector('#rv-prev-hand')?.click(); }
    else {
      const n = Number(e.key);
      if (n >= 1 && n <= 9) container.querySelector(`#guess [data-i="${n - 1}"]`)?.click();
    }
  };
  window.addEventListener('keydown', keyHandler);
  draw(container);
}

function go(container, k) {
  rv.step = Math.max(0, Math.min(rv.states.length - 1, k));
  rv.ask = false;
  history.replaceState(null, '', `#review/h/${rv.hand.id}/${rv.step}`);
  draw(container);
}

/**
 * Where Next and Back stop in a hand: each of your decisions (the spot you faced, with the
 * coach's verdict on what you did) and the result. With "Quiz me" on, a decision you still have
 * to answer stops one step earlier, before your move is shown.
 */
function stopsOf(h) {
  const out = new Set();
  for (const d of h.decisions) {
    if (rv?.hand.id === h.id && needsGuess(d) && rv.guess[d.at] == null) out.add(d.at);
    out.add(d.at + 1);
  }
  out.add(h.log.length);
  return [...out].sort((a, b) => a - b);
}

const RANK = { blunder: 4, mistake: 3, inaccuracy: 2, good: 1, best: 0 };
/** A hand's worst decision, for the hand strip. */
const worstOf = (h) => h.decisions.reduce((w, d) => (!w || RANK[grade(d)] > RANK[grade(w)] ? d : w), null);

const guessMode = () => settings().reviewGuess ?? 'off';
function needsGuess(d) {
  const m = guessMode();
  if (m === 'off') return false;
  if (m === 'all') return true;
  return !['best', 'good'].includes(grade(d));
}

function actLabel(e, you = false) {
  const v = (a, b) => (you ? a : b);
  if (e.type === 'fold') return v('fold', 'folds');
  if (e.type === 'check') return v('check', 'checks');
  if (e.type === 'call') return `${v('call', 'calls')} ${fmtBB(e.amount)}`;
  if (e.type === 'bet') return `${v('bet', 'bets')} ${fmtBB(e.amount ?? e.to)}`;
  if (e.type === 'raise') return `${v('raise', 'raises')} to ${fmtBB(e.to)}`;
  if (e.type === 'allin') return e.callAllIn ? `${v('call', 'calls')} all-in` : `${v('go', 'goes')} all-in ${fmtBB(e.to)}`;
  return e.type;
}
const tagLabel = (e) => (e.type === 'fold' ? 'Fold' : e.type === 'check' ? 'Check' : e.type === 'call' ? `Call ${e.amount}` : e.type === 'bet' ? `Bet ${e.amount ?? e.to}` : e.type === 'raise' ? `Raise ${e.to}` : e.callAllIn ? 'Call all-in' : `All-in ${e.to}`);

/** The table at state k; `through` shows action tags up to that log index (your move, on a decision). */
function tableAt(h, k, through = k) {
  const s = rv.states[k];
  const v = viewOf(h, s);
  const log = h.log.slice(0, through);
  const curStreet = s.done ? log.at(-1)?.street ?? 0 : s.street;
  const tags = {};
  for (const e of log) if (e.street === curStreet) tags[e.seat] = { lab: tagLabel(e), tone: e.type === 'fold' ? 't-fold' : ['bet', 'raise', 'allin'].includes(e.type) ? 't-aggr' : '' };
  const showdown = s.done && s.result?.showdown;
  const hidden = new Set(h.hidden || []);
  const unknownResult = showdown && h.net == null;
  const order = Array.from({ length: v.n }, (_, j) => (h.hero + j) % v.n);
  const seats = order.map(i => {
    const hero = i === h.hero;
    const winner = s.done && !unknownResult && s.result.net[i] > 0;
    const style = h.styles?.[i];
    return {
      name: h.names[i],
      sub: `${posName(h, i)}${style ? ` · ${esc(style)}` : ''}`,
      stack: fmtBB(v.stacks[i]),
      cards: hero ? byRank(h.holes[i]) : v.folded[i] ? null : hidden.has(i) ? 'back' : (showdown || rv.showCards) ? byRank(h.holes[i]) : 'back',
      folded: v.folded[i],
      dealer: i === v.btn,
      bet: s.done ? 0 : v.streetBet[i],
      acting: !s.done && v.toAct === i,
      hero,
      tag: winner ? `Wins ${fmtBB(s.result.won ? s.result.won[i] : s.result.net[i] + s.invested[i])}` : tags[i]?.lab,
      tagTone: winner ? 't-win' : tags[i]?.tone,
    };
  });
  const spr = s.done ? null : sprOf({ street: v.street, stacks: v.stacks, streetBet: v.streetBet, pot: v.pot + v.streetBet.reduce((a, b) => a + b, 0), live: order.filter(i => !v.folded[i]), seat: h.hero });
  return ringTable({ seats, board: v.board, pot: v.pot, spr });
}

/** The move list, grouped by street; runs of preflop folds collapse into one chip. */
function moveList(h, k) {
  const out = [];
  let street = -1;
  for (let j = 0; j < h.log.length; j++) {
    const e = h.log[j];
    if (e.street !== street) {
      street = e.street;
      const cs = street === 0 ? [] : street === 1 ? h.runout.slice(0, 3) : [h.runout[street + 1]];
      out.push({ head: STREET[street], cards: cs, chips: [] });
    }
    const chips = out.at(-1).chips;
    const hero = e.seat === h.hero;
    const prev = chips.at(-1);
    if (!hero && e.type === 'fold' && e.street === 0 && prev?.folds) { prev.folds++; prev.step = j + 1; prev.names.push(h.names[e.seat]); continue; }
    if (!hero && e.type === 'fold' && e.street === 0) { chips.push({ folds: 1, step: j + 1, names: [h.names[e.seat]] }); continue; }
    chips.push({ step: j + 1, e, hero, d: hero ? decisionAt(h, j) : null });
  }
  const chip = (c) => {
    const on = c.step === k;
    if (c.folds) return `<button data-step="${c.step}" class="mv ${on ? 'on' : ''} text-ink-400">${c.folds === 1 ? esc(c.names[0]) + ' folds' : `${c.folds} fold`}</button>`;
    const who = c.hero ? 'You' : esc(h.names[c.e.seat]);
    const hidden = c.d && needsGuess(c.d) && rv.guess[c.d.at] == null && k <= c.d.at;
    return `<button data-step="${c.step}" class="mv ${on ? 'on' : ''} ${c.hero ? 'text-white' : 'text-amber-200/90'}">${hidden ? '<span class="text-ink-400">You: ?</span>' : `${who} ${actLabel(c.e, c.hero)}`}${c.d && !hidden ? ' ' + glyph(c.d, 'text-[10px]') : ''}</button>`;
  };
  return `<div class="space-y-1.5">
    <button data-step="0" class="mv ${k === 0 ? 'on' : ''} text-ink-400">Blinds posted</button>
    ${out.map(l => `<div class="flex gap-2 items-start">
      <span class="text-ink-400 text-xs w-14 shrink-0 pt-1.5">${l.head}</span>
      <div class="flex flex-wrap gap-1.5 items-center">${l.cards.length ? `<span class="mr-1 text-sm">${handText(l.cards.map(cardStr))}</span>` : ''}${l.chips.map(chip).join('')}</div></div>`).join('')}
  </div>`;
}

function guessPanel(d) {
  return `<div class="space-y-3" id="guess">
    <div class="flex items-center gap-2"><span class="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center">${icon('target', 'w-5 h-5')}</span>
      <div><div class="font-semibold text-white">Your move. What's the play?</div>
      <div class="text-xs text-ink-400">${STREET[d.street]} · pot ${fmtBB(d.pot)}${d.toCall > 0 ? ` · ${fmtBB(d.toCall)} to call` : ''}. Pick before the coach shows the answer.</div></div></div>
    ${actionBar(d.options)}
    <button id="skip" class="btn btn-quiet text-xs !px-0 text-ink-400">Skip: just show what I played</button>
  </div>`;
}

function guessResult(d, idx) {
  const o = d.options[idx], b = d.options[d.best];
  let head;
  if (idx === d.best) head = `<div class="verdict v-best"><div class="font-semibold text-emerald-300 flex items-center gap-2">${icon('star', 'w-5 h-5')} You found the best move: ${esc(optionLabel(o.label))}</div></div>`;
  else if (d.fine.includes(idx)) head = `<div class="verdict v-fine"><div class="font-semibold text-sky-300">Good: ${esc(optionLabel(o.label))}</div><div class="text-sm text-ink-200 mt-1">Best was ${esc(optionLabel(b.label))}, but it's close.</div></div>`;
  else {
    const gap = o.ev != null && b.ev != null ? b.ev - o.ev : null;
    head = `<div class="verdict v-mistake"><div class="font-semibold text-rose-300">Not quite: ${esc(optionLabel(o.label))}${gap != null && gap > 0.01 ? ` gives up ${fmtBB(gap)}` : ''}</div><div class="text-sm text-ink-200 mt-1">Best: <b>${esc(optionLabel(b.label))}</b>.</div></div>`;
  }
  const played = d.options[d.chosen];
  const same = idx === d.chosen;
  return `<div class="space-y-3">${head}
    <div class="text-sm text-ink-300">${same ? 'Same as you played at the table.' : `At the table you played <b class="text-white">${esc(played.label)}</b> ${glyph(d)}.`}</div>
    <button id="reveal-move" class="btn btn-primary btn-block">See the full analysis ${icon('next', 'w-4 h-4')}</button></div>`;
}

function resultPanel(h) {
  const s = rv.states.at(-1);
  const won = h.net > 0, lost = h.net < 0;
  let line;
  if (h.showdown) {
    const shown = s.holes.map((x, i) => i).filter(i => !(h.kind === 'hu' ? s.folded === i : s.folded[i]));
    const hid = new Set(h.hidden || []);
    line = shown.map(i => (hid.has(i) ? `${esc(h.names[i])}: not shown` : `${esc(h.names[i])}: ${handText(byRank(h.holes[i]).map(cardStr))} ${handName(h.holes[i], h.runout)}`)).join(' · ');
  } else line = (h.kind === 'hu' ? s.folded === h.hero : s.folded[h.hero]) ? 'You folded.' : 'Everyone else folded.';
  const acc = accuracyOf([h]);
  return `<div class="space-y-3">
    <div class="verdict ${won ? 'v-best' : lost ? 'v-mistake' : 'v-fine'}">
      <div class="text-lg font-semibold ${won ? 'text-emerald-300' : lost ? 'text-rose-300' : 'text-sky-300'}">${h.net == null ? 'Showdown (result not entered)' : won ? `You won ${fmtBB(h.net)}` : lost ? `You lost ${fmtBB(-h.net)}` : 'No chips changed hands for you'}</div>
      <div class="text-sm text-ink-200 mt-1">${line}</div>
      <div class="text-sm mt-1">${h.decisions.length ? `Accuracy <b class="${accTone(acc)}">${acc}</b> · ${h.evLost > 0.005 ? `<span class="text-rose-300">${fmtBB(h.evLost)} of EV lost</span>` : '<span class="text-emerald-300">no EV lost</span>'}` : 'You had no decision this hand.'}${Math.abs(h.luck || 0) >= 0.05 ? ` · all-in luck <b class="${tone(h.luck)}">${fmtBB(h.luck, { sign: true })}</b>` : ''}</div>
    </div>
    <div class="flex flex-wrap gap-1.5">${h.decisions.map(d => `<button data-step="${d.at + 1}" class="mv">${STREET[d.street]}: ${esc(d.options[d.chosen].label)} ${glyph(d, 'text-[10px]')}</button>`).join('')}</div>
  </div>`;
}

const evNote = (h, d) => (h.kind === 'table' ? evNoteFor(d, { table: true }) : null);

/** The session's hands as a strip of chips: number, worst grade, result. Tap one to jump to it. */
function handStrip(hands, cur) {
  return `<div id="hand-strip" class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">${hands.map(x => {
    const w = worstOf(x);
    return `<a href="#review/h/${x.id}" data-hand="${x.id}" class="shrink-0 flex flex-col items-center gap-0.5 rounded-lg border px-2 py-1 min-w-[52px] ${x.id === cur ? 'border-emerald-500/70 bg-emerald-500/10' : 'border-ink-700 bg-ink-850 hover:border-ink-500'}">
      <span class="text-[11px] text-ink-400 num">#${x.no}</span>
      ${w ? glyph(w, 'text-[10px]') : '<span class="text-[10px] text-ink-500 h-[20px] leading-[20px]">—</span>'}
      <span class="text-[10px] num ${tone(x.net ?? 0)}">${x.net == null ? '·' : fmtBB(x.net, { sign: true })}</span></a>`;
  }).join('')}</div>`;
}

/** Hand start: who you are, what you hold, and the decisions coming. */
function introPanel(h) {
  const opp = h.kind === 'hu' ? esc(AGENTS[h.opp]?.name ?? 'him') : `${h.n - 1} players`;
  return `<div class="space-y-2">
    <div class="text-sm text-ink-200">Hand ${h.no}. You are <b class="text-white">${posName(h, h.hero)}</b> with ${handText(byRank(h.holes[h.hero]).map(cardStr))} against ${opp}.</div>
    <div class="text-sm text-ink-300">${h.decisions.length ? `${h.decisions.length} decision${h.decisions.length === 1 ? '' : 's'} this hand: ${h.decisions.map(d => glyph(d, 'text-[10px]')).join(' ')}` : 'You had no decision this hand.'}</div>
    <div class="text-xs text-ink-400">Next goes to your first decision. Tap any action in the list to see the table at that point.</div></div>`;
}

/** Your decision: the spot, what you did, and the coach on it. */
function decisionPanel(h, d, e) {
  const g = GRADES[grade(d)];
  const opp = h.kind === 'hu' ? AGENTS[h.opp]?.name ?? 'him' : 'them';
  const spot = `${STREET[d.street]}${d.board.length ? ` ${handText(d.board.map(cardStr))}` : ''} · pot ${fmtBB(d.pot)}${d.toCall > 0.001 ? ` · ${fmtBB(d.toCall)} to call` : ''}`;
  const n = h.decisions.indexOf(d) + 1;
  return `<div class="space-y-3">
    <div class="flex items-center justify-between gap-2 text-xs text-ink-400"><span>${spot}</span><span>Decision ${n} of ${h.decisions.length}</span></div>
    <div class="flex items-center gap-2">${glyph(d, 'text-sm')}<span class="font-semibold ${g.tone}">${g.label}</span><span class="text-ink-200">· you ${actLabel(e, true)}</span></div>
    ${coachCard(d, { botName: opp, evNote: evNote(h, d), whyOpen: !['best', 'good'].includes(grade(d)) })}</div>`;
}

function draw(container) {
  const h = rv.hand;
  const k = rv.step;
  const L = h.log.length;
  const nextD = k < L ? decisionAt(h, k) : null;
  const lastD = k > 0 ? decisionAt(h, k - 1) : null;
  const lastE = k > 0 ? h.log[k - 1] : null;
  const toGuess = nextD && needsGuess(nextD) && rv.guess[k] == null;
  // your move right after your last one (you closed the action and act first on the next
  // street): the verdict on the last one shows first, then the quiz for the next
  const twin = toGuess && lastD && !rv.ask;
  const guessing = toGuess && !twin;
  const guessed = nextD && rv.guess[k] != null && rv.guess[k] >= 0;

  let panel;
  if (guessing) panel = guessPanel(nextD);
  else if (guessed) panel = guessResult(nextD, rv.guess[k]);
  else if (lastD) panel = decisionPanel(h, lastD, lastE);
  else if (k === L) panel = resultPanel(h);
  else if (lastE) panel = `<div class="text-sm text-ink-200"><b class="text-white">${esc(h.names[lastE.seat])}</b> ${actLabel(lastE)}.</div>
    ${nextD ? '<div class="text-sm text-ink-400 mt-2">Your decision is next.</div>' : ''}`;
  else panel = introPanel(h);
  if (k === L && lastD) panel += `<div class="mt-4">${resultPanel(h)}</div>`;

  // a decision shows the spot you faced (before your move), with your move tagged on your seat
  const table = lastD && !guessing ? tableAt(h, k - 1, k) : tableAt(h, k);

  const hands = rv.session?.hands ?? [h];
  const hi = hands.findIndex(x => x.id === h.id);
  const prevHand = hands[hi - 1], nextHand = hands[hi + 1];
  const stops = stopsOf(h);
  const nextStop = stops.find(x => x > k);
  const prevStop = [...stops].reverse().find(x => x < k);
  const atEnd = nextStop == null;
  const nextLabel = guessing ? 'Answer first' : twin ? `Your next move ${icon('next', 'w-5 h-5')}` : !atEnd ? `Next ${icon('next', 'w-5 h-5')}` : nextHand ? `Hand ${nextHand.no} ${icon('next', 'w-5 h-5')}` : rv.session ? `Session summary ${icon('next', 'w-5 h-5')}` : 'End of hand';
  const nextOff = guessing || (atEnd && !nextHand && !rv.session);
  const prevOff = k === 0 && !prevHand;

  // a redraw of the same step (show their cards, quiz mode) keeps what you had opened
  const openState = rv.drawn === `${h.id}/${k}` ? [...container.querySelectorAll('#rv-panel details')].map(d => d.open) : [];
  rv.drawn = `${h.id}/${k}`;
  const stripScroll = container.querySelector('#hand-strip')?.scrollLeft ?? null;
  container.innerHTML = `<div class="page space-y-3">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2 min-w-0">
        <a href="${rv.session ? `#review/s/${h.sid}` : '#review'}" class="btn btn-quiet text-sm !px-2" aria-label="Back to the session">${icon('back', 'w-4 h-4')}</a>
        <div class="min-w-0"><div class="text-sm font-semibold text-white truncate">${sessionTitle(h)}</div>
          <div class="text-xs text-ink-400">Hand ${h.no}${hands.length > 1 ? ` of ${hands.length}` : ''} · ${new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div></div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-ink-400 uppercase tracking-wider font-semibold">Quiz me</span>
        ${seg('guess', [{ v: 'off', label: 'Off' }, { v: 'mistakes', label: 'Mistakes' }, { v: 'all', label: 'Every move' }], guessMode())}
      </div>
    </div>
    ${hands.length > 1 ? handStrip(hands, h.id) : ''}
    <div class="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5 items-start">
      <div class="space-y-3 min-w-0">
        ${table}
        <div class="flex items-center gap-2">
          <button class="btn" id="rv-first" ${k === 0 ? 'disabled' : ''} aria-label="Start of the hand" title="Start of the hand">${icon('first', 'w-5 h-5')}</button>
          <button class="btn" id="rv-prev" ${prevOff ? 'disabled' : ''} aria-label="Back">${icon('back', 'w-5 h-5')}</button>
          <button class="btn btn-primary flex-1 btn-lg" id="rv-next" ${nextOff ? 'disabled' : ''}>${nextLabel}</button>
        </div>
        <div class="flex items-center justify-between gap-2 text-sm">
          ${prevHand ? `<button class="btn btn-quiet !px-2" id="rv-prev-hand">${icon('back', 'w-4 h-4')} Hand ${prevHand.no}</button>` : '<span></span>'}
          <label class="flex items-center gap-2 text-ink-300"><input type="checkbox" id="show-cards" ${rv.showCards ? 'checked' : ''} class="accent-amber-400"> Show their cards</label>
          ${nextHand ? `<button class="btn btn-quiet !px-2" id="rv-next-hand">Hand ${nextHand.no} ${icon('next', 'w-4 h-4')}</button>` : '<span></span>'}
        </div>
        <p class="text-xs text-ink-400 hidden lg:block">Keys: → next decision, ← back, ↓ ↑ next / previous hand.</p>
      </div>
      <div class="space-y-4">
        <div class="panel panel-pad" id="rv-panel">${panel}
          ${nextOff ? '' : `<button class="btn btn-primary btn-block btn-lg mt-4 lg:hidden" id="rv-next-2">${nextLabel}</button>`}</div>
        <div class="panel panel-pad"><div class="h-sec mb-2">Hand ${h.no}: every action</div>${moveList(h, k)}</div>
      </div>
    </div>
  </div>`;
  container.querySelectorAll('#rv-panel details').forEach((d, i) => { if (openState[i] != null) d.open = openState[i]; });
  const strip = container.querySelector('#hand-strip');
  if (strip) {
    if (stripScroll != null) strip.scrollLeft = stripScroll;
    const on = strip.querySelector(`[data-hand="${h.id}"]`);
    if (on && (on.offsetLeft < strip.scrollLeft || on.offsetLeft + on.offsetWidth > strip.scrollLeft + strip.clientWidth)) strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.offsetWidth / 2;
  }
  // stepping re-draws the table: only newly dealt board cards animate
  const shownState = lastD && !guessing ? k - 1 : k;
  const boardLen = viewOf(h, rv.states[shownState]).board.length;
  const grew = boardLen > (rv.boardLen ?? 0) ? boardLen - (rv.boardLen ?? 0) : 0;
  rv.boardLen = boardLen;
  const dealt = [...container.querySelectorAll('.tbl-board .deal')];
  container.querySelectorAll('.rtable .deal').forEach(el => { if (!dealt.slice(dealt.length - grew).includes(el)) el.classList.remove('deal'); });

  const toHand = (x, step = null) => navigate(`review/h/${x.id}${step != null ? `/${step}` : ''}`);
  container.querySelector('#rv-first').addEventListener('click', () => go(container, 0));
  container.querySelector('#rv-prev').addEventListener('click', () => {
    if (toGuess && lastD && rv.ask) { rv.ask = false; draw(container); } // back from the quiz to the verdict on your last move
    else if (prevStop != null) go(container, prevStop);
    else if (k > 0) go(container, 0);
    else if (prevHand) toHand(prevHand, 'end');
  });
  container.querySelector('#rv-next').addEventListener('click', () => {
    if (nextOff) return;
    if (twin) { rv.ask = true; draw(container); }
    else if (!atEnd) go(container, nextStop);
    else if (nextHand) toHand(nextHand);
    else navigate(`review/s/${h.sid}`);
  });
  // the second Next, under the coach on a phone or a portrait iPad: back up to the table after
  container.querySelector('#rv-next-2')?.addEventListener('click', () => { container.querySelector('#rv-next').click(); window.scrollTo(0, 0); });
  container.querySelector('#rv-prev-hand')?.addEventListener('click', () => toHand(prevHand));
  container.querySelector('#rv-next-hand')?.addEventListener('click', () => toHand(nextHand));
  container.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    let j = Number(b.dataset.step);
    // jumping past a move you haven't answered stops there first
    for (let q = k; q < j; q++) { const d = decisionAt(h, q); if (d && needsGuess(d) && rv.guess[q] == null) { j = q; break; } }
    go(container, j);
  }));
  container.querySelectorAll('#guess [data-i]').forEach(b => b.addEventListener('click', () => { rv.guess[k] = Number(b.dataset.i); draw(container); }));
  container.querySelector('#skip')?.addEventListener('click', () => { rv.guess[k] = -1; go(container, k + 1); });
  container.querySelector('#reveal-move')?.addEventListener('click', () => go(container, k + 1));
  container.querySelector('#show-cards').addEventListener('change', (e) => { rv.showCards = e.target.checked; draw(container); });
  wireSeg(container, (name, v) => { saveSettings({ ...settings(), reviewGuess: v }); draw(container); });
}
