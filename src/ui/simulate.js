/**
 * Simulate — a session against one bot, no interruptions, then a review: bb/100, your decisions
 * graded against this bot, your biggest mistakes, and an estimated rating.
 */
import { newHand, act, menu, board, BTN, BB } from '../engine/hu/game.js';
import { chooseAction, BOT_TYPES } from '../engine/hu/bots.js';
import { coach } from '../engine/hu/coach.js';
import { cardStr, handType } from '../engine/hu/hand.js';
import { table, history, botBadge, botSelect, gradeChoice, handName, POS } from './hu/view.js';

const STORE = 'livegto.sessions.v1';
const L0 = 5; // rating scale: bb/100 lost vs best play at which you're 400 points below 2200

let st = fresh('station', 50);

function fresh(botId, length) {
  return { botId, length, hero: BB, s: null, timer: null, hands: [], decisions: [], reviewing: false, net: 0 };
}

export function render(container) {
  clearTimeout(st.timer);
  st.timer = null;
  if (!st.s) deal();
  draw(container);
}

function deal() {
  st.hero = 1 - st.hero;
  st.s = newHand();
}

/** Estimated rating from bb/100 lost against the coach's best play. See docs/DESIGN.md §5. */
export function ratingFrom(lossPer100) {
  return Math.round(Math.max(100, Math.min(2200, 2200 - 400 * Math.log2(1 + Math.max(0, lossPer100) / L0))));
}

function botTurn(container) {
  if (st.timer || st.reviewing || st.s.done || st.s.toAct === st.hero) return;
  st.timer = setTimeout(() => {
    st.timer = null;
    if (!container.isConnected) return;
    st.s = act(st.s, chooseAction(st.botId, st.s));
    if (st.s.done) finish();
    draw(container);
  }, 300);
}

function finish() {
  const n = st.s.result.net[st.hero];
  st.net += n;
  st.hands.push({ net: n, hero: st.hero, holes: st.s.holes, runout: st.s.runout, showdown: st.s.result.showdown });
}

function heroAct(container, idx) {
  const s = st.s;
  const m = menu(s)[idx];
  // grade silently (the coach looks at the same menu, in the same order)
  const k = coach(s, st.hero, st.botId);
  const g = gradeChoice(k, idx);
  st.decisions.push({
    hand: st.hands.length + 1,
    street: s.street,
    cards: s.holes[st.hero].map(cardStr).join(''),
    type: handType(s.holes[st.hero]),
    board: board(s).map(cardStr).join(''),
    pos: POS[st.hero],
    chosen: m.label,
    best: k.options[k.best].label,
    verdict: g.verdict,
    loss: g.loss,
    equity: k.equity ?? null,
    need: k.need ?? null,
    notes: k.notes ?? null,
  });
  st.s = act(s, m);
  if (st.s.done) finish();
  draw(container);
}

function summary() {
  const n = st.hands.length;
  const post = st.decisions.filter(d => d.street > 0);
  const pre = st.decisions.filter(d => d.street === 0);
  const lost = post.reduce((a, d) => a + (d.loss || 0), 0);
  const lossPer100 = n ? (100 * lost) / n : 0;
  return {
    n,
    net: st.net,
    bb100: n ? (100 * st.net) / n : 0,
    postAcc: post.length ? post.filter(d => d.verdict !== 'mistake').length / post.length : 0,
    preAcc: pre.length ? pre.filter(d => d.verdict !== 'mistake').length / pre.length : 0,
    lossPer100,
    rating: ratingFrom(lossPer100),
    worst: [...post].filter(d => d.verdict === 'mistake').sort((a, b) => b.loss - a.loss).slice(0, 5),
    preMistakes: pre.filter(d => d.verdict === 'mistake').slice(0, 5),
  };
}

function saveSession(sm) {
  try {
    const all = JSON.parse(localStorage.getItem(STORE) || '[]');
    all.push({ at: Date.now(), bot: st.botId, hands: sm.n, net: +sm.net.toFixed(1), rating: sm.rating });
    localStorage.setItem(STORE, JSON.stringify(all.slice(-50)));
  } catch { /* storage unavailable */ }
}

function pastSessions() {
  try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; }
}

function review() {
  const sm = summary();
  const fmt = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
  const row = (d) => `<div class="border-b border-gray-800 py-1.5 text-sm">
      <div class="flex justify-between"><span class="font-mono text-gray-200">Hand ${d.hand} · ${d.pos} · ${d.cards}${d.board ? ` on ${d.board}` : ''}</span>
      <span class="text-red-300">${d.loss != null ? `−${d.loss.toFixed(2)}bb` : ''}</span></div>
      <div class="text-xs text-gray-400">You: ${d.chosen} · best: <span class="text-emerald-300">${d.best}</span>${d.equity != null ? ` · equity ${Math.round(100 * d.equity)}%` : ''}${d.need != null ? `, needed ${Math.round(100 * d.need)}%` : ''}${d.notes ? ` · ${d.notes.join(' ')}` : ''}</div></div>`;
  const past = pastSessions().slice(-5).reverse().map(p => `<div class="flex justify-between text-xs text-gray-400"><span>${new Date(p.at).toLocaleDateString()} vs ${BOT_TYPES[p.bot]?.name || p.bot}</span><span>${p.hands} hands · ${fmt(p.net)}bb · ${p.rating}</span></div>`).join('');
  return `
  <div class="space-y-4 flash-in">
    <h2 class="text-xl font-bold text-emerald-400">Session review vs ${BOT_TYPES[st.botId].name}</h2>
    <div class="grid grid-cols-3 gap-2 text-center">
      <div class="rounded-lg bg-gray-900 p-2"><div class="text-xs text-gray-500">Result</div><div class="font-mono ${sm.net >= 0 ? 'text-emerald-300' : 'text-red-300'}">${fmt(sm.net)}bb</div><div class="text-[0.65rem] text-gray-500">${sm.n} hands · ${fmt(sm.bb100)} bb/100</div></div>
      <div class="rounded-lg bg-gray-900 p-2"><div class="text-xs text-gray-500">Decisions</div><div class="font-mono text-gray-200">${Math.round(100 * sm.postAcc)}%</div><div class="text-[0.65rem] text-gray-500">postflop good · preflop ${Math.round(100 * sm.preAcc)}%</div></div>
      <div class="rounded-lg bg-gray-900 p-2"><div class="text-xs text-gray-500">Played like</div><div class="font-mono text-amber-300 text-lg">${sm.rating}</div><div class="text-[0.65rem] text-gray-500">~${sm.lossPer100.toFixed(1)} bb/100 given up</div></div>
    </div>
    <p class="text-xs text-gray-500">Results swing a lot over a few dozen hands. The decision grades and the rating are what to watch: they measure how much EV you gave up against this bot (estimated one street ahead; exact on the river), not whether the cards ran well.</p>
    <div><h3 class="text-sm font-semibold text-gray-200 mb-1">Biggest postflop mistakes</h3>${sm.worst.length ? sm.worst.map(row).join('') : '<p class="text-sm text-gray-500">None. Nice.</p>'}</div>
    ${sm.preMistakes.length ? `<div><h3 class="text-sm font-semibold text-gray-200 mb-1">Preflop, off the chart</h3>${sm.preMistakes.map(row).join('')}</div>` : ''}
    ${past ? `<div><h3 class="text-sm font-semibold text-gray-200 mb-1">Recent sessions</h3>${past}</div>` : ''}
    <button id="again" class="w-full py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-semibold">New session</button>
  </div>`;
}

function draw(container) {
  if (st.reviewing) {
    container.innerHTML = review();
    container.querySelector('#again').addEventListener('click', () => {
      st = fresh(st.botId, st.length);
      deal();
      draw(container);
    });
    return;
  }
  const s = st.s;
  const heroTurn = !s.done && s.toAct === st.hero;
  const played = st.hands.length;
  let body = '';
  if (heroTurn) {
    body = `<div class="grid grid-cols-2 gap-2">${menu(s).map((m, i) =>
      `<button data-i="${i}" class="py-3 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 font-semibold text-sm">${m.label}</button>`).join('')}</div>`;
  } else if (s.done) {
    const n = s.result.net[st.hero];
    const reveal = s.result.showdown ? ` · you: ${handName(s.holes[st.hero], s.runout)}, him: ${handName(s.holes[1 - st.hero], s.runout)}` : '';
    const last = played >= st.length;
    body = `<div class="text-sm ${n >= 0 ? 'text-emerald-300' : 'text-red-300'}">${n >= 0 ? 'Won' : 'Lost'} ${Math.abs(n).toFixed(1)}bb${reveal}</div>
      <button id="next" class="w-full py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-semibold">${last ? 'See the review' : 'Next hand'}</button>`;
  } else {
    body = `<p class="text-center text-gray-500 text-sm">${POS[s.toAct]} is thinking…</p>`;
  }
  container.innerHTML = `
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div><h1 class="text-2xl font-bold text-amber-400">Simulate</h1>
        <div class="text-xs text-gray-500">A session, then a review</div></div>
      <div class="text-right text-xs text-gray-400 space-y-1">${botSelect(st.botId)}
        <select id="len" class="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm">
          ${[25, 50, 100, 200].map(n => `<option value="${n}" ${n === st.length ? 'selected' : ''}>${n} hands</option>`).join('')}
        </select>
        <div>Hand ${Math.min(played + (s.done ? 0 : 1), st.length)}/${st.length} · ${st.net >= 0 ? '+' : ''}${st.net.toFixed(1)}bb</div></div>
    </div>
    ${botBadge(st.botId)}
    ${table(s, st.hero, st.botId, { reveal: s.done && s.result.showdown })}
    <div class="text-center text-sm text-gray-300">You are <b>${POS[st.hero]}</b>. 100bb each hand; blinds 0.5/1, SB folded.</div>
    ${history(s, st.hero)}
    <div class="space-y-3">${body}</div>
    <button id="end" class="w-full py-2 rounded-lg bg-gray-800 text-gray-300 text-sm">End session and review</button>
  </div>`;

  const restart = (botId, length) => {
    clearTimeout(st.timer);
    st = fresh(botId, length);
    deal();
    draw(container);
  };
  container.querySelector('#bot').addEventListener('change', (e) => restart(e.target.value, st.length));
  container.querySelector('#len').addEventListener('change', (e) => restart(st.botId, Number(e.target.value)));
  container.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => heroAct(container, Number(b.dataset.i))));
  container.querySelector('#next')?.addEventListener('click', () => {
    if (st.hands.length >= st.length) {
      st.reviewing = true;
      saveSession(summary());
    } else deal();
    draw(container);
  });
  container.querySelector('#end').addEventListener('click', () => {
    clearTimeout(st.timer);
    st.timer = null;
    st.reviewing = true;
    if (st.hands.length) saveSession(summary());
    draw(container);
  });
  botTurn(container);
}
