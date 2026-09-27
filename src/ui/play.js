/**
 * Play: hands against a rated bot, with the coach when you want it.
 *   coach "decision": verdict after every decision (pauses on mistakes)
 *   coach "hand":     silent during the hand, recap at the end of each hand
 *   coach "off":      a straight session, everything in the review
 */
import {
  createSession, startHand, heroToAct, coachNow, coachReady, heroAct, botAct, endHand, sessionOver, summary,
} from '../engine/hu/session.js';
import { AGENTS, AGENT_IDS, eloOf, levelOf } from '../engine/hu/agents.js';
import { settings, saveSettings, loadRaw, save, KEYS } from '../store.js';
import { seg, wireSeg, icon, disc, fmtBB, esc } from './kit.js';
import {
  liveTable, actionBar, historyHtml, coachCard, sessionPanel, handRecap, reviewHtml, rangeViewHtml,
} from './play/views.js';
import { villainRange } from '../engine/hu/range.js';
import { rangeView } from '../engine/hu/coach.js';

let sess = null;
let ui = { last: null, lastWeights: null, paused: false, recap: null, over: false };
let timer = null;
let keyHandler = null;

const BOT_DELAY = 650;

export function render(container, params = []) {
  if (params[0] === 'new') { sess = null; }
  const cleanup = () => {
    clearTimeout(timer);
    timer = null;
    if (keyHandler) window.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  };
  if (!sess) setup(container);
  else if (ui.over) review(container);
  else table(container);
  keyHandler = (e) => onKey(container, e);
  window.addEventListener('keydown', keyHandler);
  return cleanup;
}

// ------------------------------------------------------------------ player rating store

export function playStore() {
  return loadRaw(KEYS.play, { sessions: [] });
}

/** Play rating: hands-weighted average of recent session performances (last ~1000 hands). */
export function playRating(store = playStore()) {
  let hands = 0, sum = 0;
  for (const p of [...store.sessions].reverse()) {
    if (p.rating == null || p.hands < 5) continue;
    sum += p.rating * p.hands;
    hands += p.hands;
    if (hands >= 1000) break;
  }
  return hands ? { rating: Math.round(sum / hands), hands } : null;
}

function recordSession() {
  const sum = summary(sess);
  if (!sum.hands) return;
  const store = playStore();
  store.sessions.push({ at: sess.startedAt, bot: sess.botId, hands: sum.hands, net: sum.net, evLost: sum.evLost, rating: sum.rating });
  store.sessions = store.sessions.slice(-200);
  store.models = { ...(store.models || {}), [sess.botId]: sess.agent.model }; // every bot remembers you
  save(KEYS.play, store);
  window.dispatchEvent(new Event('livegto:ratings'));
}

// ------------------------------------------------------------------ setup

function setup(container) {
  const st = settings();
  const mine = playRating();
  const bots = [...AGENT_IDS].sort((a, b) => eloOf(a) - eloOf(b));
  const known = playStore().models || {};
  container.innerHTML = `<div class="page space-y-6 fade-up">
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div><div class="h-sec">Play</div><h1 class="h-title">Choose your opponent</h1>
        <p class="muted mt-1 text-sm">Heads-up, 100bb, button vs big blind. Every decision is graded against the bot's real range.</p></div>
      <div class="stat min-w-[150px]"><div class="k">Your Play rating</div><div class="v text-amber-200">${mine ? mine.rating : '—'}</div>
        <div class="s">${mine ? `${mine.hands} rated hands` : 'play a session to get rated'}</div></div>
    </div>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      ${bots.map(id => {
        const a = AGENTS[id];
        const on = id === st.bot;
        return `<button data-bot="${id}" class="text-left panel panel-pad transition hover:border-ink-500 ${on ? 'ring-2 ring-emerald-400/80 border-emerald-500/40' : ''}">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2"><span class="text-lg font-semibold text-white">${a.name}</span>
              ${a.kind === 'thinker' ? '<span class="tag text-violet-200 border-violet-500/40 bg-violet-500/10">thinks</span>' : ''}</div>
            <span class="pill">${eloOf(id)}</span>
          </div>
          <div class="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-400 mt-1">${levelOf(eloOf(id))}</div>
          <p class="text-sm text-ink-300 mt-2 leading-snug">${a.blurb}</p>
          ${known[id]?.hands ? `<div class="text-xs text-amber-200/80 mt-2">Has seen you play ${known[id].hands} hands</div>` : ''}
        </button>`;
      }).join('')}
    </div>
    <div class="panel panel-pad grid md:grid-cols-2 gap-5">
      <div class="space-y-2"><div class="h-sec">Coach</div>
        ${seg('coach', [{ v: 'decision', label: 'Every decision' }, { v: 'hand', label: 'After each hand' }, { v: 'off', label: 'Session review only' }], st.coach)}
        <p class="text-xs text-ink-400">${{ decision: 'See the verdict after each decision. The hand pauses when you make a mistake.', hand: 'Play the hand uninterrupted, then see how each decision rated.', off: 'Play a clean session, like a real game. The review comes at the end.' }[st.coach]}</p>
      </div>
      <div class="space-y-2"><div class="h-sec">Session</div>
        ${seg('length', [{ v: 0, label: 'Endless' }, { v: 25, label: '25 hands' }, { v: 50, label: '50' }, { v: 100, label: '100' }], st.length)}
        <p class="text-xs text-ink-400">Your rating comes from the EV you give up per 100 hands, not from the cards. Luck is shown separately.</p>
      </div>
    </div>
    <button id="start" class="btn btn-primary btn-lg btn-block">${icon('play', 'w-5 h-5')} Play ${AGENTS[st.bot].name}</button>
  </div>`;
  container.querySelectorAll('[data-bot]').forEach(b => b.addEventListener('click', () => {
    saveSettings({ ...settings(), bot: b.dataset.bot });
    setup(container);
  }));
  wireSeg(container, (name, v) => {
    saveSettings({ ...settings(), [name]: name === 'length' ? Number(v) : v });
    setup(container);
  });
  container.querySelector('#start').addEventListener('click', () => start(container));
}

function start(container) {
  const st = settings();
  const memory = playStore().models?.[st.bot] ?? null; // adaptive bots remember how you play
  sess = createSession({ botId: st.bot, length: st.length, coachMode: st.coach, model: memory });
  ui = { last: null, lastWeights: null, paused: false, recap: null, over: false };
  startHand(sess);
  table(container);
}

// ------------------------------------------------------------------ table

function table(container) {
  clearTimeout(timer);
  timer = null;
  const s = sess.s;
  const heroTurn = heroToAct(sess) && !ui.paused;
  const botTurn = !s.done && !heroToAct(sess) && !ui.paused;
  const sum = summary(sess);
  const mode = sess.coachMode;

  // controls under the table
  let controls;
  if (ui.recap) {
    const over = sessionOver(sess);
    controls = `<div class="grid grid-cols-3 gap-2">
      <button id="end" class="btn btn-lg">End session</button>
      <button id="next" class="btn btn-primary btn-lg col-span-2">${over ? 'See the review' : 'Next hand'} ${icon('next', 'w-5 h-5')}</button></div>`;
  } else if (ui.paused) {
    controls = `<button id="continue" class="btn btn-primary btn-lg btn-block">Continue ${icon('next', 'w-5 h-5')}</button>`;
  } else {
    const opts = heroTurn ? (coachReady(sess)?.options ?? null) : null;
    controls = heroTurn && opts ? actionBar(opts)
      : heroTurn ? `<div class="h-[60px] flex items-center justify-center text-sm text-ink-400">Reading his range…</div>`
        : `<div class="h-[60px] flex items-center justify-center text-sm text-ink-400">${AGENTS[sess.botId].name} to act</div>`;
  }

  // coach column
  let coachHtml = '';
  if (ui.recap) {
    coachHtml = handRecap(sess, ui.recap, { showDecisions: mode !== 'off' });
  } else if (mode === 'decision' && ui.last) {
    coachHtml = coachCard(ui.last, { weights: ui.lastWeights, botName: AGENTS[sess.botId].name, live: !!ui.lastState && !ui.last.preflop && ui.last.street > 0 });
  } else if (mode !== 'decision') {
    coachHtml = `<div class="text-sm text-ink-400">${mode === 'hand' ? 'The coach speaks at the end of the hand.' : 'Coach off. Your review comes at the end of the session.'}</div>`;
  } else {
    coachHtml = `<div class="text-sm text-ink-400">Make your decision. The coach grades it against ${AGENTS[sess.botId].name}'s real range.</div>`;
  }

  // keep open panels open across re-renders (the bot acting re-draws the page)
  const openState = [...container.querySelectorAll('#coach details')].map(d => d.open);
  container.innerHTML = `<div class="page">
    <div class="flex items-center justify-between mb-3 gap-3">
      <div class="flex items-center gap-2 text-sm text-ink-300">
        <span class="font-semibold text-white">Hand ${sess.handNo}${sess.length ? ` / ${sess.length}` : ''}</span>
        <span>·</span><span>${sess.coachMode === 'decision' ? 'Coach on' : sess.coachMode === 'hand' ? 'Coach after hands' : 'Coach off'}</span>
      </div>
      <a href="#play/new" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Opponents</a>
    </div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 lg:grid-flow-dense items-start">
      <div class="space-y-4 min-w-0">
        ${liveTable(sess, { thinking: botTurn })}
        <div id="controls">${controls}</div>
      </div>
      <div class="space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2">
        <div class="panel panel-pad" id="coach">${coachHtml}</div>
        ${sessionPanel(sess, sum)}
      </div>
      <div class="panel panel-pad min-w-0">${historyHtml(s, sess.hero)}</div>
    </div>
  </div>`;

  container.querySelectorAll('#coach details').forEach((d, i) => { if (openState[i]) d.open = true; });
  const rvEl = container.querySelector('details[data-rangeview]');
  if (rvEl && ui.rangeHtml) { rvEl.dataset.done = '1'; rvEl.querySelector('.body').innerHTML = ui.rangeHtml; }
  wire(container);

  if (botTurn) {
    timer = setTimeout(() => {
      timer = null;
      if (!container.isConnected || !sess) return;
      botAct(sess);
      afterAction(container);
    }, BOT_DELAY);
  } else if (heroTurn && !coachReady(sess)) {
    // compute the coach (and the options) off the paint
    timer = setTimeout(() => {
      timer = null;
      if (!container.isConnected || !sess) return;
      coachNow(sess);
      table(container);
    }, 16);
  }
}

function afterAction(container) {
  if (sess.s.done) {
    ui.recap = endHand(sess);
    ui.paused = false;
  }
  table(container);
}

function wire(container) {
  container.querySelectorAll('#controls [data-i]').forEach(b => b.addEventListener('click', () => choose(container, Number(b.dataset.i))));
  container.querySelector('#continue')?.addEventListener('click', () => { ui.paused = false; table(container); });
  const rv = container.querySelector('details[data-rangeview]');
  rv?.addEventListener('toggle', () => {
    if (!rv.open || rv.dataset.done) return;
    rv.dataset.done = '1';
    setTimeout(() => {
      const v = rangeView(ui.lastState, sess.hero, sess.agent);
      if (v) v.read = sess.agent.kind === 'thinker';
      ui.rangeHtml = rangeViewHtml(v, ui.lastState.holes[sess.hero]);
      rv.querySelector('.body').innerHTML = ui.rangeHtml;
    }, 10);
  });
  container.querySelector('#next')?.addEventListener('click', () => nextHand(container));
  container.querySelector('#end')?.addEventListener('click', () => { ui.over = true; recordSession(); review(container); });
}

function choose(container, i) {
  if (!heroToAct(sess) || ui.paused || !coachReady(sess)) return;
  const s0 = sess.s;
  ui.lastState = s0;
  ui.rangeHtml = null;
  const d = heroAct(sess, i);
  ui.last = d;
  ui.lastWeights = !d.preflop && sess.coachMode === 'decision' ? villainRange(s0, 1 - sess.hero, sess.agent) : null;
  const bad = d.verdict === 'mistake' || d.verdict === 'blunder';
  if (sess.coachMode === 'decision' && bad && !sess.s.done) ui.paused = true;
  afterAction(container);
}

function nextHand(container) {
  if (sessionOver(sess)) {
    ui.over = true;
    recordSession();
    review(container);
    return;
  }
  ui.recap = null;
  ui.last = null;
  ui.lastWeights = null;
  ui.lastState = null;
  startHand(sess);
  table(container);
}

function onKey(container, e) {
  if (!sess || ui.over || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Enter' || e.key === ' ') {
    const b = container.querySelector('#continue, #next');
    if (b) { e.preventDefault(); b.click(); }
    return;
  }
  const n = Number(e.key);
  if (n >= 1 && n <= 9) container.querySelector(`#controls [data-i="${n - 1}"]`)?.click();
}

// ------------------------------------------------------------------ review

function review(container) {
  clearTimeout(timer);
  const sum = summary(sess);
  const past = playStore().sessions.slice(-8).reverse();
  container.innerHTML = `<div class="page">${reviewHtml(sess, sum, past)}</div>`;
  container.querySelector('#rv-again')?.addEventListener('click', () => start(container));
  container.querySelector('#rv-new')?.addEventListener('click', () => { sess = null; setup(container); });
}

export { esc, fmtBB, disc };
