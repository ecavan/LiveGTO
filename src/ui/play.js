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
import { initVillainRange, narrowPreflop, narrowPostflop, getRangeStats } from '../engine/rangeTracker.js';
import { buildGrid } from '../engine/ranges.js';
import { analyzeBlockers } from '../engine/blockers.js';

let scenario = null;
let streetIndex = 0; // 0=preflop, 1=flop, 2=turn, 3=river
let heroRange = null;
let villainRange = null;

const STREETS = ['preflop', 'flop', 'turn', 'river'];

function visibleBoard() {
  if (streetIndex === 0) return [];
  if (streetIndex === 1) return scenario.board.slice(0, 3);
  if (streetIndex === 2) return scenario.board.slice(0, 4);
  return scenario.board.slice(0, 5);
}

function visibleBoardStrs() {
  if (streetIndex === 0) return [];
  if (streetIndex === 1) return scenario.board_strs.slice(0, 3);
  if (streetIndex === 2) return scenario.board_strs.slice(0, 4);
  return scenario.board_strs.slice(0, 5);
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

function renderPlayRanges() {
  const grid = buildGrid();
  const panels = [];

  if (heroRange) {
    const stats = getRangeStats(heroRange);
    let rows = '';
    for (let i = 0; i < 13; i++) {
      let cells = '';
      for (let j = 0; j < 13; j++) {
        const key = grid[i][j];
        const weight = heroRange.get(key) || 0;
        let bg;
        if (weight > 0.05) {
          const alpha = Math.round(weight * 80) / 100;
          bg = `background: rgba(59, 130, 246, ${alpha})`;
        } else {
          bg = 'background: rgba(17, 24, 39, 0.6)';
        }
        cells += `<td class="range-cell border border-gray-800/50" style="${bg}">${key}</td>`;
      }
      rows += `<tr>${cells}</tr>`;
    }
    panels.push(`<details class="bucket-details" open>
      <summary class="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-gray-800/40 rounded-lg transition-colors">
        <span class="text-sm font-semibold text-emerald-400">You (${scenario.position})</span>
        <span class="text-xs text-gray-500">${stats.combos} combos (${stats.pct}%)</span>
      </summary>
      <div class="overflow-x-auto pt-2 pb-1">
        <table class="mx-auto border-collapse">${rows}</table>
      </div>
    </details>`);
  }

  if (villainRange) {
    const stats = getRangeStats(villainRange);
    const villainLabel = scenario.preflop_opener || 'Villain';
    let rows = '';
    for (let i = 0; i < 13; i++) {
      let cells = '';
      for (let j = 0; j < 13; j++) {
        const key = grid[i][j];
        const weight = villainRange.get(key) || 0;
        let bg;
        if (weight > 0.05) {
          const alpha = Math.round(weight * 80) / 100;
          bg = `background: rgba(16, 185, 129, ${alpha})`;
        } else {
          bg = 'background: rgba(17, 24, 39, 0.6)';
        }
        cells += `<td class="range-cell border border-gray-800/50" style="${bg}">${key}</td>`;
      }
      rows += `<tr>${cells}</tr>`;
    }
    panels.push(`<details class="bucket-details">
      <summary class="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-gray-800/40 rounded-lg transition-colors">
        <span class="text-sm font-semibold text-gray-300">${villainLabel}</span>
        <span class="text-xs text-gray-500">${stats.combos} combos (${stats.pct}%)</span>
      </summary>
      <div class="overflow-x-auto pt-2 pb-1">
        <table class="mx-auto border-collapse">${rows}</table>
      </div>
    </details>`);
  }

  if (panels.length === 0) return '';

  const legend = `
    <span class="inline-block w-3 h-3 rounded-sm mr-1 align-middle" style="background: rgba(59,130,246,0.8)"></span> Your range
    <span class="inline-block w-3 h-3 rounded-sm mr-1 ml-2 align-middle" style="background: rgba(16,185,129,0.8)"></span> Villain
    <span class="inline-block w-3 h-3 rounded-sm mr-1 ml-2 align-middle" style="background: rgba(17,24,39,0.6)"></span> Out`;

  return `<div class="bg-gray-900/40 rounded-xl p-3 space-y-2">
    <div class="text-xs text-gray-500 text-center uppercase tracking-wider font-semibold">Estimated Ranges</div>
    <div class="text-xs text-gray-500 text-center">${legend}</div>
    ${panels.join('')}
  </div>`;
}

function renderBlockerChips(insights) {
  if (!insights || insights.length === 0) return '';
  const chips = insights.map(i => {
    const cls = i.impact === 'negative'
      ? 'bg-red-900/40 text-red-400 border-red-800/50'
      : 'bg-amber-900/40 text-amber-400 border-amber-800/50';
    return `<span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${cls} border">${i.text}</span>`;
  }).join('');
  return `<div class="flex flex-wrap justify-center gap-1.5 mt-1">${chips}</div>`;
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
      ${renderPlayRanges()}
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
      ${renderBlockerChips(analyzeBlockers(scenario.hand_strs, boardStrs))}
      ${renderActionButtons(streetData.postflop_actions, streetData.postflop_action_labels)}
      ${renderPlayRanges()}
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

    // Narrow hero range based on preflop action
    if (heroRange) {
      const openerPos = scenario.preflop_opener || null;
      narrowPreflop(heroRange, scenario.position, action, openerPos);
    }
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

    // Narrow hero range based on postflop action
    if (heroRange) {
      const boardStrs = visibleBoardStrs();
      const blocked = new Set(boardStrs);
      narrowPostflop(heroRange, boardStrs, blocked, scenario.postflop_position, action, sd.facing_bet, 0);
    }

    // Narrow villain range based on implied action (villain checked to hero or bet)
    if (villainRange) {
      const boardStrs = visibleBoardStrs();
      const blocked = new Set([...boardStrs, ...scenario.hand_strs]);
      const villainPos = scenario.postflop_position === 'IP' ? 'OOP' : 'IP';
      const villainAction = sd.facing_bet ? 'bet_m' : 'check';
      narrowPostflop(villainRange, boardStrs, blocked, villainPos, villainAction, false, 0.30);
    }
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
      ${renderBlockerChips(analyzeBlockers(scenario.hand_strs, visibleBoardStrs()))}
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
    ${renderPlayRanges()}
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

  // Init hero range from position
  heroRange = initVillainRange(scenario.position);

  // Init villain range — for facing scenarios, villain is the opener
  if (scenario.preflop_opener) {
    villainRange = initVillainRange(scenario.preflop_opener);
    // Villain opened, so narrow to their RFI range (already done by init)
  } else {
    // RFI scenario — no defined villain yet, but one exists at the table
    villainRange = null;
  }

  renderDecision(container);
}

export function render(container) {
  container.innerHTML = `<div id="scenario-zone" class="flash-in"></div>`;
  newHand(container);
}
