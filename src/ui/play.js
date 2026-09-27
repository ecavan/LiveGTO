/**
 * Play — coached hands against a bot. After every decision the coach shows what each option was
 * worth against this bot's actual range, then the hand continues.
 */
import { newHand, act, menu, BTN, BB } from '../engine/hu/game.js';
import { chooseAction } from '../engine/hu/bots.js';
import { coach } from '../engine/hu/coach.js';
import { table, history, botBadge, botSelect, coachPanel, handName, gradeChoice, POS } from './hu/view.js';

let st = {
  botId: 'station',
  hero: BB,
  s: null,
  timer: null,
  pending: null, // { k, idx, action } waiting for "Continue"
  net: 0,
  hands: 0,
  decisions: 0,
  good: 0,
};

export function render(container) {
  clearTimeout(st.timer); // a timer from a previous visit points at an old container
  st.timer = null;
  if (!st.s) deal();
  draw(container);
}

function deal() {
  st.hero = 1 - st.hero; // alternate BTN / BB
  st.s = newHand();
  st.pending = null;
}

/** Schedule the bot's move (once) if it is his turn. */
function botTurn(container) {
  if (st.timer || st.s.done || st.s.toAct === st.hero || st.pending) return;
  st.timer = setTimeout(() => {
    st.timer = null;
    if (!container.isConnected) return; // user left the page
    st.s = act(st.s, chooseAction(st.botId, st.s));
    if (st.s.done) finish();
    draw(container);
  }, 450);
}

function finish() {
  st.hands++;
  st.net += st.s.result.net[st.hero];
}

function draw(container) {
  const s = st.s;
  const heroTurn = !s.done && s.toAct === st.hero && !st.pending;
  let body = '';
  if (st.pending) {
    body = coachPanel(st.pending.k, st.pending.idx, st.botId)
      + `<button id="continue" class="w-full py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-semibold">Continue</button>`;
  } else if (heroTurn) {
    body = `<div class="grid grid-cols-2 gap-2">${menu(s).map((m, i) =>
      `<button data-i="${i}" class="py-3 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 font-semibold text-sm">${m.label}</button>`).join('')}</div>`;
  } else if (s.done) {
    const r = s.result;
    const n = r.net[st.hero];
    const reveal = r.showdown
      ? `<div class="text-sm text-gray-400">You: ${handName(s.holes[st.hero], s.runout)} · ${POS[1 - st.hero]}: ${handName(s.holes[1 - st.hero], s.runout)}</div>`
      : `<div class="text-sm text-gray-400">${s.folded === st.hero ? 'You folded.' : 'He folded.'}</div>`;
    body = `<div class="rounded-lg border ${n >= 0 ? 'border-emerald-700/50 bg-emerald-900/20' : 'border-red-700/50 bg-red-900/20'} px-3 py-2">
      <div class="font-semibold ${n >= 0 ? 'text-emerald-300' : 'text-red-300'}">${n >= 0 ? 'You won' : 'You lost'} ${Math.abs(n).toFixed(1)}bb</div>${reveal}</div>
      <button id="next" class="w-full py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 font-semibold">Next hand</button>`;
  } else {
    body = `<p class="text-center text-gray-500 text-sm">${POS[s.toAct]} is thinking…</p>`;
  }
  const acc = st.decisions ? Math.round((100 * st.good) / st.decisions) : 0;
  container.innerHTML = `
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div><h1 class="text-2xl font-bold text-emerald-400">Play</h1>
        <div class="text-xs text-gray-500">Coached hands · feedback after every decision</div></div>
      <div class="text-right text-xs text-gray-400">${botSelect(st.botId)}
        <div class="mt-1">${st.hands} hands · ${st.net >= 0 ? '+' : ''}${st.net.toFixed(1)}bb · ${acc}% good decisions</div></div>
    </div>
    ${botBadge(st.botId)}
    ${table(s, st.hero, st.botId, { reveal: s.done && s.result.showdown })}
    <div class="text-center text-sm text-gray-300">You are <b>${POS[st.hero]}</b>${st.hero === BTN ? ' (in position after the flop)' : ' (out of position)'}. Blinds 0.5/1, SB folded (0.5 dead).</div>
    ${history(s, st.hero)}
    <div id="body" class="space-y-3">${body}</div>
  </div>`;

  container.querySelector('#bot').addEventListener('change', (e) => {
    clearTimeout(st.timer);
    st = { ...st, botId: e.target.value, net: 0, hands: 0, decisions: 0, good: 0, timer: null };
    deal();
    draw(container);
  });
  container.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => {
    const idx = Number(b.dataset.i);
    const m = menu(st.s);
    const k = coach(st.s, st.hero, st.botId);
    // coach options are the same menu, in the same order
    const g = gradeChoice(k, idx);
    st.decisions++;
    if (g.verdict !== 'mistake') st.good++;
    st.pending = { k, idx, action: m[idx] };
    draw(container);
  }));
  container.querySelector('#continue')?.addEventListener('click', () => {
    st.s = act(st.s, st.pending.action);
    st.pending = null;
    if (st.s.done) finish();
    draw(container);
  });
  container.querySelector('#next')?.addEventListener('click', () => {
    deal();
    draw(container);
  });
  botTurn(container);
}
