/**
 * Log a live hand: enter what happened at the casino (dollars, your seat and cards, the action and
 * the board as it came), tag the players who played, and the coach grades your decisions when the
 * hand is done. The hand goes into Review with everything else.
 */
import {
  createLog, logAction, foldToHero, stateOf, boardNeeded, gradeLog, toHistory, undo, HERO, N, VILLAIN_TYPES, STAKES,
  posOf, legal, positions,
} from '../../engine/livelog.js';
import { addHand, loadHands } from '../../engine/history.js';
import { settings, saveSettings } from '../../store.js';
import { ringTable, fmtBB, icon, esc, seg, wireSeg, handText, cardText, SUIT_SYM, sprOf } from '../kit.js';
import { decisionRow } from './views.js';

const RANKS = 'AKQJT98765432';
const SUITS = 'shdc';
const idOf = (r, s) => '23456789TJQKA'.indexOf(r) * 4 + 'cdhs'.indexOf(s);
const STREET = ['Preflop', 'Flop', 'Turn', 'River'];
const byRank = (h) => [...h].sort((a, b) => (b >> 2) - (a >> 2));

let lg = null; // { step, draft, L, pick, amount, graded, saved }

export function render(container) {
  if (!lg) reset();
  draw(container);
}

function reset() {
  const st = settings();
  lg = {
    step: 'setup',
    draft: { stakes: st.logStakes ?? '1/2', pos: st.logPos ?? 'CO', stack: st.logStack ?? 300, others: st.logOthers ?? 300, hole: [] },
    L: null, pick: [], amount: '', graded: null, saved: null, shown: null,
  };
}

// ------------------------------------------------------------------ pieces

function picker(selected, used, max) {
  return `<div class="space-y-1.5" id="picker">${SUITS.split('').map(su => `<div class="grid gap-1" style="grid-template-columns:repeat(13,minmax(0,1fr))">
    ${RANKS.split('').map(r => {
      const id = idOf(r, su);
      const on = selected.includes(id), off = used.has(id) && !on;
      return `<button data-card="${id}" ${off ? 'disabled' : ''} class="rounded-md border text-[13px] font-bold py-1.5 transition ${on ? 'bg-amber-400 text-night border-amber-300' : off ? 'opacity-20 border-ink-700' : 'bg-ink-850 border-ink-600 hover:border-ink-400'}"><span>${r === 'T' ? '10' : r}</span><span class="${on ? '' : `ts-${su}`}">${SUIT_SYM[su]}</span></button>`;
    }).join('')}</div>`).join('')}
    <div class="text-xs text-ink-400">${selected.length}/${max} picked</div></div>`;
}

// live games play in whole dollars: show them that way (cents only for small EV numbers)
const money = (bb) => { const v = bb * lg.L.bb; return `$${Math.abs(v) >= 10 || Math.abs(v - Math.round(v)) < 0.02 ? Math.round(v) : v.toFixed(2)}`; };

function tableHtml(s, L) {
  const order = Array.from({ length: N }, (_, j) => j);
  const seats = order.map(i => {
    const hero = i === HERO;
    const t = L.types[i];
    const shown = L.shown[i];
    return {
      name: hero ? 'You' : posOf(s, i),
      sub: hero ? posOf(s, i) : VILLAIN_TYPES[t].name,
      stack: `${money(s.stacks[i])}`,
      cards: hero ? byRank(L.hole) : s.folded[i] ? null : shown ? byRank(shown) : 'back',
      folded: s.folded[i], dealer: i === s.btn, bet: s.done ? 0 : s.streetBet[i], acting: !s.done && s.toAct === i, hero,
    };
  });
  const potNow = s.invested.reduce((a, b) => a + b, 0) - (s.done ? 0 : s.streetBet.reduce((a, b) => a + b, 0));
  const spr = s.street > 0 && !s.done && !s.folded[HERO] ? sprOf({ street: s.street, stacks: s.stacks, streetBet: s.streetBet, pot: potNow + s.streetBet.reduce((a, b) => a + b, 0), live: order.filter(i => !s.folded[i]), seat: HERO }) : null;
  return ringTable({ seats, board: L.boardCards, pot: potNow, spr, fmt: money });
}

function historyText(s, L) {
  const rows = [];
  let street = -1;
  for (const e of s.log) {
    if (e.street !== street) { street = e.street; rows.push({ head: STREET[street], cards: street === 0 ? [] : street === 1 ? L.boardCards.slice(0, 3) : L.boardCards.slice(street + 1, street + 2), acts: [] }); }
    if (e.type === 'fold' && e.street === 0 && e.seat !== HERO) continue;
    const who = e.seat === HERO ? 'You' : posOf(s, e.seat);
    const a = e.type === 'fold' ? 'fold' : e.type === 'check' ? 'check' : e.type === 'call' ? `call ${money(e.amount)}` : e.type === 'bet' ? `bet ${money(e.amount)}` : e.type === 'raise' ? `raise to ${money(e.to)}` : e.callAllIn ? 'call all-in' : `all-in ${money(e.to)}`;
    rows.at(-1).acts.push(`<span class="${e.seat === HERO ? 'text-ink-100' : 'text-amber-200/90'}">${who} ${a}</span>`);
  }
  if (!rows.length) return `<div class="text-sm text-ink-400">Blinds posted ($${L.stakes.replace('/', '/$')}).</div>`;
  return `<div class="space-y-1 text-sm">${rows.map(r => `<div class="flex gap-2 flex-wrap items-baseline"><span class="text-ink-400 w-14 shrink-0">${r.head}</span>${r.cards.length ? `<span class="mr-1">${handText(r.cards)}</span>` : ''}<span class="text-ink-300">${r.acts.join(', ')}</span></div>`).join('')}</div>`;
}

/** Size chips for the player to act, in bb "to" amounts. */
function sizeChips(s) {
  const L = legal(s);
  if (!L?.canRaise) return [];
  const me = s.toAct;
  const cur = Math.max(...s.streetBet);
  const p = s.invested.reduce((a, b) => a + b, 0);
  const out = [];
  if (s.street === 0) {
    if (cur <= 1) for (const x of [3, 4, 5, 6]) out.push({ to: x, label: `${money(x)}` });
    else for (const m of [2.5, 3, 4]) out.push({ to: Math.round(cur * m * 2) / 2, label: `${money(Math.round(cur * m * 2) / 2)} (${m}×)` });
  } else if (!L.facing) {
    for (const [f, l] of [[1 / 3, '⅓'], [0.5, '½'], [0.75, '¾'], [1, 'pot']]) { const b = Math.round(p * f * 2) / 2; out.push({ to: s.streetBet[me] + b, label: `${money(b)} · ${l}` }); }
  } else {
    for (const m of [2.5, 3, 4]) out.push({ to: Math.round(cur * m * 2) / 2, label: `${money(Math.round(cur * m * 2) / 2)} (${m}×)` });
  }
  return out.filter(o => o.to >= L.minTo - 1e-9 && o.to < L.maxTo - 1e-9);
}

// ------------------------------------------------------------------ screens

function draw(container) {
  if (lg.step === 'setup') return setup(container);
  if (lg.step === 'graded') return graded(container);
  return play(container);
}

function setup(container) {
  const d = lg.draft;
  const used = new Set();
  container.innerHTML = `<div class="page space-y-5 max-w-4xl">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div><a href="#play/review" class="text-sm text-ink-400 hover:text-white inline-flex items-center gap-1">${icon('back', 'w-4 h-4')} Review</a>
        <h1 class="h-title mt-1">Log a live hand</h1>
        <p class="muted mt-1 text-sm max-w-2xl">Played a hand at the casino? Enter it here and the coach grades your decisions against the players you were up against. Amounts in dollars.</p></div>
    </div>
    <div class="panel panel-pad grid md:grid-cols-2 gap-5">
      <div class="space-y-2"><div class="h-sec">Game</div>${seg('stakes', Object.keys(STAKES).map(k => ({ v: k, label: `$${k}` })), d.stakes)}</div>
      <div class="space-y-2"><div class="h-sec">Your seat</div>${seg('pos', ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'].map(p => ({ v: p, label: p })), d.pos)}
        <p class="text-xs text-ink-400">At a 9-handed table, the first three seats are UTG; then HJ, CO, BTN.</p></div>
      <label class="space-y-1.5 block"><span class="h-sec">Your stack ($)</span><input id="lg-stack" type="number" inputmode="decimal" min="1" value="${d.stack}" class="w-full"></label>
      <label class="space-y-1.5 block"><span class="h-sec">Their stacks ($)</span><input id="lg-others" type="number" inputmode="decimal" min="1" value="${d.others}" class="w-full">
        <span class="block text-xs text-ink-400">The biggest stack you were playing against (effective).</span></label>
    </div>
    <div class="panel panel-pad space-y-3">
      <div class="flex items-center justify-between"><div class="h-sec">Your cards</div><div class="text-lg">${d.hole.length ? handText(byRank(d.hole)) : '<span class="text-ink-500 text-sm">tap two cards</span>'}</div></div>
      ${picker(d.hole, used, 2)}
    </div>
    ${lg.err ? `<div class="text-sm text-rose-300">${lg.err}</div>` : ''}
    <button id="lg-start" class="btn btn-primary btn-lg btn-block" ${d.hole.length === 2 ? '' : 'disabled'}>${icon('pen', 'w-5 h-5')} Enter the action</button>
  </div>`;
  wireSeg(container, (name, v) => { d[name] = v; draw(container); });
  container.querySelector('#lg-stack').addEventListener('input', e => { d.stack = Number(e.target.value) || 0; });
  container.querySelector('#lg-others').addEventListener('input', e => { d.others = Number(e.target.value) || 0; });
  container.querySelectorAll('#picker [data-card]').forEach(b => b.addEventListener('click', () => {
    const id = Number(b.dataset.card);
    d.hole = d.hole.includes(id) ? d.hole.filter(x => x !== id) : [...d.hole, id].slice(-2);
    draw(container);
  }));
  container.querySelector('#lg-start').addEventListener('click', () => {
    const bbUSD = STAKES[d.stakes] || 2;
    if (!(d.stack >= bbUSD * 2) || !(d.others >= bbUSD * 2)) { lg.err = `Stacks need to be at least $${bbUSD * 2} at $${d.stakes}.`; draw(container); return; }
    lg.err = null;
    saveSettings({ ...settings(), logStakes: d.stakes, logPos: d.pos, logStack: d.stack, logOthers: d.others });
    lg.L = createLog({ stakes: d.stakes, pos: d.pos, hole: d.hole, stack: d.stack, others: d.others });
    lg.step = 'play';
    lg.pick = [];
    draw(container);
  });
}

function play(container) {
  const L = lg.L;
  const s = stateOf(L);
  const need = boardNeeded(L, s);
  const heroActed = s.log.some(e => e.seat === HERO);
  let panel;
  if (need > 0) {
    const street = L.boardCards.length === 0 ? 'flop' : L.boardCards.length === 3 ? 'turn' : 'river';
    const used = new Set([...L.hole, ...L.boardCards]);
    panel = `<div class="space-y-3">
      <div class="font-semibold text-white">Deal the ${street}${s.done ? ' (they were all in)' : ''}: pick ${need} card${need > 1 ? 's' : ''}</div>
      ${picker(lg.pick, used, need)}
      <button id="lg-board" class="btn btn-primary btn-block" ${lg.pick.length === need ? '' : 'disabled'}>Deal ${lg.pick.length ? handText(lg.pick) : ''}</button></div>`;
  } else if (s.done) {
    const live = s.folded.map((f, i) => i).filter(i => !s.folded[i] && i !== HERO);
    const sd = s.result.showdown && !s.folded[HERO];
    const used = new Set([...L.hole, ...L.boardCards, ...Object.values(L.shown).flat()]);
    panel = `<div class="space-y-3">
      <div class="font-semibold text-white">Hand over.</div>
      ${sd ? `<div class="text-sm text-ink-300">Showdown. Did ${live.length > 1 ? 'they' : posOf(s, live[0])} show? Optional: it only sets the result.</div>
        ${live.map(i => `<button data-show="${i}" class="mv ${lg.shown === i ? 'on' : ''}">${posOf(s, i)}${L.shown[i] ? ` ${handText(L.shown[i])}` : ': tap to enter'}</button>`).join(' ')}
        ${lg.shown != null ? `${picker(lg.pick, used, 2)}<button id="lg-shown" class="btn btn-block" ${lg.pick.length === 2 ? '' : 'disabled'}>Set his cards</button>` : ''}` : ''}
      <button id="lg-grade" class="btn btn-primary btn-lg btn-block">${icon('check', 'w-5 h-5')} Grade my hand</button></div>`;
  } else {
    const me = s.toAct;
    const hero = me === HERO;
    const lgl = legal(s);
    const chips = sizeChips(s);
    const amt = Number(lg.amount);
    const raiseWord = s.street > 0 && !lgl.facing ? 'Bet' : 'Raise to';
    panel = `<div class="space-y-3">
      <div class="flex items-center justify-between gap-2"><div class="font-semibold text-white">${hero ? 'Your action' : `${posOf(s, me)} to act`}</div>
        ${!hero && s.street === 0 && !heroActed ? '<button id="lg-foldto" class="btn btn-quiet text-sm">Folds to you</button>' : ''}</div>
      ${hero ? '' : `<div class="flex flex-wrap gap-1.5">${Object.entries(VILLAIN_TYPES).map(([k, v]) => `<button data-type="${k}" class="mv ${L.types[me] === k ? 'on' : ''}" title="${esc(v.blurb)}">${v.name}</button>`).join('')}</div>
        <div class="text-xs text-ink-400">Who is he? The coach reads his range through this type. You can change it later.</div>`}
      <div class="grid grid-cols-2 gap-2">
        ${lgl.fold ? '<button data-act="fold" class="act act-fold">Fold</button>' : ''}
        ${lgl.check ? '<button data-act="check" class="act act-pass">Check</button>' : `<button data-act="call" class="act act-pass">Call<small>${money(lgl.callAmount)}</small></button>`}
      </div>
      ${lgl.canRaise ? `<div class="space-y-2">
        <div class="flex flex-wrap gap-1.5">${chips.map(c => `<button data-size="${c.to}" class="mv">${c.label}</button>`).join('')}<button data-size="${lgl.maxTo}" class="mv">All-in ${money(lgl.maxTo)}</button></div>
        <div class="flex gap-2"><div class="relative flex-1"><span class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">$</span>
          <input id="lg-amt" type="number" inputmode="decimal" placeholder="${raiseWord === 'Bet' ? 'bet' : 'raise to'}" value="${lg.amount}" class="w-full !pl-7"></div>
          <button id="lg-raise" class="act act-aggr !py-2 !min-h-0 px-4" ${amt > 0 ? '' : 'disabled'}>${raiseWord}${amt > 0 ? ` $${amt}` : ''}</button></div>
        <div class="text-xs text-ink-400">${raiseWord === 'Bet' ? 'The amount he puts in.' : 'The total he raises to.'} Min ${money(lgl.minTo - (raiseWord === 'Bet' ? s.streetBet[me] : 0))}.</div>
        ${lg.note ? `<div class="text-xs text-amber-300">${lg.note}</div>` : ''}
      </div>` : ''}
    </div>`;
  }
  container.innerHTML = `<div class="page">
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <div class="text-sm text-ink-300"><b class="text-white">Live hand</b> · $${L.stakes} · you are <b class="text-white">${posOf(s, HERO)}</b> with ${handText(byRank(L.hole))}</div>
      <div class="flex gap-2"><button id="lg-undo" class="btn btn-quiet text-sm" ${L.actions.length ? '' : 'disabled'}>Undo</button><button id="lg-cancel" class="btn btn-quiet text-sm">Start over</button></div>
    </div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 lg:grid-flow-dense items-start">
      <div class="space-y-4 min-w-0">${tableHtml(s, L)}
        <div class="panel panel-pad">${historyText(s, L)}</div></div>
      <div class="lg:col-start-2 lg:row-start-1"><div class="panel panel-pad">${panel}</div>
        <p class="text-xs text-ink-400 mt-3 px-1">The grades stay hidden until the hand is done, so you log what you did, not what the coach says.</p></div>
    </div>
  </div>`;
  const redraw = () => draw(container);
  container.querySelectorAll('#picker [data-card]').forEach(b => b.addEventListener('click', () => {
    const id = Number(b.dataset.card);
    const max = need > 0 ? need : 2;
    lg.pick = lg.pick.includes(id) ? lg.pick.filter(x => x !== id) : [...lg.pick, id].slice(-max);
    redraw();
  }));
  container.querySelector('#lg-board')?.addEventListener('click', () => { L.boardCards.push(...lg.pick); lg.pick = []; redraw(); });
  container.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => { lg.shown = Number(b.dataset.show); lg.pick = []; redraw(); }));
  container.querySelector('#lg-shown')?.addEventListener('click', () => { L.shown[lg.shown] = [...lg.pick]; lg.shown = null; lg.pick = []; redraw(); });
  container.querySelector('#lg-foldto')?.addEventListener('click', () => { foldToHero(L); redraw(); });
  container.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { L.types[s.toAct] = b.dataset.type; redraw(); }));
  container.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { logAction(L, { type: b.dataset.act }); lg.amount = ''; lg.note = null; redraw(); }));
  container.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
    const to = Number(b.dataset.size);
    logAction(L, { type: to >= legal(s).maxTo - 1e-9 ? 'allin' : 'raise', to });
    lg.amount = ''; lg.note = null;
    redraw();
  }));
  const amtEl = container.querySelector('#lg-amt');
  amtEl?.addEventListener('input', e => {
    lg.amount = e.target.value;
    const btn = container.querySelector('#lg-raise');
    const v = Number(lg.amount);
    btn.disabled = !(v > 0);
    btn.textContent = `${s.street > 0 && !legal(s).facing ? 'Bet' : 'Raise to'}${v > 0 ? ` $${v}` : ''}`;
  });
  container.querySelector('#lg-raise')?.addEventListener('click', () => {
    const v = Number(lg.amount) / L.bb;
    if (!(v > 0)) return;
    const lgl = legal(s);
    const to = s.street > 0 && !lgl.facing ? s.streetBet[s.toAct] + v : v;
    const x = logAction(L, { type: to >= lgl.maxTo - 1e-9 ? 'allin' : 'raise', to });
    // say so when the amount had to change
    if (x.type === 'allin' && to > lgl.maxTo + 1e-9) lg.note = `That's more than the stack, so it's logged as all-in (${money(lgl.maxTo)}).`;
    else if (x.type === 'raise' && x.to > to + 1e-9) lg.note = `The minimum here was ${money(lgl.minTo)}, so it's logged as that.`;
    else lg.note = null;
    lg.amount = '';
    redraw();
  });
  container.querySelector('#lg-undo')?.addEventListener('click', () => { undo(L); lg.pick = []; redraw(); });
  container.querySelector('#lg-cancel')?.addEventListener('click', () => { reset(); redraw(); });
  container.querySelector('#lg-grade')?.addEventListener('click', () => {
    container.querySelector('#lg-grade').textContent = 'Grading…';
    setTimeout(() => {
      lg.graded = gradeLog(L);
      const h = toHistory(L, lg.graded);
      h.no = loadHands().filter(x => x.sid === h.sid).length + 1;
      addHand(h);
      lg.saved = h;
      lg.step = 'graded';
      redraw();
    }, 20);
  });
}

function graded(container) {
  const L = lg.L;
  const h = lg.saved;
  const ds = h.decisions;
  const bad = ds.filter(d => d.verdict === 'mistake' || d.verdict === 'blunder');
  container.innerHTML = `<div class="page space-y-5 fade-up">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div><div class="h-sec">Live hand · $${L.stakes}</div><h1 class="h-title">${bad.length ? `${bad.length} decision${bad.length > 1 ? 's' : ''} to fix` : ds.length ? 'Well played' : 'Nothing to decide'}</h1>
        <p class="muted mt-1 text-sm">${ds.length} decision${ds.length === 1 ? '' : 's'} graded against ${[...new Set(L.types.filter((t, i) => i !== HERO && h.log.some(e => e.seat === i && e.type !== 'fold')).map(t => VILLAIN_TYPES[t].name))].join(', ') || 'the table'}.
        ${h.evLost > 0.005 ? `<span class="text-rose-300">EV lost: ${fmtBB(h.evLost)} (${money(h.evLost)}).</span>` : '<span class="text-emerald-300">No EV lost.</span>'}</p></div>
      <div class="flex gap-2 flex-wrap"><a class="btn" href="#play/review/h/${h.id}">${icon('review', 'w-4 h-4')} Replay it</a><button id="lg-again" class="btn btn-primary">${icon('pen', 'w-4 h-4')} Log another hand</button></div>
    </div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
      <div class="space-y-2">${ds.length ? ds.map((d, i) => decisionRow(d, i, { fmt: money, evNote: `EV against the players still in, read as the types you gave them.` })).join('') : '<p class="text-sm text-ink-400">You had no decision in this hand.</p>'}</div>
      <div class="panel panel-pad">${historyText(stateOf(L), L)}<p class="text-xs text-ink-400 mt-3">Saved to Review → "Your live hands". It counts in your leak report.</p></div>
    </div>
  </div>`;
  const first = container.querySelector('details');
  if (first && bad.length) first.open = true;
  container.querySelector('#lg-again').addEventListener('click', () => {
    const keep = { stakes: L.stakes };
    reset();
    lg.draft.stakes = keep.stakes;
    draw(container);
  });
}

export { cardText, fmtBB };
