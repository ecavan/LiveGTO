/**
 * Play mode — multi-street hand progression (preflop through river).
 */
import { generatePlayScenario, computeStreetData } from '../engine/scenarios.js';
import { evaluatePreflop, evaluatePostflop } from '../engine/feedback.js';
import { cardToDisplay } from '../engine/cards.js';
import {
  renderPokerTable, renderFeedbackBanner, renderActionButtons,
  renderStrategyBars, renderRangeBreakdown, renderRangeVsRange, renderExplanation, renderRangeGrid,
} from './components.js';
import { getStreak, incrementStreak, resetStreak } from '../state.js';

let scenario = null;
let streetIndex = 0; // 0=preflop, 1=flop, 2=turn, 3=river

const STREETS = ['preflop', 'flop', 'turn', 'river'];

function visibleBoard() {
  if (streetIndex === 0) return [];
  if (streetIndex === 1) return scenario.board.slice(0, 3);
  if (streetIndex === 2) return scenario.board.slice(0, 4);
  return scenario.board.slice(0, 5);
}

function renderStreetIndicator() {
  return `<div class="flex justify-center gap-2 mb-2">
    ${STREETS.map((s, i) => {
      let cls = 'text-gray-600';
      if (i < streetIndex) cls = 'text-emerald-600';
      else if (i === streetIndex) cls = 'text-emerald-400 font-bold';
      return `<span class="text-xs uppercase ${cls}">${s}</span>`;
    }).join('<span class="text-gray-700">></span>')}
  </div>`;
}

function renderDecision(container) {
  const zone = container.querySelector('#scenario-zone');
  const board = visibleBoard();

  if (streetIndex === 0) {
    // Preflop decision
    zone.innerHTML = `<div class="space-y-5 flash-in">
      ${renderStreetIndicator()}
      ${renderPokerTable({ seats: scenario.seats, board: [], dealerSeat: scenario.dealer_seat, situation: scenario.preflop_situation })}
      <p class="text-center text-gray-500 text-sm font-mono">${scenario.hand_key}</p>
      ${renderActionButtons(scenario.preflop_actions, scenario.preflop_action_labels)}
    </div>`;
  } else {
    // Postflop decision
    const boardStrs = scenario.board_strs.slice(0, streetIndex === 1 ? 3 : streetIndex === 2 ? 4 : 5);
    const streetData = computeStreetData(scenario.hand_strs, boardStrs, scenario.postflop_position);
    // Store for answer evaluation
    scenario._currentStreetData = streetData;

    zone.innerHTML = `<div class="space-y-5 flash-in">
      ${renderStreetIndicator()}
      ${renderPokerTable({ seats: scenario.seats, board, dealerSeat: scenario.dealer_seat, pot: scenario.pot + ' BB', situation: streetData.postflop_situation })}
      <div class="text-center text-sm">
        <span class="text-gray-500 font-mono">${scenario.hand_key}</span>
        <span class="mx-2 text-gray-700">|</span>
        <span class="text-gray-400">${streetData.bucket_label}</span>
        <span class="mx-2 text-gray-700">|</span>
        <span class="text-xs text-gray-500 font-mono">${streetData.texture_label}</span>
      </div>
      ${renderActionButtons(streetData.postflop_actions, streetData.postflop_action_labels)}
    </div>`;
  }

  zone.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAnswer(btn.dataset.action, container));
  });
}

function handleAnswer(action, container) {
  const zone = container.querySelector('#scenario-zone');
  let feedback;

  if (streetIndex === 0) {
    // Build preflop scenario object for evaluatePreflop
    const preflopScenario = {
      type: scenario.preflop_type,
      position: scenario.position,
      hand_key: scenario.hand_key,
      correct_action: scenario.preflop_correct,
      range: scenario.preflop_range,
      range_size: scenario.preflop_range_size,
      raise_range: scenario.preflop_raise_range,
      call_range: scenario.preflop_call_range,
      opener: scenario.preflop_opener,
    };
    feedback = evaluatePreflop(action, preflopScenario);
  } else {
    const sd = scenario._currentStreetData;
    const postflopScenario = {
      type: 'postflop',
      position: scenario.postflop_position,
      hand_key: scenario.hand_key,
      bucket: sd.bucket,
      bucket_label: sd.bucket_label,
      texture: sd.texture,
      texture_label: sd.texture_label,
      strategy: sd.strategy,
      correct_actions: sd.correct_actions,
      action_labels: sd.postflop_action_labels,
      range_breakdown: sd.range_breakdown,
      facing_bet: sd.facing_bet,
    };
    feedback = evaluatePostflop(action, postflopScenario);
  }

  if (feedback.is_correct) incrementStreak();
  else resetStreak();

  const board = visibleBoard();
  const isLastStreet = streetIndex >= 3;
  const nextLabel = isLastStreet ? 'Next Hand' : `Continue to ${STREETS[streetIndex + 1]}`;

  let feedbackContent;
  if (streetIndex === 0) {
    feedbackContent = `
      ${renderFeedbackBanner(feedback)}
      <p class="text-center text-gray-400 text-xs">${feedback.explanation}</p>
      ${feedback.range ? renderRangeGrid(feedback.range, feedback.raise_range, feedback.call_range, feedback.hand_key) : ''}`;
  } else {
    feedbackContent = `
      ${renderFeedbackBanner(feedback)}
      <p class="text-center text-gray-400 text-xs">${feedback.explanation}</p>
      ${feedback.range_vs_range ? renderRangeVsRange(feedback.range_vs_range, feedback.bucket) : ''}
      ${feedback.explanation_points ? renderExplanation(feedback.explanation_points) : ''}
      ${feedback.strategy ? renderStrategyBars(feedback.strategy, feedback.correct_actions, feedback.action_labels, feedback.bucket_label) : ''}`;
  }

  zone.innerHTML = `<div class="space-y-5 flash-in">
    ${renderStreetIndicator()}
    ${renderPokerTable({
      seats: scenario.seats, board: board.length ? board : [],
      dealerSeat: scenario.dealer_seat, pot: streetIndex > 0 ? scenario.pot + ' BB' : null,
      situation: streetIndex === 0 ? scenario.preflop_situation : (scenario._currentStreetData?.postflop_situation || ''),
    })}
    <p class="text-center text-gray-500 text-sm font-mono">${scenario.hand_key}</p>
    ${feedbackContent}
    <div class="text-center pt-2">
      <button id="next-btn" class="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition-all text-sm">
        ${nextLabel} &rarr;
      </button>
    </div>
  </div>`;

  zone.querySelector('#next-btn').addEventListener('click', () => {
    if (isLastStreet) {
      newHand(container);
    } else {
      streetIndex++;
      renderDecision(container);
    }
  });
}

function newHand(container) {
  scenario = generatePlayScenario();
  streetIndex = 0;
  renderDecision(container);
}

export function render(container) {
  container.innerHTML = `<div id="scenario-zone" class="flash-in"></div>`;
  newHand(container);
}
