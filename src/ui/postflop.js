/**
 * Postflop drill page — bet sizing and actions.
 */
import { generatePostflop } from '../engine/scenarios.js';
import { evaluatePostflop } from '../engine/feedback.js';
import {
  renderPokerTable, renderFeedbackBanner, renderActionButtons,
  renderStrategyBars, renderRangeBreakdown, renderRangeVsRange, renderExplanation,
} from './components.js';
import { getStreak, incrementStreak, resetStreak, getFilterPosition, setFilterPosition, getFilterTexture, setFilterTexture } from '../state.js';

let currentScenario = null;

function renderFilters() {
  const filterPos = getFilterPosition();
  const filterTex = getFilterTexture();

  // Position filter
  const anyPosClass = !filterPos
    ? 'bg-gray-700 text-white ring-1 ring-gray-500'
    : 'bg-gray-800/60 text-gray-500 hover:text-gray-300';
  let posChips = `<button data-filter-pos="" class="filter-pos px-2.5 py-1 text-xs rounded-full transition-all ${anyPosClass}">Any Pos</button>`;
  for (const pos of ['OOP', 'IP']) {
    const cls = filterPos === pos
      ? 'bg-emerald-800 text-emerald-300 ring-1 ring-emerald-600'
      : 'bg-gray-800/60 text-gray-500 hover:text-gray-300';
    posChips += `<button data-filter-pos="${pos}" class="filter-pos px-2.5 py-1 text-xs rounded-full transition-all ${cls}">${pos}</button>`;
  }

  // Texture filter
  const anyTexClass = !filterTex
    ? 'bg-gray-700 text-white ring-1 ring-gray-500'
    : 'bg-gray-800/60 text-gray-500 hover:text-gray-300';
  const textures = [
    ['monotone', 'Monotone'], ['paired', 'Paired'], ['wet', 'Wet'],
    ['high_dry', 'High Dry'], ['low_dry', 'Low Dry'],
  ];
  let texChips = `<button data-filter-tex="" class="filter-tex px-2.5 py-1 text-xs rounded-full transition-all ${anyTexClass}">Any Board</button>`;
  for (const [key, label] of textures) {
    const cls = filterTex === key
      ? 'bg-amber-800 text-amber-300 ring-1 ring-amber-600'
      : 'bg-gray-800/60 text-gray-500 hover:text-gray-300';
    texChips += `<button data-filter-tex="${key}" class="filter-tex px-2.5 py-1 text-xs rounded-full transition-all ${cls}">${label}</button>`;
  }

  return `<div class="flex justify-center gap-2 flex-wrap mb-3">${posChips}</div>
          <div class="flex justify-center gap-2 flex-wrap mb-4">${texChips}</div>`;
}

function renderScenario(container) {
  const filterPos = getFilterPosition();
  const filterTex = getFilterTexture();
  currentScenario = generatePostflop(filterPos, filterTex);
  const s = currentScenario;

  const zone = container.querySelector('#scenario-zone');
  zone.innerHTML = `<div class="space-y-5 flash-in">
    ${renderPokerTable({
      seats: s.seats, board: s.board, dealerSeat: s.dealer_seat,
      pot: s.pot + ' BB', situation: s.situation, bets: s.bets,
    })}
    <div class="text-center text-sm">
      <span class="text-gray-500 font-mono">${s.hand_key}</span>
      <span class="mx-2 text-gray-700">|</span>
      <span class="text-gray-400">${s.bucket_label}</span>
      <span class="mx-2 text-gray-700">|</span>
      <span class="text-xs text-gray-500 font-mono">${s.texture_label}</span>
    </div>
    ${renderActionButtons(s.actions, s.action_labels)}
  </div>`;

  zone.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAnswer(btn.dataset.action, container));
  });
}

function handleAnswer(action, container) {
  const feedback = evaluatePostflop(action, currentScenario);
  if (feedback.is_correct) incrementStreak();
  else resetStreak();

  const s = currentScenario;
  const zone = container.querySelector('#scenario-zone');

  zone.innerHTML = `<div class="space-y-5 flash-in">
    ${renderPokerTable({
      seats: s.seats, board: s.board, dealerSeat: s.dealer_seat,
      pot: s.pot + ' BB', situation: s.situation, bets: s.bets,
    })}
    <div class="text-center text-sm">
      <span class="text-gray-500 font-mono">${s.hand_key}</span>
      <span class="mx-2 text-gray-700">|</span>
      <span class="text-gray-400">${s.bucket_label}</span>
      <span class="mx-2 text-gray-700">|</span>
      <span class="text-xs text-gray-500 font-mono">${s.texture_label}</span>
    </div>
    ${renderFeedbackBanner(feedback)}
    <p class="text-center text-gray-400 text-xs">${feedback.explanation}</p>
    <div class="text-center pt-2">
      <button id="next-btn" class="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition-all text-sm">
        Next Hand &rarr;
      </button>
    </div>
    ${renderRangeVsRange(feedback.range_vs_range, feedback.bucket)}
    ${renderExplanation(feedback.explanation_points)}
    ${renderStrategyBars(feedback.strategy, feedback.correct_actions, feedback.action_labels, feedback.bucket_label)}
    ${renderRangeBreakdown(feedback.range_breakdown, feedback.action_labels, feedback.texture_label, feedback.bucket)}
  </div>`;

  zone.querySelector('#next-btn').addEventListener('click', () => renderScenario(container));
}

export function render(container) {
  container.innerHTML = `${renderFilters()}<div id="scenario-zone" class="flash-in"></div>`;

  container.querySelectorAll('.filter-pos').forEach(btn => {
    btn.addEventListener('click', () => {
      setFilterPosition(btn.dataset.filterPos || null);
      render(container);
    });
  });
  container.querySelectorAll('.filter-tex').forEach(btn => {
    btn.addEventListener('click', () => {
      setFilterTexture(btn.dataset.filterTex || null);
      render(container);
    });
  });

  renderScenario(container);
}
