/**
 * Learn → Player types: the eight kinds of player at the live table, with the HUD stats an online
 * player would see (real numbers: the players the bots are calibrated to), how to spot each one
 * live without a HUD, and the Level 2 adjustment against him.
 */
import { icon, esc } from '../kit.js';
import TYPES from '../../content/types.json';

const HEAD = {
  VPIP: ['VPIP', 'Puts money in preflop (calls or raises)'],
  PFR: ['PFR', 'Raises preflop'],
  '3Bet': ['3-Bet', 'Re-raises a raise'],
  FoldTo3Bet: ['Fold to 3-Bet', 'Folds when his raise is re-raised'],
  CBetFlop: ['C-Bet', 'Bets the flop after raising preflop'],
  FoldToCBetFlop: ['Fold to C-Bet', 'Folds to a flop c-bet'],
  CheckRaiseFlop: ['Check-Raise', 'Checks the flop, then raises a bet'],
  WTSD: ['WTSD', 'Went to showdown, of the flops he saw'],
  AFq: ['AFq', 'Aggression: bets and raises, of all his postflop actions'],
};

/** How to spot him live, and what changes at Level 2. */
const GUIDE = {
  whale: {
    name: 'Whale', spot: 'In half the pots. Limps, calls raises with anything, bets into the raiser, and shows up with two pair made from 8-5 offsuit.',
    beat: 'Value-bet big and often, on every street; don\'t bluff him. His bet sizes tell you his hand: big means big.',
  },
  station: {
    name: 'Station', spot: 'Plays a third of his hands, rarely raises, and goes to showdown more than anyone with second pair and worse.',
    beat: 'Bet your value thinner and bigger, and stop bluffing after the flop. When he finally bets or raises the river, believe him.',
  },
  passive: {
    name: 'Passive', spot: 'Plays a normal number of hands but almost never raises: limps, calls, and folds when he misses. The quiet regular at the end of the table.',
    beat: 'C-bet often and take the pots nobody wants. When he raises, he has it: fold your one-pair hands.',
  },
  nit: {
    name: 'Nit', spot: 'Folds for orbits, raises only good hands, and gives up quickly when the board gets scary.',
    beat: 'Steal his blinds and bluff his checks; fold to his big bets and raises. Don\'t pay off his river bets.',
  },
  maniac: {
    name: 'Maniac', spot: 'Raises and re-raises constantly, bets every street, and shows down air.',
    beat: 'Call him down lighter, let him bluff, and trap with your strong hands. Don\'t bluff into him.',
  },
  reg: {
    name: 'Reg', spot: 'Tight and aggressive: raises first in, c-bets, and folds when he meets resistance. Often wears headphones and stacks his chips neatly.',
    beat: 'Close to the baseline. Pressure his c-bets and his turn checks; respect his raises.',
  },
  shark: {
    name: 'Shark', spot: 'A strong pro: plays a quarter of his hands, 3-bets and floats, and hardly ever does anything silly.',
    beat: 'Play the baseline (Level 1) and avoid big pots without a big hand. He adjusts to you, so don\'t lean on one exploit.',
  },
  pro: {
    name: 'Pro', spot: 'Plays like a solver (Pluribus): balanced, aggressive, never readable from one hand.',
    beat: 'Play the baseline. There is little to exploit; the money is at the fish seats.',
  },
};

export function render(container) {
  const stats = TYPES.stats;
  container.innerHTML = `<div class="page max-w-4xl space-y-5 fade-up">
    <a href="#learn" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Learn</a>
    <div><div class="h-sec">Reading players</div><h1 class="h-title">Player types</h1>
      <p class="text-ink-300 mt-1">The eight kinds of player at the live table, with the HUD stats an online player would see. Live you have no HUD, so count: how many hands he plays, how often he raises, whether he shows up at showdown. These are real numbers, from the players the bots are calibrated to.</p></div>

    <section class="panel panel-pad overflow-x-auto">
      <table class="w-full text-sm num">
        <thead><tr class="text-left text-[11px] uppercase tracking-wide text-ink-400">
          <th class="pb-2 pr-3 font-semibold">Type</th>${stats.map(s => `<th class="pb-2 pr-3 font-semibold whitespace-nowrap" title="${esc(HEAD[s][1])}">${HEAD[s][0]}</th>`).join('')}</tr></thead>
        <tbody>${Object.entries(TYPES.types).map(([k, t]) => `<tr class="border-t border-ink-700/60">
          <td class="py-1.5 pr-3 font-semibold text-white">${esc(GUIDE[k].name)}</td>
          ${stats.map(s => `<td class="py-1.5 pr-3 text-ink-200">${t[s] ?? '—'}${s === 'AFq' || t[s] == null ? '' : '%'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p class="text-[11px] text-ink-400 mt-2">Hover a column for its meaning. VPIP / PFR is the first read: 50 / 10 is a whale, 13 / 9 a nit, 23 / 17 a reg. Fish, Nit and Maniac: 8.9 million 25NL–100NL hands (2009). Reg: halfway between those regs and today's pros (more 3-bets, lighter c-bets). Shark and Pro: the 2019 Pluribus games.</p>
    </section>

    <section class="grid sm:grid-cols-2 gap-3">
      ${Object.keys(TYPES.types).map(k => {
        const g = GUIDE[k], t = TYPES.types[k];
        return `<div class="panel panel-pad space-y-1.5">
          <div class="flex items-center justify-between"><b class="text-white text-lg">${esc(g.name)}</b><span class="pill num">${t.VPIP} / ${t.PFR}</span></div>
          <p class="text-sm text-ink-300"><span class="text-ink-400">Spot him live:</span> ${esc(g.spot)}</p>
          <p class="text-sm text-ink-200"><span class="text-amber-200">Level 2:</span> ${esc(g.beat)}</p>
          <p class="text-[11px] text-ink-400">About ${t.RiverBluffs}% of his called river bets are bluffs.</p>
        </div>`;
      }).join('')}
    </section>
    <div class="grid sm:grid-cols-2 gap-3">
      <a href="#learn/buckets" class="panel px-4 py-3 hover:border-ink-500 transition"><b class="text-white">Hand buckets</b><div class="text-xs text-ink-300 mt-1">The plan for each kind of hand, at Level 1 and against each type.</div></a>
      <a href="#play/table" class="panel px-4 py-3 hover:border-ink-500 transition"><b class="text-white">Live table</b><div class="text-xs text-ink-300 mt-1">Read them from VPIP / PFR, then reveal their styles.</div></a>
    </div>
  </div>`;
}
