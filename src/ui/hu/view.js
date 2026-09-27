/**
 * Shared rendering for heads-up hands (Play and Simulate): table, hand history, coach panel.
 */
import { renderPokerTable } from '../components.js';
import { cardToDisplay } from '../../engine/cards.js';
import { cardStr, evaluate, category } from '../../engine/hu/hand.js';
import { board, pot, BTN, BB } from '../../engine/hu/game.js';
import { BOT_TYPES } from '../../engine/hu/bots.js';
import { pct } from '../../engine/potmath.js';

export const POS = ['BTN', 'BB'];
const CAT_NAME = ['high card', 'a pair', 'two pair', 'trips', 'a straight', 'a flush', 'a full house', 'quads', 'a straight flush'];
const STREET = ['Preflop', 'Flop', 'Turn', 'River'];

export function handName(hole, bd) {
  return CAT_NAME[category(evaluate([...hole, ...bd]))];
}

const disp = (ids) => ids.map(c => cardToDisplay(cardStr(c)));

/** Heads-up table: hero at the bottom, the bot at the top. */
export function table(s, hero, botId, { reveal = false } = {}) {
  const villain = 1 - hero;
  const seats = Array.from({ length: 6 }, () => ({ hidden: true }));
  const bd = board(s);
  seats[0] = { position: POS[hero], is_hero: true, is_active: true, cards: disp(s.holes[hero]), stack: s.stacks[hero].toFixed(1) };
  seats[3] = {
    position: `${POS[villain]} · ${BOT_TYPES[botId].name}`,
    is_active: s.folded !== villain,
    cards: reveal ? disp(s.holes[villain]) : null,
    show_cards: reveal,
    stack: s.stacks[villain].toFixed(1),
  };
  // Only the bot's chip goes on the felt (the hero's would sit on his cards); the rest is text below.
  const bets = {};
  if (s.streetBet[villain] > 0 && !s.done) bets[3] = `${s.streetBet[villain]}bb`;
  const middle = s.done ? pot(s) : pot(s) - s.streetBet[0] - s.streetBet[1];
  const info = [`${STREET[s.street]}`, `pot ${middle.toFixed(1)}bb`];
  if (!s.done) {
    if (s.streetBet[hero] > 0) info.push(`you've put in ${s.streetBet[hero]}bb`);
    const owe = s.streetBet[villain] - s.streetBet[hero];
    if (owe > 0) info.push(`${+owe.toFixed(2)}bb to call`);
  }
  return `<div class="pt-6">` + renderPokerTable({
    seats,
    dealerSeat: hero === BTN ? 0 : 3,
    bets: Object.keys(bets).length ? bets : null,
    board: disp(s.done ? s.runout.slice(0, s.result?.showdown ? 5 : bd.length) : bd),
    pot: null,
    situation: null,
  }) + `<div class="text-center text-sm font-mono text-amber-300/90 mt-4">${info.join(' · ')}</div></div>`;
}

/** "Preflop: BTN raise 2.5, BB call · Flop K♥9♠4♦: BB check, …" */
export function history(s, hero) {
  const lines = [];
  let street = -1;
  for (const e of s.log) {
    if (e.street !== street) {
      street = e.street;
      const cards = street === 0 ? '' : ' ' + (street === 1 ? s.runout.slice(0, 3) : [s.runout[street + 1]]).map(cardStr).join('');
      lines.push({ street, head: `${STREET[street]}${cards}`, acts: [] });
    }
    const who = e.seat === hero ? 'You' : POS[e.seat];
    let a = e.type;
    if (e.type === 'call') a = `call ${e.amount}`;
    if (e.type === 'raise') a = `raise to ${e.to}`;
    if (e.type === 'bet') a = `bet ${e.to} (${Math.round((100 * e.to) / e.pot)}%)`;
    if (e.type === 'allin') a = `all-in ${e.to}`;
    lines.at(-1).acts.push(`${who} ${a}`);
  }
  return `<div class="text-xs font-mono text-gray-400 space-y-0.5">${lines
    .map(l => `<div><span class="text-gray-600">${l.head}</span> ${l.acts.join(', ')}</div>`)
    .join('')}</div>`;
}

export function botBadge(botId) {
  const b = BOT_TYPES[botId];
  return `<div class="rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2">
    <div class="text-sm font-semibold text-amber-300">Opponent: ${b.name}</div>
    <div class="text-xs text-gray-400 mt-0.5">${b.desc}</div></div>`;
}

export function botSelect(current, id = 'bot') {
  return `<select id="${id}" class="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm">
    ${Object.values(BOT_TYPES).map(b => `<option value="${b.id}" ${b.id === current ? 'selected' : ''}>vs ${b.name}</option>`).join('')}
  </select>`;
}

/** Grade the hero's choice from a coach result. */
export function gradeChoice(k, idx) {
  if (k.preflop) {
    return { verdict: idx === k.best ? 'best' : k.fine.includes(idx) ? 'fine' : 'mistake', loss: null };
  }
  const loss = Math.max(0, k.options[k.best].ev - k.options[idx].ev);
  return { verdict: idx === k.best ? 'best' : k.fine.includes(idx) ? 'fine' : 'mistake', loss };
}

const CLASS_LABEL = { monster: 'monsters', strong: 'strong', medium: 'medium', weak: 'weak pairs', draw: 'draws', air: 'air' };

/** The coach's panel for one decision. */
export function coachPanel(k, idx, botId) {
  const g = gradeChoice(k, idx);
  const bestLabel = k.options[k.best].label;
  const chosen = k.options[idx].label;
  const color = { best: 'emerald', fine: 'sky', mistake: 'red' }[g.verdict];
  const head = g.verdict === 'best' ? `Best: ${chosen}`
    : g.verdict === 'fine' ? `Fine: ${chosen} (best: ${bestLabel})`
    : `Mistake: ${chosen}${g.loss != null ? ` costs ~${g.loss.toFixed(2)}bb` : ''}. Best: ${bestLabel}`;
  let body = '';
  if (k.preflop) {
    body = `<div class="text-sm text-gray-300">Chart: <b>${k.chart}</b>. ${k.notes.join(' ')}</div>`;
  } else {
    const maxEv = Math.max(...k.options.map(o => o.ev));
    const minEv = Math.min(...k.options.map(o => o.ev), 0);
    const bars = k.options.map((o, i) => {
      const w = Math.max(3, (100 * (o.ev - minEv)) / Math.max(0.01, maxEv - minEv));
      const col = i === k.best ? 'bg-emerald-500' : k.fine.includes(i) ? 'bg-sky-500' : 'bg-gray-600';
      return `<div class="flex items-center gap-2 text-xs">
        <div class="w-28 text-right ${i === idx ? 'text-white font-semibold' : 'text-gray-400'}">${o.label}</div>
        <div class="flex-1 bg-gray-800 rounded h-2.5"><div class="${col} h-2.5 rounded" style="width:${w}%"></div></div>
        <div class="w-16 font-mono text-gray-300">${o.ev >= 0 ? '+' : ''}${o.ev.toFixed(2)}</div></div>`;
    }).join('');
    const rng = Object.entries(k.range).filter(([, v]) => v >= 0.03).sort((a, b) => b[1] - a[1])
      .map(([c, v]) => `${CLASS_LABEL[c]} ${pct(v)}`).join(' · ');
    body = `
      <div class="space-y-1.5">${bars}</div>
      <div class="text-[0.7rem] text-gray-500">EV in bb from here (folding = 0). ${k.exact ? 'River: exact against this bot.' : 'Flop/turn: one street ahead, equity treated as realised.'}</div>
      <div class="text-sm text-gray-300">Your equity vs his range: <b>${pct(k.equity)}</b>${k.need != null ? ` · need <b>${pct(k.need)}</b> to call` : ''}.</div>
      <div class="text-sm text-gray-400">${BOT_TYPES[botId].name}'s range here: ${rng}.</div>`;
  }
  return `<div class="rounded-lg border border-${color}-700/50 bg-${color}-900/25 px-3 py-2 space-y-2 flash-in">
    <div class="text-sm font-semibold text-${color}-300">${head}</div>${body}</div>`;
}
