/**
 * Live table: you and up to five players from a live $1/$2 pool, each a mix of styles. Read them
 * from their stats (VPIP / PFR) or reveal their styles; the coach grades every decision.
 */
import {
  createTable, startHand, heroToAct, coachNow, coachReady, heroAct, botAct, endHand, summary, HERO,
} from '../../engine/ring/session.js';
import { board, pot, posOf, legal } from '../../engine/ring/game.js';
import { styleLabel, ARCHETYPES, adjustment, LEVELS } from '../../engine/ring/players.js';
import { settings, saveSettings } from '../../store.js';
import { ringTable, fmtBB, seg, wireSeg, icon, esc, stat, handText, disc, verdict, sprOf } from '../kit.js';
import { actionBar, coachCard, decisionRow, playTabs } from './views.js';
import { pct } from '../../engine/potmath.js';
import { cardStr, evaluate, category } from '../../engine/hu/hand.js';
import { addHand, packTable } from '../../engine/history.js';

let t = null;
let ui = { last: null, paused: false, recap: null, over: false, reveal: false };
let timer = null;
let keyHandler = null;
const STREET = ['Preflop', 'Flop', 'Turn', 'River'];
const CAT = ['High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'];
const byRank = (h) => [...h].sort((a, b) => (b >> 2) - (a >> 2));

export function render(container) {
  if (!t) setup(container);
  else if (ui.over) review(container);
  else draw(container);
  keyHandler = (e) => {
    if (!t || ui.over || e.metaKey || e.ctrlKey) return;
    if (e.key === 'Enter' || e.key === ' ') { const b = container.querySelector('#continue, #next'); if (b) { e.preventDefault(); b.click(); } }
    const n = Number(e.key);
    if (n >= 1 && n <= 9) container.querySelector(`#controls [data-i="${n - 1}"]`)?.click();
  };
  window.addEventListener('keydown', keyHandler);
  return () => { clearTimeout(timer); timer = null; window.removeEventListener('keydown', keyHandler); };
}

function setup(container) {
  const st = settings();
  const size = st.tableSize ?? 6;
  const level = st.tableLevel ?? 'medium';
  container.innerHTML = `<div class="page space-y-6 fade-up">
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div><div class="h-sec">Play</div><h1 class="h-title">Live table</h1>
        <p class="muted mt-1 text-sm max-w-2xl">Sit down with up to five players from a live $1/$2 pool: stations, whales, nits, maniacs, regs, sharks and pros, and mixes of them. Choose how tough the table is. Nobody wears a label: read them from how they play. They read you too.</p></div>
      ${playTabs('table')}
    </div>
    <div class="grid sm:grid-cols-3 gap-3">
      ${Object.entries(LEVELS).map(([k, L]) => `<button data-level="${k}" class="text-left panel panel-pad transition hover:border-ink-500 ${k === level ? 'ring-2 ring-emerald-400/80 border-emerald-500/40' : ''}">
        <div class="flex items-center justify-between"><span class="text-lg font-semibold text-white">${L.name}</span>
          <span class="flex gap-1">${[0, 1, 2].map(j => `<i class="inline-block w-2 h-2 rounded-full ${j <= ['easy', 'medium', 'hard'].indexOf(k) ? 'bg-amber-300' : 'bg-ink-600'}"></i>`).join('')}</span></div>
        <p class="text-sm text-ink-300 mt-2 leading-snug">${L.blurb}</p>
        <p class="text-xs text-ink-400 mt-2">A solid reg wins about ${{ easy: 100, medium: 45, hard: 20 }[k]}bb/100 here.</p>
      </button>`).join('')}
    </div>
    <div class="panel panel-pad grid md:grid-cols-2 lg:grid-cols-4 gap-5">
      <div class="space-y-2"><div class="h-sec">Players</div>
        ${seg('size', [{ v: 4, label: '4' }, { v: 5, label: '5' }, { v: 6, label: '6-max' }], size)}</div>
      <div class="space-y-2"><div class="h-sec">Stacks</div>
        ${seg('stacks', [{ v: 'even', label: '100bb' }, { v: 'mixed', label: 'Live mix' }, { v: 'deep', label: '200bb' }], st.tableStacks ?? 'even')}
        <p class="text-xs text-ink-400">${{ even: 'Everyone 100bb.', mixed: 'Like a real game: $50 short stacks next to $600 deep ones. You have 100bb. Watch the SPR.', deep: 'Everyone 200bb deep: implied odds and big pots.' }[st.tableStacks ?? 'even']}</p></div>
      <div class="space-y-2"><div class="h-sec">Coach</div>
        ${seg('coach', [{ v: 'decision', label: 'Every decision' }, { v: 'hand', label: 'After hands' }, { v: 'off', label: 'Off' }], st.coach)}</div>
      <div class="space-y-2"><div class="h-sec">Player styles</div>
        ${seg('reveal', [{ v: 'hide', label: 'Read them' }, { v: 'show', label: 'Show' }], st.reveal ? 'show' : 'hide')}
        <p class="text-xs text-ink-400">"Read them" shows only their stats (VPIP / PFR), like a HUD, until you reveal.</p></div>
    </div>
    <button id="start" class="btn btn-primary btn-lg btn-block">${icon('play', 'w-5 h-5')} Take a seat</button>
  </div>`;
  wireSeg(container, (name, v) => {
    const cur = settings();
    if (name === 'size') cur.tableSize = Number(v);
    if (name === 'coach') cur.coach = v;
    if (name === 'reveal') cur.reveal = v === 'show';
    if (name === 'stacks') cur.tableStacks = v;
    saveSettings(cur);
    setup(container);
  });
  container.querySelectorAll('[data-level]').forEach(b => b.addEventListener('click', () => {
    saveSettings({ ...settings(), tableLevel: b.dataset.level });
    setup(container);
  }));
  container.querySelector('#start').addEventListener('click', () => {
    const cur = settings();
    t = createTable({ n: cur.tableSize ?? 6, coachMode: cur.coach, level: cur.tableLevel ?? 'medium', stacks: cur.tableStacks ?? 'even' });
    ui = { last: null, paused: false, recap: null, over: false, reveal: !!cur.reveal };
    startHand(t);
    draw(container);
  });
}

/** Each seat's last action on the current street (for the tags). */
function lastActions(s) {
  const out = {};
  for (const e of s.log) {
    if (e.street !== s.street && !s.done) continue;
    const lab = e.type === 'fold' ? 'Fold' : e.type === 'check' ? 'Check' : e.type === 'call' ? `Call ${e.amount}` : e.type === 'bet' ? `Bet ${e.amount}` : e.type === 'raise' ? `Raise ${e.to}` : e.callAllIn ? `Call all-in` : `All-in ${e.to}`;
    out[e.seat] = { lab, tone: e.type === 'fold' ? 't-fold' : ['bet', 'raise', 'allin'].includes(e.type) ? 't-aggr' : '' };
  }
  return out;
}

function hudLine(p) {
  const h = p.hud;
  if (!h || h.hands < 8) return `${h?.hands ?? 0} hands`;
  return `${Math.round((100 * h.vpip) / h.hands)} / ${Math.round((100 * h.pfr) / h.hands)}`;
}

function tableHtml(thinking) {
  const s = t.s;
  const acts = lastActions(s);
  const reveal = s.done && s.result.showdown;
  const seats = t.players.map((p, i) => {
    const pos = posOf(s, i);
    const hero = i === HERO;
    const a = acts[i];
    const winner = s.done && s.result.winners.includes(i);
    return {
      name: hero ? 'You' : p.name,
      sub: hero ? pos : `${pos} · ${ui.reveal ? styleLabel(p) : hudLine(p)}`,
      stack: fmtBB(s.stacks[i]),
      cards: hero ? byRank(s.holes[i]) : s.folded[i] ? null : reveal ? byRank(s.holes[i]) : 'back',
      folded: s.folded[i],
      dealer: i === s.btn,
      bet: s.done ? 0 : s.streetBet[i],
      acting: !s.done && s.toAct === i,
      hero,
      tag: winner ? `Wins ${fmtBB(s.result.net[i] + s.invested[i])}` : a?.lab,
      tagTone: winner ? 't-win' : a?.tone,
    };
  });
  const bd = s.done ? s.runout.slice(0, s.result.showdown ? 5 : board(s).length) : board(s);
  return ringTable({
    seats, board: bd,
    pot: s.done ? pot(s) : pot(s) - s.streetBet.reduce((x, y) => x + y, 0),
    spr: s.done || s.folded[HERO] ? null : sprOf({ street: s.street, stacks: s.stacks, streetBet: s.streetBet, pot: pot(s), live: s.holes.map((_, i) => i).filter(i => !s.folded[i]), seat: HERO }),
    note: thinking ? `${t.players[s.toAct].name} is thinking…` : '',
  });
}

function historyHtml() {
  const s = t.s;
  const lines = [];
  let street = -1;
  for (const e of s.log) {
    if (e.street !== street) {
      street = e.street;
      const cs = street === 0 ? [] : street === 1 ? s.runout.slice(0, 3) : [s.runout[street + 1]];
      lines.push({ head: STREET[street], cards: cs, acts: [] });
    }
    const who = e.seat === HERO ? 'You' : t.players[e.seat].name;
    const a = e.type === 'call' ? `call ${e.amount}` : e.type === 'raise' ? `raise to ${e.to}` : e.type === 'bet' ? `bet ${e.amount}` : e.type === 'allin' ? (e.callAllIn ? 'call all-in' : `all-in ${e.to}`) : e.type;
    if (e.type !== 'fold' || e.seat === HERO || e.street > 0) lines.at(-1).acts.push(`<span class="${e.seat === HERO ? 'text-ink-100' : 'text-amber-200/90'}">${esc(who)} ${a}</span>`);
  }
  if (!lines.length) return `<div class="text-sm text-ink-400">Blinds 0.5/1. ${t.arrivals.join(' ')}</div>`;
  return `<div class="space-y-1 text-sm">${t.arrivals.length ? `<div class="text-xs text-ink-400">${esc(t.arrivals.join(' '))}</div>` : ''}${lines.map(l => `<div class="flex gap-2 flex-wrap items-baseline">
    <span class="text-ink-400 w-14 shrink-0">${l.head}</span>${l.cards.length ? `<span class="mr-1">${handText(l.cards.map(cardStr))}</span>` : ''}
    <span class="text-ink-300">${l.acts.join(', ') || '<span class="text-ink-500">everyone else folds</span>'}</span></div>`).join('')}</div>`;
}

function sessionPanel() {
  const sum = summary(t);
  const tone = (x) => (x > 0 ? 'text-emerald-300' : x < 0 ? 'text-rose-300' : '');
  const st = t.stats;
  const read = st.hands >= 15
    ? (st.vpip / st.hands < 0.18 ? 'They see you as tight: expect more steals of your blinds.' : st.pfr / st.hands > 0.28 ? 'They see you as aggressive: they will call your raises lighter.' : 'They see you as a solid player.')
    : 'They are still sizing you up.';
  const learners = t.players.filter(Boolean).map(p => adjustment(p, st)).reduce((a, b) => Math.max(a, b), 0);
  return `<div class="panel panel-pad space-y-3">
    <div class="grid grid-cols-3 gap-2">
      ${stat('Hands', sum.hands)}
      ${stat('Result', `<span class="${tone(sum.net)}">${fmtBB(sum.net, { sign: true })}</span>`)}
      ${stat('EV lost', sum.hands ? `−${sum.evLost.toFixed(1)}` : '0', `${pct(sum.accuracy)} good`)}
    </div>
    <div class="text-xs text-ink-300">You: VPIP <b class="text-white">${pct(sum.vpip)}</b> · PFR <b class="text-white">${pct(sum.pfr)}</b>. ${read}${learners > 0.05 ? ` The sharpest player has adjusted ${pct(learners)} to you.` : ''}</div>
    ${disc('Who is at the table', `<div class="space-y-1.5">${t.players.map((p, i) => (p ? `<div class="flex justify-between gap-2 text-sm"><span class="text-white">${esc(p.name)}</span>
      <span class="text-ink-300 text-right">${ui.reveal ? `${styleLabel(p)} <span class="text-ink-500">·</span> ` : ''}VPIP/PFR ${hudLine(p)}</span></div>` : '')).join('')}
      <button id="reveal" class="btn btn-quiet !px-0 text-sm">${ui.reveal ? 'Hide styles' : 'Reveal their styles'}</button></div>`)}
  </div>`;
}

function recapHtml(h) {
  const s = t.s;
  const won = h.net > 0, lost = h.net < 0;
  let line;
  if (h.showdown) {
    const shown = s.holes.map((x, i) => i).filter(i => !s.folded[i]);
    line = shown.map(i => `${i === HERO ? 'You' : esc(t.players[i].name)}: ${handText(byRank(s.holes[i]).map(cardStr))} ${CAT[category(evaluate([...s.holes[i], ...s.runout]))]}`).join(' · ');
  } else line = s.folded[HERO] ? 'You folded.' : 'Everyone folded to you.';
  const quality = h.evLost > 0.005 ? `<span class="text-rose-300">Your decisions cost ${fmtBB(h.evLost)} of EV.</span>` : (h.decisions.length ? '<span class="text-emerald-300">No EV lost.</span>' : '');
  return `<div class="space-y-3 fade-up">
    <div class="verdict ${won ? 'v-best' : lost ? 'v-mistake' : 'v-fine'}">
      <div class="text-lg font-semibold ${won ? 'text-emerald-300' : lost ? 'text-rose-300' : 'text-sky-300'}">${won ? `You won ${fmtBB(h.net)}` : lost ? `You lost ${fmtBB(-h.net)}` : 'No chips changed hands for you'}</div>
      <div class="text-sm text-ink-200 mt-1">${line}</div>
      <div class="text-sm mt-1">${quality}</div>
    </div>
    ${t.coachMode !== 'off' && h.decisions.length ? `<div class="space-y-2">${h.decisions.map((d, i) => decisionRow(d, i, { evNote: evNote(d) })).join('')}</div>` : ''}
  </div>`;
}

const evNote = (d) => `EV in bb against every opponent still in the hand (their ranges and strategies)${d.opponents > 1 ? '; multiway: Monte Carlo, one street ahead' : ''}.`;

function draw(container) {
  clearTimeout(timer);
  timer = null;
  const s = t.s;
  const heroTurn = heroToAct(t) && !ui.paused;
  const botTurn = !s.done && !heroToAct(t) && !ui.paused;
  let controls;
  if (ui.recap) {
    controls = `<div class="grid grid-cols-3 gap-2"><button id="end" class="btn btn-lg">Leave table</button>
      <button id="next" class="btn btn-primary btn-lg col-span-2">Next hand ${icon('next', 'w-5 h-5')}</button></div>`;
  } else if (ui.paused) {
    controls = `<button id="continue" class="btn btn-primary btn-lg btn-block">Continue ${icon('next', 'w-5 h-5')}</button>`;
  } else {
    const k = heroTurn ? coachReady(t) : null;
    controls = k ? actionBar(k.options)
      : `<div class="h-[60px] flex items-center justify-center text-sm text-ink-400">${heroTurn ? 'Reading the table…' : s.folded[HERO] ? 'You folded. Watching the hand…' : `${esc(t.players[s.toAct]?.name ?? '')} to act`}</div>`;
  }
  let coach;
  if (ui.recap) coach = recapHtml(ui.recap);
  else if (t.coachMode === 'decision' && ui.last) coach = coachCard(ui.last, { evNote: evNote(ui.last) });
  else coach = `<div class="text-sm text-ink-400">${t.coachMode === 'decision' ? 'Make your decision. The coach grades it against every player still in the hand.' : t.coachMode === 'hand' ? 'The coach speaks at the end of the hand.' : 'Coach off.'}</div>`;
  const openState = [...container.querySelectorAll('#coach details, #side details')].map(d => d.open);
  container.innerHTML = `<div class="page">
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <div class="text-sm text-ink-300"><b class="text-white">Hand ${t.handNo}</b> · ${LEVELS[t.level].name} · ${t.n}-handed${t.stacks === 'mixed' ? ' · live stacks' : t.stacks === 'deep' ? ' · 200bb' : ''} · you are <b class="text-white">${posOf(s, HERO)}</b></div>
      ${playTabs('table')}
    </div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 lg:grid-flow-dense items-start">
      <div class="space-y-4 min-w-0">
        ${tableHtml(botTurn)}
        <div id="controls">${controls}</div>
      </div>
      <div id="side" class="space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2">
        <div class="panel panel-pad" id="coach">${coach}</div>
        ${sessionPanel()}
      </div>
      <div class="panel panel-pad min-w-0">${historyHtml()}</div>
    </div>
  </div>`;
  container.querySelectorAll('#coach details, #side details').forEach((d, i) => { if (openState[i]) d.open = true; });
  container.querySelectorAll('#controls [data-i]').forEach(b => b.addEventListener('click', () => choose(container, Number(b.dataset.i))));
  container.querySelector('#continue')?.addEventListener('click', () => { ui.paused = false; draw(container); });
  container.querySelector('#next')?.addEventListener('click', () => { ui.recap = null; ui.last = null; startHand(t); draw(container); });
  container.querySelector('#end')?.addEventListener('click', () => { ui.over = true; review(container); });
  container.querySelector('#reveal')?.addEventListener('click', () => { ui.reveal = !ui.reveal; draw(container); });

  if (botTurn) {
    const folded = s.folded[HERO];
    timer = setTimeout(() => {
      timer = null;
      if (!container.isConnected || !t) return;
      botAct(t);
      after(container);
    }, folded ? 260 : 520);
  } else if (heroTurn && !coachReady(t)) {
    timer = setTimeout(() => { timer = null; if (!container.isConnected || !t) return; coachNow(t); draw(container); }, 16);
  }
}

function after(container) {
  if (t.s.done) { ui.recap = endHand(t); ui.paused = false; addHand(packTable(t, ui.recap, styleLabel)); }
  draw(container);
}

function choose(container, i) {
  if (!heroToAct(t) || ui.paused || !coachReady(t)) return;
  const d = heroAct(t, i);
  ui.last = d;
  if (t.coachMode === 'decision' && (d.verdict === 'mistake' || d.verdict === 'blunder') && !t.s.done) ui.paused = true;
  after(container);
}

function review(container) {
  clearTimeout(timer);
  const sum = summary(t);
  const all = t.hands.flatMap(h => h.decisions.map(d => ({ ...d, hand: h.no })));
  const worst = all.filter(d => d.loss > 0.01).sort((a, b) => b.loss - a.loss).slice(0, 8);
  const tone = (x) => (x > 0 ? 'text-emerald-300' : x < 0 ? 'text-rose-300' : '');
  container.innerHTML = `<div class="page space-y-5 fade-up">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div><div class="h-sec">Session review</div><h1 class="h-title">Live table: ${LEVELS[t.level].name}, ${t.n}-handed</h1></div>
      <div class="flex gap-2 flex-wrap"><a class="btn" href="#play/review/s/${t.startedAt}">${icon('review', 'w-4 h-4')} Game review</a><button class="btn" id="rv-again">Same table</button><button class="btn btn-primary" id="rv-new">New table</button></div>
    </div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      ${stat('Decisions', pct(sum.accuracy), `${sum.blunders} blunders · ${sum.mistakes} mistakes`)}
      ${stat('EV lost', `−${sum.evLost.toFixed(1)}bb`, `${sum.lossPer100}bb/100`, 'text-rose-200')}
      ${stat('Result', `<span class="${tone(sum.net)}">${fmtBB(sum.net, { sign: true })}</span>`, `${sum.hands} hands · ${sum.bbPer100}bb/100`)}
      ${stat('Your style', `${pct(sum.vpip)} / ${pct(sum.pfr)}`, 'VPIP / PFR (live winners: ~20 / 15)')}
    </div>
    <div class="panel panel-pad space-y-2"><div class="h-sec">The table</div>
      ${t.players.map((p, i) => (p ? `<div class="flex justify-between text-sm"><span class="text-white">${esc(p.name)}</span><span class="text-ink-300">${styleLabel(p)} · VPIP/PFR ${hudLine(p)}</span></div>` : '')).join('')}
    </div>
    <div class="space-y-2"><div class="h-sec">Biggest mistakes</div>
      ${worst.length ? worst.map(d => disc(`<span class="flex-1 flex items-center gap-2 min-w-0"><span class="text-ink-400 text-xs w-14">Hand ${d.hand}</span>
        <span class="truncate">${handText(byRank(d.hole).map(cardStr))} ${d.board.length ? 'on ' + handText(d.board.map(cardStr)) : ''}</span>
        <span class="ml-auto text-rose-300 text-xs font-semibold pr-2">${d.preflop ? 'off chart · ' : ''}−${d.loss.toFixed(2)}bb</span></span>`, coachCard(d, { evNote: evNote(d) }))).join('') : '<p class="text-sm text-ink-400">None. Clean session.</p>'}
    </div>
  </div>`;
  container.querySelector('#rv-again').addEventListener('click', () => { ui = { ...ui, over: false, recap: null, last: null }; t.hands = []; startHand(t); draw(container); });
  container.querySelector('#rv-new').addEventListener('click', () => { t = null; ui.over = false; setup(container); });
}

export { ARCHETYPES, legal, verdict };
