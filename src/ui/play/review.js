/**
 * Review: chess-style game review of the hands you played, and the leak report across sessions.
 *   #play/review                    sessions + leaks
 *   #play/review/s/<sid>            one session: accuracy, grades, key moments, every hand
 *   #play/review/h/<id>[/<step>]    the hand replayer: step through it move by move; before each of
 *                                   your decisions you can guess first, and the grade shows after
 */
import {
  loadHands, sessionsOf, statesOf, viewOf, posName, decisionAt, grade, GRADES, accuracyOf, gradeCounts,
  leakReport, getHand, clearHands,
} from '../../engine/history.js';
import { AGENTS, eloOf } from '../../engine/hu/agents.js';
import { LEVELS } from '../../engine/ring/players.js';
import { cardStr, evaluate, category } from '../../engine/hu/hand.js';
import { ringTable, fmtBB, icon, esc, stat, handText, seg, wireSeg, disc, sprOf, optionLabel } from '../kit.js';
import { coachCard, actionBar, playTabs } from './views.js';
import { settings, saveSettings } from '../../store.js';
import { pct } from '../../engine/potmath.js';

const STREET = ['Preflop', 'Flop', 'Turn', 'River'];
const CAT = ['High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'];
const byRank = (h) => [...h].sort((a, b) => (b >> 2) - (a >> 2));
const tone = (x) => (x > 0 ? 'text-emerald-300' : x < 0 ? 'text-rose-300' : '');
const accTone = (a) => (a == null ? '' : a >= 90 ? 'text-emerald-300' : a >= 75 ? 'text-sky-300' : a >= 60 ? 'text-yellow-300' : 'text-rose-300');

let rv = null; // replayer state
let keyHandler = null;

export function render(container, params = []) {
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  if (params[0] === 'log') return import('./logger.js').then(m => m.render(container, params.slice(1)));
  if (params[0] === 's') sessionView(container, Number(params[1]));
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

// ------------------------------------------------------------------ review home

function home(container) {
  const hands = loadHands();
  const sessions = sessionsOf(hands);
  const rep = leakReport(hands);
  const acc = accuracyOf(hands);
  const maxLost = Math.max(0.01, ...rep.leaks.map(l => l.lost));
  const empty = `<div class="panel panel-pad text-center py-12 space-y-3">
    <div class="mx-auto w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-300 flex items-center justify-center">${icon('review', 'w-6 h-6')}</div>
    <div class="text-lg font-semibold text-white">No hands yet</div>
    <p class="text-sm text-ink-300 max-w-md mx-auto">Every hand you play heads-up or at the live table lands here. Replay it move by move, guess your move before the coach shows the grade, and see which leaks cost you the most.</p>
    <div class="flex gap-2 justify-center flex-wrap"><a class="btn btn-primary" href="#play">Play heads-up</a><a class="btn" href="#play/table">Live table</a><a class="btn" href="#play/review/log">${icon('pen', 'w-4 h-4')} Log a hand from the casino</a></div></div>`;

  const leaks = rep.leaks.length ? rep.leaks.slice(0, 8).map(l => disc(`<span class="flex-1 min-w-0">
      <span class="flex items-center gap-2"><span class="font-semibold text-white truncate">${esc(l.name)}</span>
        <span class="ml-auto text-rose-300 text-xs font-semibold num whitespace-nowrap pr-2">−${l.per100.toFixed(1)}bb/100</span></span>
      <span class="evbar mt-1.5 block"><i style="width:${Math.max(3, (100 * l.lost) / maxLost)}%;background:#f43f5e"></i></span></span>`,
    `<p class="text-ink-200">${esc(l.fix)}</p>
     <p class="text-xs text-ink-400">${l.count} time${l.count === 1 ? '' : 's'} · ${fmtBB(l.lost)} of EV in total.</p>
     <div class="space-y-1.5 pt-1">${l.examples.map(e => `<a href="#play/review/h/${e.id}/${e.at}" class="flex items-center gap-2 text-sm rounded-lg bg-ink-850 border border-ink-700 px-3 py-2 hover:border-ink-500">
       <span>${handText(byRank(e.hole).map(cardStr))}</span><span class="text-ink-400">${e.board.length ? 'on ' + handText(e.board.map(cardStr)) : STREET[e.street]}</span>
       <span class="truncate text-ink-300">· ${esc(e.label)} <span class="text-ink-500">(best: ${esc(e.best)})</span></span>
       <span class="ml-auto text-rose-300 text-xs font-semibold num">−${e.loss.toFixed(1)}</span></a>`).join('')}</div>`)).join('')
    : '<p class="text-sm text-ink-400">No leaks found yet. Play more hands.</p>';

  container.innerHTML = `<div class="page space-y-6 fade-up">
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div><div class="h-sec">Play</div><h1 class="h-title">Review</h1>
        <p class="muted mt-1 text-sm max-w-2xl">Game review, like chess: replay your hands, find the better move, and see where your EV goes.</p></div>
      <div class="flex items-center gap-2 flex-wrap"><a href="#play/review/log" class="btn btn-primary">${icon('pen', 'w-4 h-4')} Log a live hand</a>${playTabs('review')}</div>
    </div>
    ${!hands.length ? empty : `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${stat('Accuracy', `<span class="${accTone(acc)}">${acc ?? '—'}</span>`, `last ${hands.length} hands`)}
      ${stat('EV lost', `−${rep.per100.toFixed(1)}`, 'bb per 100 hands', 'text-rose-200')}
      ${stat('Decisions', rep.spots, `${sessions.length} session${sessions.length === 1 ? '' : 's'}`)}
      ${stat('Result', `<span class="${tone(hands.reduce((a, h) => a + (h.net ?? 0), 0))}">${fmtBB(hands.reduce((a, h) => a + (h.net ?? 0), 0), { sign: true })}</span>`, 'all stored hands')}
    </div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
      <div class="space-y-2">
        <div class="flex items-baseline justify-between"><div class="h-sec">Your leaks</div><span class="text-xs text-ink-400">cost per 100 hands</span></div>
        ${leaks}
      </div>
      <div class="space-y-2">
        <div class="h-sec">Sessions</div>
        <div class="panel divide-y divide-ink-800">${sessions.map(x => {
          const a = accuracyOf(x.hands);
          const net = x.hands.reduce((q, h) => q + (h.net ?? 0), 0);
          const c = gradeCounts(x.hands);
          return `<a href="#play/review/s/${x.sid}" class="flex items-center gap-3 px-4 py-3 hover:bg-ink-850/60">
            <div class="min-w-0 flex-1"><div class="text-sm font-semibold text-white truncate">${sessionTitle(x)}</div>
              <div class="text-xs text-ink-400">${new Date(x.sid).toLocaleString([], x.level === 'live' || x.hands[0]?.live ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${x.hands.length} hand${x.hands.length === 1 ? '' : 's'} · <span class="${tone(net)}">${fmtBB(net, { sign: true })}</span>${c.blunder ? ` · <span class="text-rose-300">${c.blunder} blunder${c.blunder > 1 ? 's' : ''}</span>` : ''}</div></div>
            <div class="text-right"><div class="text-xl font-semibold num ${accTone(a)}">${a ?? '—'}</div><div class="text-[10px] uppercase tracking-wider text-ink-400">accuracy</div></div>
            ${icon('next', 'w-4 h-4 text-ink-400')}</a>`;
        }).join('')}</div>
        <button id="clear" class="btn btn-quiet text-xs !px-0 text-ink-400">Clear hand history</button>
      </div>
    </div>`}
  </div>`;
  const clr = container.querySelector('#clear');
  clr?.addEventListener('click', () => {
    if (clr.dataset.armed) { clearHands(); home(container); return; }
    clr.dataset.armed = '1';
    clr.textContent = 'Tap again to delete every stored hand';
    clr.classList.add('!text-rose-300');
  });
}

// ------------------------------------------------------------------ one session

function sessionView(container, sid) {
  const x = sessionsOf().find(q => q.sid === sid);
  if (!x) { container.innerHTML = `<div class="page text-ink-300">That session is no longer stored. <a class="underline" href="#play/review">Back to Review</a></div>`; return; }
  const acc = accuracyOf(x.hands);
  const c = gradeCounts(x.hands);
  const net = x.hands.reduce((a, h) => a + (h.net ?? 0), 0);
  const lost = x.hands.reduce((a, h) => a + h.evLost, 0);
  const luck = x.hands.reduce((a, h) => a + (h.luck || 0), 0);
  const key = x.hands.flatMap(h => h.decisions.filter(d => ['inaccuracy', 'mistake', 'blunder'].includes(grade(d))).map(d => ({ h, d })))
    .sort((a, b) => b.d.loss - a.d.loss).slice(0, 10);
  const firstKey = [...key].sort((a, b) => a.h.no - b.h.no || a.d.at - b.d.at)[0];
  container.innerHTML = `<div class="page space-y-5 fade-up">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div><a href="#play/review" class="text-sm text-ink-400 hover:text-white inline-flex items-center gap-1">${icon('back', 'w-4 h-4')} Review</a>
        <h1 class="h-title mt-1">${sessionTitle(x)}</h1>
        <div class="text-sm text-ink-400">${new Date(x.sid).toLocaleString()} · ${x.hands.length} hands</div></div>
      <div class="flex gap-2">
        ${firstKey ? `<a class="btn btn-primary" href="#play/review/h/${firstKey.h.id}/${firstKey.d.at}">${icon('target', 'w-4 h-4')} Retry your mistakes</a>` : ''}
        <a class="btn" href="#play/review/h/${x.hands[0].id}">${icon('play', 'w-4 h-4')} Replay from hand 1</a></div>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${stat('Accuracy', `<span class="${accTone(acc)}">${acc ?? '—'}</span>`, 'chess-style: 100 = every move best')}
      ${stat('EV lost', `−${lost.toFixed(1)}bb`, `${x.hands.length ? ((100 * lost) / x.hands.length).toFixed(1) : 0}bb/100`, 'text-rose-200')}
      ${stat('Result', `<span class="${tone(net)}">${fmtBB(net, { sign: true })}</span>`, x.kind === 'hu' ? `luck ${fmtBB(luck, { sign: true })}` : '')}
      ${stat('Decisions', x.hands.reduce((a, h) => a + h.decisions.length, 0), '')}
    </div>
    <div class="panel panel-pad grid grid-cols-5 gap-2 text-center">
      ${Object.entries(GRADES).map(([k, g]) => `<div><div class="mx-auto w-9 h-9 rounded-xl border ${g.bg} ${g.tone} flex items-center justify-center font-bold">${g.glyph}</div>
        <div class="text-lg font-semibold num text-white mt-1">${c[k]}</div><div class="text-[11px] text-ink-400">${g.label}</div></div>`).join('')}
    </div>
    <div class="grid lg:grid-cols-2 gap-5 items-start">
      <div class="space-y-2"><div class="h-sec">Key moments</div>
        ${key.length ? key.map(({ h, d }) => `<a href="#play/review/h/${h.id}/${d.at}" class="panel flex items-center gap-3 px-4 py-3 hover:border-ink-500">
          ${glyph(d)}<span class="text-xs text-ink-400 w-14">Hand ${h.no}</span>
          <span class="text-sm">${handText(byRank(d.hole).map(cardStr))}</span>
          <span class="text-sm text-ink-400 truncate">${d.board.length ? handText(d.board.map(cardStr)) : 'preflop'}</span>
          <span class="ml-auto text-xs text-ink-300">Find a better move</span>${icon('next', 'w-4 h-4 text-ink-400')}</a>`).join('')
          : '<p class="text-sm text-ink-400">No mistakes this session. Clean.</p>'}
      </div>
      <div class="space-y-2"><div class="h-sec">Every hand</div>
        <div class="panel divide-y divide-ink-800">${x.hands.map(h => `<a href="#play/review/h/${h.id}" class="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-850/60">
          <span class="text-xs text-ink-400 w-12">#${h.no}</span><span class="text-xs text-ink-300 w-9">${posName(h, h.hero)}</span>
          <span class="text-sm">${handText(byRank(h.holes[h.hero]).map(cardStr))}</span>
          <span class="flex gap-1">${h.decisions.map(d => glyph(d, 'text-[10px]')).join('')}</span>
          <span class="ml-auto text-sm num ${tone(h.net ?? 0)}">${h.net == null ? '—' : fmtBB(h.net, { sign: true })}</span></a>`).join('')}</div>
      </div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ replayer

function replayer(container, id, stepParam) {
  const hand = getHand(id);
  if (!hand) { container.innerHTML = `<div class="page text-ink-300">That hand is no longer stored. <a class="underline" href="#play/review">Back to Review</a></div>`; return; }
  if (!rv || rv.hand.id !== id) {
    const states = statesOf(hand);
    const session = sessionsOf().find(q => q.sid === hand.sid);
    rv = { hand, states, step: 0, guess: {}, showCards: false, session };
  }
  rv.step = stepParam != null ? Math.max(0, Math.min(rv.states.length - 1, Number(stepParam) || 0)) : rv.step;
  keyHandler = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); container.querySelector('#rv-next')?.click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(container, rv.step - 1); }
    else if (e.key === 'Home') go(container, 0);
    else if (e.key === 'End') go(container, rv.states.length - 1);
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
  history.replaceState(null, '', `#play/review/h/${rv.hand.id}/${rv.step}`);
  draw(container);
}

const guessMode = () => settings().reviewGuess ?? 'mistakes';
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

function tableAt(h, k) {
  const s = rv.states[k];
  const v = viewOf(h, s);
  const log = h.log.slice(0, k);
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
    line = shown.map(i => (hid.has(i) ? `${esc(h.names[i])}: not shown` : `${esc(h.names[i])}: ${handText(byRank(h.holes[i]).map(cardStr))} ${CAT[category(evaluate([...h.holes[i], ...h.runout]))]}`)).join(' · ');
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

const evNote = (h, d) => (h.kind === 'table'
  ? `EV in bb against every opponent still in the hand${d.opponents > 1 ? '; multiway: Monte Carlo, one street ahead' : ''}.`
  : null);

function draw(container) {
  const h = rv.hand;
  const k = rv.step;
  const L = h.log.length;
  const nextD = k < L ? decisionAt(h, k) : null;
  const guessing = nextD && needsGuess(nextD) && rv.guess[k] == null;
  const guessed = nextD && rv.guess[k] != null && rv.guess[k] >= 0;
  const lastD = k > 0 ? decisionAt(h, k - 1) : null;
  const lastE = k > 0 ? h.log[k - 1] : null;
  const opp = h.kind === 'hu' ? AGENTS[h.opp]?.name ?? 'him' : 'them';

  let panel;
  if (guessing) panel = guessPanel(nextD);
  else if (guessed) panel = guessResult(nextD, rv.guess[k]);
  else if (lastD) {
    const g = GRADES[grade(lastD)];
    panel = `<div class="space-y-2"><div class="flex items-center gap-2 text-sm text-ink-300">${glyph(lastD, 'text-sm')}<span class="${g.tone} font-semibold">${g.label}</span><span>· you ${actLabel(lastE, true)}</span></div>
      ${coachCard(lastD, { botName: opp, evNote: evNote(h, lastD) })}</div>`;
  } else if (k === L) panel = resultPanel(h);
  else if (lastE) panel = `<div class="text-sm text-ink-200"><b class="text-white">${esc(h.names[lastE.seat])}</b> ${actLabel(lastE)}.</div>
    ${nextD ? '<div class="text-sm text-ink-400 mt-2">Your decision is next.</div>' : ''}`;
  else panel = `<div class="text-sm text-ink-300">Blinds posted. You are <b class="text-white">${posName(h, h.hero)}</b> with ${handText(byRank(h.holes[h.hero]).map(cardStr))}. Step through with ${icon('next', 'w-3.5 h-3.5 inline')} or the arrow keys.</div>`;
  if (k === L && !guessing && lastD) panel += `<div class="mt-4">${resultPanel(h)}</div>`;

  const hands = rv.session?.hands ?? [h];
  const hi = hands.findIndex(x => x.id === h.id);
  const prevHand = hands[hi - 1], nextHand = hands[hi + 1];
  const disabledNext = guessing || k >= L;

  const openState = [...container.querySelectorAll('#rv-panel details')].map(d => d.open);
  container.innerHTML = `<div class="page">
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <div class="flex items-center gap-3 min-w-0">
        <a href="${rv.session ? `#play/review/s/${h.sid}` : '#play/review'}" class="btn btn-quiet text-sm !px-2">${icon('back', 'w-4 h-4')}</a>
        <div class="min-w-0"><div class="text-sm font-semibold text-white truncate">Hand ${h.no} · ${sessionTitle(h)}</div>
          <div class="text-xs text-ink-400">${new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div></div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-ink-400 uppercase tracking-wider font-semibold">Guess first</span>
        ${seg('guess', [{ v: 'mistakes', label: 'My mistakes' }, { v: 'all', label: 'Every move' }, { v: 'off', label: 'Off' }], guessMode())}
      </div>
    </div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
      <div class="space-y-3 min-w-0">
        ${tableAt(h, k)}
        <div class="flex items-center gap-2">
          <button class="btn" id="rv-first" ${k === 0 ? 'disabled' : ''} aria-label="Start">${icon('first', 'w-5 h-5')}</button>
          <button class="btn" id="rv-prev" ${k === 0 ? 'disabled' : ''} aria-label="Back">${icon('back', 'w-5 h-5')}</button>
          <button class="btn btn-primary flex-1 btn-lg" id="rv-next" ${disabledNext ? 'disabled' : ''}>${guessing ? 'Your move first' : k >= L ? 'End of hand' : `Next ${icon('next', 'w-5 h-5')}`}</button>
          <button class="btn" id="rv-last" ${k >= L || guessing ? 'disabled' : ''} aria-label="End">${icon('last', 'w-5 h-5')}</button>
        </div>
        <div class="flex items-center justify-between gap-2 text-sm">
          ${prevHand ? `<a class="btn btn-quiet !px-2" href="#play/review/h/${prevHand.id}">${icon('back', 'w-4 h-4')} Hand ${prevHand.no}</a>` : '<span></span>'}
          <label class="flex items-center gap-2 text-ink-300"><input type="checkbox" id="show-cards" ${rv.showCards ? 'checked' : ''} class="accent-amber-400"> Show their cards</label>
          ${nextHand ? `<a class="btn btn-quiet !px-2" href="#play/review/h/${nextHand.id}">Hand ${nextHand.no} ${icon('next', 'w-4 h-4')}</a>` : '<span></span>'}
        </div>
      </div>
      <div class="space-y-4 lg:row-span-2">
        <div class="panel panel-pad" id="rv-panel">${panel}</div>
        <div class="panel panel-pad">${moveList(h, k)}</div>
      </div>
    </div>
  </div>`;
  container.querySelectorAll('#rv-panel details').forEach((d, i) => { if (openState[i]) d.open = true; });
  // stepping re-draws the table: only newly dealt board cards animate
  const boardLen = viewOf(h, rv.states[k]).board.length;
  const grew = boardLen > (rv.boardLen ?? 0) ? boardLen - (rv.boardLen ?? 0) : 0;
  rv.boardLen = boardLen;
  const dealt = [...container.querySelectorAll('.tbl-board .deal')];
  container.querySelectorAll('.rtable .deal').forEach(el => { if (!dealt.slice(dealt.length - grew).includes(el)) el.classList.remove('deal'); });

  container.querySelector('#rv-first').addEventListener('click', () => go(container, 0));
  container.querySelector('#rv-prev').addEventListener('click', () => go(container, k - 1));
  container.querySelector('#rv-next').addEventListener('click', () => { if (!disabledNext) go(container, k + 1); });
  container.querySelector('#rv-last').addEventListener('click', () => {
    // stop at the next move you still have to guess
    let j = k;
    while (j < L) { const d = decisionAt(h, j); if (d && needsGuess(d) && rv.guess[j] == null) break; j++; }
    go(container, j);
  });
  container.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => {
    let j = Number(b.dataset.step);
    // jumping past a move you haven't guessed stops there first
    for (let q = k; q < j; q++) { const d = decisionAt(h, q); if (d && needsGuess(d) && rv.guess[q] == null) { j = q; break; } }
    go(container, j);
  }));
  container.querySelectorAll('#guess [data-i]').forEach(b => b.addEventListener('click', () => { rv.guess[k] = Number(b.dataset.i); draw(container); }));
  container.querySelector('#skip')?.addEventListener('click', () => { rv.guess[k] = -1; go(container, k + 1); });
  container.querySelector('#reveal-move')?.addEventListener('click', () => go(container, k + 1));
  container.querySelector('#show-cards').addEventListener('change', (e) => { rv.showCards = e.target.checked; draw(container); });
  wireSeg(container, (name, v) => { saveSettings({ ...settings(), reviewGuess: v }); draw(container); });
}
