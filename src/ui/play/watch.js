/**
 * Watch two bots play, every card face up, each decision explained.
 */
import { createMatch, startHand, step, scoreboard, agentAt, AGENTS, TYPE_NAME, matchSummary } from '../../engine/hu/watch.js';
import { AGENT_IDS, eloOf } from '../../engine/hu/agents.js';
import { board, pot, BTN } from '../../engine/hu/game.js';
import { pokerTable, fmtBB, seg, wireSeg, icon, esc, handText, stat, disc } from '../kit.js';
import { pct } from '../../engine/potmath.js';
import { historyHtml, playTabs } from './views.js';

const SPEED = { slow: 2200, normal: 1200, fast: 450 };
let st = { a: 'pro', b: 'station', speed: 'normal', running: false };
let m = null;
let timer = null;

export function render(container) {
  if (!m) setup(container);
  else draw(container);
  return () => { clearTimeout(timer); timer = null; st.running = false; };
}

const byRank = (h) => [...h].sort((x, y) => (y >> 2) - (x >> 2));
const CLASS = { monster: 'a monster', strong: 'a strong hand', medium: 'a medium hand', weak: 'a weak pair', draw: 'a draw', air: 'air' };
const STREET = ['Preflop', 'Flop', 'Turn', 'River'];



function setup(container) {
  const opt = (sel) => [...AGENT_IDS].sort((x, y) => eloOf(x) - eloOf(y)).map(id => `<option value="${id}" ${id === sel ? 'selected' : ''}>${AGENTS[id].name} (${eloOf(id)})</option>`).join('');
  container.innerHTML = `<div class="page space-y-6 fade-up">
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div><div class="h-sec">Play</div><h1 class="h-title">Watch two bots play</h1>
        <p class="muted mt-1 text-sm">Every card face up. See how the Pro takes apart a Station, or how a Maniac blows up against a Nit, one explained decision at a time.</p></div>
      ${playTabs('watch')}
    </div>
    <div class="panel panel-pad grid sm:grid-cols-[1fr_auto_1fr] gap-4 items-end">
      <label class="space-y-1.5 block"><span class="h-sec">Player 1</span><select id="w-a" class="w-full">${opt(st.a)}</select></label>
      <div class="text-ink-400 text-center pb-2 font-semibold">vs</div>
      <label class="space-y-1.5 block"><span class="h-sec">Player 2</span><select id="w-b" class="w-full">${opt(st.b)}</select></label>
    </div>
    <div class="grid sm:grid-cols-3 gap-3">
      ${[['pro', 'station', 'How the Pro milks a Station'], ['pro', 'nit', 'Stealing from a Nit'], ['nit', 'maniac', 'A Maniac vs a Nit']].map(([a, b, l]) =>
        `<button class="panel px-4 py-3 text-left hover:border-ink-500" data-pair="${a},${b}"><div class="font-semibold text-white">${l}</div><div class="text-xs text-ink-400 mt-0.5">${AGENTS[a].name} vs ${AGENTS[b].name}</div></button>`).join('')}
    </div>
    <button id="w-start" class="btn btn-primary btn-lg btn-block">${icon('play', 'w-5 h-5')} Watch</button>
  </div>`;
  container.querySelector('#w-a').addEventListener('change', e => { st.a = e.target.value; });
  container.querySelector('#w-b').addEventListener('change', e => { st.b = e.target.value; });
  container.querySelectorAll('[data-pair]').forEach(b => b.addEventListener('click', () => {
    [st.a, st.b] = b.dataset.pair.split(',');
    begin(container);
  }));
  container.querySelector('#w-start').addEventListener('click', () => begin(container));
}

function begin(container) {
  m = createMatch(st.a, st.b);
  startHand(m);
  st.running = true;
  draw(container);
}

function table() {
  const s = m.s;
  const top = 1 - m.seatOfA, bottom = m.seatOfA; // player 1 at the bottom
  const pod = (seat) => {
    const ag = agentAt(m, seat);
    return { name: ag.name, sub: `${eloOf(ag.id)} · ${seat === BTN ? 'BTN' : 'BB'}`, stack: fmtBB(s.stacks[seat]), cards: byRank(s.holes[seat]), folded: s.folded === seat, dealer: seat === BTN };
  };
  const bd = s.done ? s.runout.slice(0, s.result.showdown ? 5 : board(s).length) : board(s);
  return pokerTable({
    top: pod(top), bottom: pod(bottom), board: bd,
    pot: s.done ? pot(s) : pot(s) - s.streetBet[0] - s.streetBet[1],
    bets: s.done ? {} : { top: s.streetBet[top], bottom: s.streetBet[bottom] },
    acting: s.done ? null : s.toAct === bottom ? 'bottom' : 'top',
    note: s.done ? (s.result.showdown ? 'Showdown' : `${agentAt(m, s.folded).name} folds`) : '',
  });
}

function explain(d) {
  if (!d) return `<div class="text-sm text-ink-400">Press play, or step through one decision at a time.</div>`;
  const head = `<div class="flex items-baseline justify-between gap-2"><div class="text-lg font-semibold text-white">${esc(d.who)}: ${esc(d.action)}</div>
    <div class="text-xs text-ink-400">${STREET[d.street]} · pot ${fmtBB(d.pot)}${d.toCall > 0 ? ` · ${fmtBB(d.toCall)} to call` : ''}</div></div>
    <div class="text-sm text-ink-300">${handText(d.hole)}${d.cls ? ` · ${CLASS[d.cls]}` : ` · ${d.handType}`}</div>`;
  const rows = d.probs.slice().sort((a, b) => (b.ev ?? b.p) - (a.ev ?? a.p)).map(o => {
    const chosen = o.label === d.action;
    return `<div class="grid items-center gap-2 text-sm" style="grid-template-columns: minmax(90px,38%) 1fr 70px">
      <span class="${chosen ? 'text-white font-semibold' : 'text-ink-300'} truncate">${chosen ? '▸ ' : ''}${esc(o.label)}</span>
      <div class="evbar"><i class="${chosen ? 'bg-emerald-400' : 'bg-ink-400'}" style="width:${Math.max(2, 100 * o.p)}%"></i></div>
      <span class="text-right num text-xs text-ink-200">${o.ev != null ? `${o.ev >= 0 ? '+' : ''}${o.ev.toFixed(1)}bb` : pct(o.p)}</span></div>`;
  }).join('');
  let why = '';
  if (d.kind === 'thinker') {
    const read = d.read ? `He reads ${esc(d.oppName)} as <b class="text-amber-200">${d.read.map(r => `${r.name} ${pct(r.p)}`).join(', ')}</b>.` : `No read on ${esc(d.oppName)} yet: he assumes a typical player.`;
    const eq = d.eqRead != null ? ` Against the range he puts him on he has <b>${pct(d.eqRead)}</b>; against his actual cards, <b>${pct(d.eqTrue)}</b>.` : '';
    const bet = d.probs.find(o => o.label === d.action && o.fold != null);
    const fe = bet ? ` He expects a fold <b>${pct(bet.fold)}</b> of the time.` : '';
    why = `<p>${read}${eq}${fe}</p><p class="text-ink-400 text-xs">Bars: how often he takes each option with this hand. Numbers: what each is worth to him (bb, one street ahead) against his read.</p>`;
  } else {
    const shift = d.adapt >= 0.01 ? ` He has shifted ${pct(d.adapt)} of his play towards exploiting ${esc(d.oppName)}${d.read ? ` (reads him as ${esc(d.read[0].name)})` : ''}.` : '';
    why = `<p>${esc(d.who)} plays by style${d.notes.length ? `: ${d.notes.slice(0, 2).map(esc).join('; ')}` : ''}.${shift}</p>
      <p>He has <b>${pct(d.eqTrue)}</b> against ${esc(d.oppName)}'s actual hand.</p>
      <p class="text-ink-400 text-xs">Bars: how often he takes each option with this hand.</p>`;
  }
  return `<div class="space-y-3 fade-up">${head}<div class="space-y-1.5">${rows}</div><div class="text-sm text-ink-200 space-y-1.5">${why}</div></div>`;
}

function draw(container) {
  clearTimeout(timer);
  timer = null;
  const sb = scoreboard(m);
  const last = m.feed.at(-1);
  const a = AGENTS[m.ids[0]], b = AGENTS[m.ids[1]];
  const tone = (x) => (x > 0 ? 'text-emerald-300' : x < 0 ? 'text-rose-300' : '');
  const feed = m.feed.slice(0, -1).reverse().slice(0, 8).map(d => `<div class="text-xs text-ink-300 flex gap-2"><span class="text-ink-500 w-12 shrink-0">${STREET[d.street]}</span><span><b class="text-ink-100">${esc(d.who)}</b> ${esc(d.action)}</span></div>`).join('');
  const openState = [...container.querySelectorAll('details')].map(d => d.open);
  container.innerHTML = `<div class="page">
    <div class="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <div class="text-sm text-ink-300"><b class="text-white">${a.name}</b> vs <b class="text-white">${b.name}</b> · hand ${m.handNo}</div>
      <div class="flex items-center gap-2">${playTabs('watch')}<button id="w-new" class="btn btn-quiet text-sm">Change bots</button></div>
    </div>
    <div class="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5 lg:grid-flow-dense items-start">
      <div class="space-y-4 min-w-0">
        ${table()}
        <div class="flex items-center gap-2 flex-wrap">
          <button id="w-toggle" class="btn ${st.running ? '' : 'btn-primary'}">${icon(st.running ? 'pause' : 'play', 'w-4 h-4')} ${st.running ? 'Pause' : 'Play'}</button>
          <button id="w-step" class="btn" ${st.running ? 'disabled' : ''}>Step ${icon('next', 'w-4 h-4')}</button>
          <button id="w-hand" class="btn" ${st.running ? 'disabled' : ''}>Finish hand</button>
          <span class="ml-auto">${seg('speed', [{ v: 'slow', label: 'Slow' }, { v: 'normal', label: 'Normal' }, { v: 'fast', label: 'Fast' }], st.speed)}</span>
        </div>
      </div>
      <div class="space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2">
        <div class="panel panel-pad">${explain(last)}${feed ? `<div class="border-t border-ink-700 mt-4 pt-3 space-y-1">${feed}</div>` : ''}</div>
        <div class="panel panel-pad space-y-3">
          <div class="grid grid-cols-2 gap-2">
            ${stat('Hands', sb.hands)}
            ${stat(`${a.name} result`, `<span class="${tone(sb.netA)}">${fmtBB(sb.netA, { sign: true })}</span>`, `${sb.bb100 >= 0 ? '+' : ''}${sb.bb100} bb/100`)}
          </div>
          ${sb.readAofB ? `<div class="text-xs text-ink-300">${a.name} reads ${b.name} as <b class="text-amber-200">${TYPE_NAME(sb.readAofB.type)}</b> (${pct(sb.readAofB.p)})</div>` : ''}
          ${sb.readBofA ? `<div class="text-xs text-ink-300">${b.name} reads ${a.name} as <b class="text-amber-200">${TYPE_NAME(sb.readBofA.type)}</b> (${pct(sb.readBofA.p)})</div>` : ''}
          ${summaryHtml()}
        </div>
      </div>
      <div class="panel panel-pad min-w-0">${historyHtml(m.s, -1, [agentAt(m, 0).name, agentAt(m, 1).name])}</div>
    </div>
  </div>`;
  container.querySelectorAll('details').forEach((d, i) => { if (openState[i]) d.open = true; });
  container.querySelector('#w-new').addEventListener('click', () => { m = null; st.running = false; setup(container); });
  container.querySelector('#w-toggle').addEventListener('click', () => { st.running = !st.running; draw(container); });
  container.querySelector('#w-step')?.addEventListener('click', () => { advance(); draw(container); });
  container.querySelector('#w-hand')?.addEventListener('click', () => { if (m.s.done) startHand(m); while (!m.s.done) step(m); draw(container); });
  wireSeg(container, (n, v) => { st.speed = v; draw(container); });
  if (st.running) {
    timer = setTimeout(() => {
      if (!container.isConnected || !m) return;
      advance();
      draw(container);
    }, m.s.done ? SPEED[st.speed] * 1.6 : SPEED[st.speed]);
  }
}

function summaryHtml() {
  const sm = matchSummary(m);
  if (sm.hands < 3) return '';
  const f = (x) => (x == null ? '—' : pct(x));
  const bb = (x) => `<span class="${x > 0 ? 'text-emerald-300' : x < 0 ? 'text-rose-300' : ''}">${x > 0 ? '+' : ''}${x}</span>`;
  const row = (label, k, fmt = f) => `<tr><td class="py-1 text-ink-400">${label}</td>${sm.rows.map(r => `<td class="py-1 text-right num text-ink-100">${fmt(r[k])}${r.n?.[k] != null && r.n[k] > 0 && r.n[k] < 10 ? `<span class="text-ink-500 text-[11px]"> (${r.n[k]})</span>` : ''}</td>`).join('')}</tr>`;
  const table = `<table class="w-full text-sm"><thead><tr><th></th>${sm.names.map(n => `<th class="text-right text-xs font-semibold text-ink-300 pb-1">${esc(n)}</th>`).join('')}</tr></thead><tbody>
    ${row('VPIP', 'vpip')}${row('PFR', 'pfr')}${row('C-bet', 'cbet')}${row('Folds to a bet', 'foldToBet')}
    ${row('River bets that are bluffs', 'riverBluff')}${row('River calls that lose', 'riverCallLost')}
    ${row('Won at showdown', 'sdNet', bb)}${row('Won without', 'nonSdNet', bb)}</tbody></table>`;
  return `${sm.story ? `<div class="text-sm text-ink-100 rounded-lg bg-ink-850 border border-ink-700 px-3 py-2"><b class="text-amber-200">How it's going:</b> ${esc(sm.story)}</div>` : ''}
    ${disc(`Match stats · ${sm.hands} hands`, table, false)}`;
}

function advance() {
  if (m.s.done) startHand(m);
  else step(m);
}
