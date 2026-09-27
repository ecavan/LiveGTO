/**
 * Formula sheet: every number used at the table, with the intuition next to the equation.
 * P = pot before the bet, B = bet, C = amount to call, e = equity.
 */
import { icon } from '../kit.js';

const ROWS = [
  ['Pot odds (equity to call)', 'e ≥ C ÷ (P + B + C)', 'You pay C to win everything in the middle. Facing a bet B into P: B ÷ (P + 2B).',
    '⅓ pot 20% · ½ 25% · ⅔ 28.5% · ¾ 30% · pot 33% · 2× 40%'],
  ['Break-even bluff (α)', 'folds ≥ B ÷ (P + B)', 'Risk B to win P. The bigger the bet, the more often it must work.',
    '⅓ pot 25% · ½ 33% · ¾ 43% · pot 50% · 2× 67%'],
  ['Minimum defence (MDF)', 'defend ≥ P ÷ (P + B) = 1 − α', 'Defend this share of your range and his pure bluffs break even. A benchmark: live players under-bluff big bets, so fold more against them.',
    '⅓ pot 75% · ½ 67% · pot 50% · 2× 33%'],
  ['Bluffs in a polarised river bet', 'bluffs ÷ bets = B ÷ (P + 2B)', 'Exactly his pot odds: his bluff-catchers are then indifferent.',
    '½ pot 25% · pot 33% · 2× 40%'],
  ['EV of a call', 'EV = e·(P + B + C) − C', 'Chips back on average minus what you put in. Positive: call.', ''],
  ['Semi-bluff folds needed', 'F = (B − e·(P + 2B)) ÷ (P + B − e·(P + 2B))', 'Your equity when called lowers the folds you need. (e = equity realised when called.)', ''],
  ['Outs → equity', 'one card: outs ÷ 46 · two cards: 1 − (47−o)(46−o) ÷ (47·46)', 'Rule of 2 and 4: outs × 2 per card; × 4 only if you will see both cards.',
    'FD 9 outs: 19.6% / 35% · OESD 8: 17.4% / 31.5% · gutshot 4: 8.7% / 16.5% · FD + OESD 15: 54%'],
  ['Implied odds', 'X ≥ C ÷ e − (P + B + C)', 'What you must win later, when you hit, to make the call break even.', ''],
  ['Set-mining', 'stack behind ≥ 15–20 × call', 'You flop a set 11.8% (1 in 8.5), but you will not always get paid: use 15×, not 7.5×.', ''],
  ['Combos', 'pair 6 · suited 4 · offsuit 12', 'Each blocker removes combos: one A on the board leaves AK 12, AA 3.', ''],
  ['SPR', 'SPR = stack ÷ pot (on the flop)', 'Commitment. Low SPR (≤ 3): top pair gets it in. High SPR (≥ 10): one pair is a bluff-catcher.', ''],
  ['Geometric sizing', 'f = ((1 + 2S/P)^(1/n) − 1) ÷ 2', 'One bet size (as a pot fraction) that gets stacks S in over n streets.', 'SPR 13 over 3 streets ≈ pot, pot, pot'],
  ['Bluff-catcher calls (indifference)', 'call top P ÷ (P + B) of your bluff-catchers + value', 'Against a balanced bettor, call just enough that his bluffs are indifferent.', ''],
];

export function render(container) {
  container.innerHTML = `<div class="page max-w-3xl space-y-4 fade-up">
    <a href="#learn" class="btn btn-quiet text-sm">${icon('back', 'w-4 h-4')} Learn</a>
    <div><div class="h-sec">Cheat sheet</div><h1 class="h-title">Formula sheet</h1>
      <p class="text-sm text-ink-300 mt-1">P = pot before the bet · B = bet · C = to call · e = equity.</p></div>
    <div class="space-y-2">${ROWS.map(([name, eq, why, anchors]) => `
      <div class="panel px-4 py-3">
        <div class="flex items-baseline justify-between gap-3 flex-wrap"><div class="font-semibold text-white">${name}</div>
          <code class="text-emerald-300 text-sm font-mono">${eq}</code></div>
        <div class="text-sm text-ink-300 mt-1">${why}</div>
        ${anchors ? `<div class="text-xs text-amber-200/90 mt-1.5 num">${anchors}</div>` : ''}
      </div>`).join('')}</div>
  </div>`;
}
