/**
 * Preflop drill page — RFI and facing opens.
 */
import { generatePreflop } from '../engine/scenarios.js';
import { evaluatePreflop } from '../engine/feedback.js';
import { renderPokerTable, renderRangeGrid, renderFeedbackBanner, renderActionButtons } from './components.js';
import { getStreak, incrementStreak, resetStreak, getFilterPosition, setFilterPosition } from '../state.js';

let currentScenario = null;

function renderFilters() {
  const filterPos = getFilterPosition();
  const positions = ['UTG', 'MP', 'CO', 'BTN', 'SB'];

  const allClass = !filterPos
    ? 'bg-gray-700 text-white ring-1 ring-gray-500'
    : 'bg-gray-800/60 text-gray-500 hover:text-gray-300';

  let chips = `<button data-filter-pos="" class="filter-chip px-2.5 py-1 text-xs rounded-full transition-all ${allClass}">All</button>`;

  for (const pos of positions) {
    const cls = filterPos === pos
      ? 'bg-emerald-800 text-emerald-300 ring-1 ring-emerald-600'
      : 'bg-gray-800/60 text-gray-500 hover:text-gray-300';
    chips += `<button data-filter-pos="${pos}" class="filter-chip px-2.5 py-1 text-xs rounded-full transition-all ${cls}">${pos}</button>`;
  }

  return `<div class="flex justify-center gap-2 flex-wrap mb-4">${chips}</div>`;
}

function renderScenario(container) {
  const filterPos = getFilterPosition();
  currentScenario = generatePreflop(filterPos);
  const s = currentScenario;

  const zone = container.querySelector('#scenario-zone') || container;
  zone.innerHTML = `<div class="space-y-5 flash-in">
    ${renderPokerTable({ seats: s.seats, board: s.board, dealerSeat: s.dealer_seat, situation: s.situation })}
    <p class="text-center text-gray-500 text-sm font-mono">${s.hand_key}</p>
    ${renderActionButtons(s.actions, s.action_labels)}
  </div>`;

  zone.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAnswer(btn.dataset.action, container));
  });
}

function handleAnswer(action, container) {
  const feedback = evaluatePreflop(action, currentScenario);
  if (feedback.is_correct) incrementStreak();
  else resetStreak();

  const s = currentScenario;
  const zone = container.querySelector('#scenario-zone');

  zone.innerHTML = `<div class="space-y-5 flash-in">
    ${renderPokerTable({ seats: s.seats, board: s.board, dealerSeat: s.dealer_seat, situation: s.situation })}
    <p class="text-center text-gray-500 text-sm font-mono">${s.hand_key}</p>
    ${renderFeedbackBanner(feedback)}
    <p class="text-center text-gray-400 text-xs">${feedback.explanation}</p>
    <div class="text-center pt-2">
      <button id="next-btn" class="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition-all text-sm">
        Next Hand &rarr;
      </button>
    </div>
    ${feedback.range ? renderRangeGrid(feedback.range, feedback.raise_range, feedback.call_range, feedback.hand_key) : ''}
  </div>`;

  zone.querySelector('#next-btn').addEventListener('click', () => renderScenario(container));
}

export function render(container) {
  container.innerHTML = `
    <div id="streak-area" class="hidden"></div>
    ${renderFilters()}
    <div id="scenario-zone" class="flash-in"></div>`;

  // Filter click handlers
  container.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const pos = btn.dataset.filterPos || null;
      setFilterPosition(pos);
      render(container);
    });
  });

  renderScenario(container);
}
