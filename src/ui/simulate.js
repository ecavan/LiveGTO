/**
 * Simulate mode — heads-up session with AI villain.
 * Full state machine ported from Flask routes.
 */
import {
  generateSimHand, villainPreflopAct, villainPostflopAct,
  resolveShowdown, getHeroGtoAction, computeDeviation,
  computeSessionReview, applyBetAmount, OPEN_RAISE, THREE_BET,
  generateMultiwayHand, getMultiwayPostflopOrder, resolveMultiwayShowdown,
  POSITIONS_BY_COUNT, SEAT_MAPS,
} from '../engine/simulate.js';
import { renderPokerTable, renderActionButtons } from './components.js';
import { initVillainRange, narrowPreflop, narrowPostflop, getRangeStats } from '../engine/rangeTracker.js';
import { buildGrid } from '../engine/ranges.js';

let simState = null;

function randomPlayerCount() {
  return Math.floor(Math.random() * 5) + 2; // 2-6 players
}

// --- Action log ---

function logAction(state, actor, description) {
  if (!state.action_log) state.action_log = [];
  state.action_log.push({ actor, description, street: state.street });
}

function logStreetTransition(state) {
  if (!state.action_log) state.action_log = [];
  const boardVis = state.board_cards.slice(0, state.board_visible);
  const cardStrs = boardVis.map(c => `${c.rank}${c.suit_symbol}`).join(' ');
  state.action_log.push({ actor: 'system', description: `${state.street}: ${cardStrs}`, street: state.street });
}

function formatBetAction(action, amount) {
  if (action === 'bet_s') return `bets 33% pot (${amount.toFixed(1)} BB)`;
  if (action === 'bet_m') return `bets 66% pot (${amount.toFixed(1)} BB)`;
  if (action === 'bet_l') return `bets pot (${amount.toFixed(1)} BB)`;
  return 'bets';
}

function renderActionLog(log) {
  if (!log || log.length === 0) return '';
  const entries = log.map(entry => {
    if (entry.actor === 'system') {
      return `<div class="text-center text-gray-600 text-xs py-0.5">--- ${entry.description} ---</div>`;
    }
    const color = entry.actor === 'Hero' ? 'text-emerald-400' : 'text-red-400';
    return `<div><span class="text-gray-600">[${entry.street}]</span> <span class="${color}">${entry.actor}</span> ${entry.description}</div>`;
  }).join('');
  return `<div class="bg-gray-900/60 rounded-xl p-3 max-h-40 overflow-y-auto" id="action-log">
    <div class="text-xs space-y-0.5">${entries}</div>
  </div>`;
}

// --- State machine helpers ---

function getAvailableActions(state) {
  if (state.street === 'preflop') {
    const vilAct = state.villain_last_action;
    if (vilAct === 'raise') return ['raise', 'call', 'fold'];
    if (!vilAct && state.hero_is_sb) return ['raise', 'fold'];
    return ['raise', 'call', 'fold'];
  }
  // Postflop
  const vilAct = state.villain_last_action;
  if (vilAct && vilAct !== 'check') return ['fold', 'call', 'raise'];
  return ['check', 'bet_s', 'bet_m', 'bet_l'];
}

function getActionLabels(actions, state) {
  const labels = {};
  for (const a of actions) {
    if (a === 'raise' && state.street === 'preflop' && !state.villain_last_action) labels[a] = 'Raise';
    else if (a === 'raise' && state.street === 'preflop') labels[a] = '3-Bet';
    else if (a === 'raise') labels[a] = 'Raise';
    else if (a === 'bet_s') labels[a] = 'Bet 33%';
    else if (a === 'bet_m') labels[a] = 'Bet 66%';
    else if (a === 'bet_l') labels[a] = 'Bet 100%';
    else labels[a] = a.charAt(0).toUpperCase() + a.slice(1);
  }
  return labels;
}

function advanceStreet(state) {
  if (state.street === 'preflop') { state.street = 'flop'; state.board_visible = 3; }
  else if (state.street === 'flop') { state.street = 'turn'; state.board_visible = 4; }
  else if (state.street === 'turn') { state.street = 'river'; state.board_visible = 5; }

  logStreetTransition(state);

  state.street_bet = 0.0;
  state.hero_street_invested = 0.0;
  state.villain_street_invested = 0.0;
  state.villain_last_action = null;

  // Postflop: OOP acts first. HU: SB=IP, BB=OOP
  state.street_to_act = state.hero_is_sb ? 'villain' : 'hero';
  return state;
}

function endHand(state, winner, fold = false) {
  state.hand_over = true;
  state.winner = winner;

  let winAmount;
  if (winner === 'hero') {
    winAmount = state.pot - state.hero_total_invested;
    state.hero_stack += state.pot;
  } else if (winner === 'villain') {
    winAmount = -state.hero_total_invested;
    state.villain_stack += state.pot;
  } else {
    const half = state.pot / 2;
    winAmount = half - state.hero_total_invested;
    state.hero_stack += half;
    state.villain_stack += half;
  }

  state.sim_phase = fold ? 'hand_over' : 'showdown';
  state.session_log.push({
    hand_num: state.hand_number,
    hero_hand_key: state.hero_hand_key,
    result_bb: Math.round(winAmount * 10) / 10,
    actions: state.current_hand_actions,
  });
  return state;
}

function runVillainTurn(state) {
  const street = state.street;
  const facingBet = state.hero_street_invested > state.villain_street_invested;

  let vAction;
  if (street === 'preflop') {
    vAction = villainPreflopAct(state.villain_hand_key, state.villain_position, facingBet);
  } else {
    const boardVis = state.board_strs.slice(0, state.board_visible);
    const vPos = state.hero_is_sb ? 'OOP' : 'IP';
    vAction = villainPostflopAct(state.villain_hand_strs, boardVis, vPos, facingBet);
  }

  // Apply villain action
  if (vAction === 'fold') {
    logAction(state, 'Villain', 'folds');
    return endHand(state, 'hero', true);
  } else if (vAction === 'call') {
    const callAmount = Math.min(
      state.hero_street_invested - state.villain_street_invested,
      state.villain_stack
    );
    logAction(state, 'Villain', `calls ${callAmount.toFixed(1)} BB`);
    state.villain_stack -= callAmount;
    state.villain_total_invested += callAmount;
    state.villain_street_invested += callAmount;
    state.pot += callAmount;
    state.villain_last_action = 'call';

    if (street === 'preflop' && state.hero_street_invested > 0) {
      state = advanceStreet(state);
      return processNewStreet(state);
    } else if (state.street === 'river') {
      const winner = resolveShowdown(state.hero_hand_strs, state.villain_hand_strs, state.board_strs);
      return endHand(state, winner);
    } else {
      state = advanceStreet(state);
      return processNewStreet(state);
    }
  } else if (vAction === 'check') {
    logAction(state, 'Villain', 'checks');
    state.villain_last_action = 'check';
    state.street_to_act = 'hero';
    if (street !== 'preflop') state.sim_phase = 'postflop_decision';
    return state;
  } else {
    // Bet/raise
    let betAmount;
    if (street === 'preflop') {
      betAmount = facingBet ? THREE_BET : OPEN_RAISE;
    } else {
      betAmount = applyBetAmount(state.pot, vAction);
    }
    const additional = Math.min(betAmount - state.villain_street_invested, state.villain_stack);
    state.villain_stack -= additional;
    state.villain_total_invested += additional;
    state.villain_street_invested += additional;
    state.pot += additional;
    state.street_bet = state.villain_street_invested;
    state.villain_last_action = vAction.includes('bet') ? vAction : 'raise';

    if (street === 'preflop') {
      logAction(state, 'Villain', `raises to ${state.villain_street_invested.toFixed(1)} BB`);
    } else if (vAction.includes('bet')) {
      logAction(state, 'Villain', formatBetAction(vAction, additional));
    } else {
      logAction(state, 'Villain', `raises to ${state.villain_street_invested.toFixed(1)} BB`);
    }

    state.street_to_act = 'hero';
    state.sim_phase = street === 'preflop' ? 'preflop_decision' : 'postflop_decision';
    return state;
  }
}

function processNewStreet(state) {
  if (state.street_to_act === 'villain') {
    return runVillainTurn(state);
  }
  state.sim_phase = 'postflop_decision';
  return state;
}

function processHeroAction(state, heroAction) {
  const street = state.street;
  const facingBet = (state.villain_last_action && state.villain_last_action !== 'check'
    && ['raise', 'bet_s', 'bet_m', 'bet_l'].includes(state.villain_last_action));

  // Track GTO deviation
  const boardVis = state.board_visible > 0 ? state.board_strs.slice(0, state.board_visible) : null;
  const gtoAction = getHeroGtoAction(
    state.hero_hand_key, state.hero_position, street,
    state.hero_hand_strs, boardVis, facingBet,
  );
  const dev = computeDeviation(heroAction, gtoAction);
  state.current_hand_actions.push({ street, action: heroAction, gto_action: gtoAction, deviation: dev });

  if (heroAction === 'fold') {
    logAction(state, 'Hero', 'folds');
    return endHand(state, 'villain', true);
  } else if (heroAction === 'call') {
    const callAmount = Math.min(
      state.villain_street_invested - state.hero_street_invested,
      state.hero_stack
    );
    logAction(state, 'Hero', `calls ${callAmount.toFixed(1)} BB`);
    state.hero_stack -= callAmount;
    state.hero_total_invested += callAmount;
    state.hero_street_invested += callAmount;
    state.pot += callAmount;

    if (state.street === 'river') {
      const winner = resolveShowdown(state.hero_hand_strs, state.villain_hand_strs, state.board_strs);
      return endHand(state, winner);
    }
    state = advanceStreet(state);
    return processNewStreet(state);
  } else if (heroAction === 'check') {
    logAction(state, 'Hero', 'checks');
    state.villain_last_action = null;
    if (state.hero_is_sb && street !== 'preflop') {
      // Hero is IP, checked back
      if (state.street === 'river') {
        const winner = resolveShowdown(state.hero_hand_strs, state.villain_hand_strs, state.board_strs);
        return endHand(state, winner);
      }
      state = advanceStreet(state);
      return processNewStreet(state);
    } else {
      // Hero is OOP or preflop, villain acts
      state.street_to_act = 'villain';
      return runVillainTurn(state);
    }
  } else {
    // Bet/raise
    let betAmount;
    if (street === 'preflop') {
      betAmount = facingBet ? THREE_BET : OPEN_RAISE;
    } else {
      betAmount = applyBetAmount(state.pot, heroAction);
    }
    const additional = Math.min(betAmount - state.hero_street_invested, state.hero_stack);
    state.hero_stack -= additional;
    state.hero_total_invested += additional;
    state.hero_street_invested += additional;
    state.pot += additional;
    state.street_bet = state.hero_street_invested;

    if (street === 'preflop') {
      logAction(state, 'Hero', `raises to ${state.hero_street_invested.toFixed(1)} BB`);
    } else if (heroAction.includes('bet')) {
      logAction(state, 'Hero', formatBetAction(heroAction, additional));
    } else {
      logAction(state, 'Hero', `raises to ${state.hero_street_invested.toFixed(1)} BB`);
    }

    state.street_to_act = 'villain';
    return runVillainTurn(state);
  }
}

// --- Rendering ---

function buildSimSeats(state) {
  const showVillain = state.sim_phase === 'showdown';
  const heroSeat = {
    position: state.hero_position,
    is_hero: true, is_active: true,
    cards: state.hero_hand,
    stack: (state.hero_stack).toFixed(1),
  };
  const villainSeat = {
    position: state.villain_position,
    is_hero: false,
    is_active: !state.hand_over || showVillain,
    cards: showVillain ? state.villain_hand : null,
    show_cards: showVillain,
    stack: (state.villain_stack).toFixed(1),
  };
  const empty = { position: '', is_hero: false, is_active: false, cards: null };
  return [heroSeat, empty, empty, villainSeat, empty, empty];
}

function updateHeader(state) {
  const handNum = document.getElementById('hand-num');
  const heroStack = document.getElementById('hero-stack');
  if (handNum) handNum.textContent = state.hand_number;
  if (state.multiway) {
    const hero = state.players[state.hero_idx];
    if (heroStack) heroStack.textContent = `${(hero.stack + hero.total_invested).toFixed(1)} bb`;
  } else {
    if (heroStack) heroStack.textContent = `${(state.hero_stack + state.hero_total_invested).toFixed(1)} bb`;
  }
}

function renderSimHand(container) {
  const state = simState;
  const zone = container.querySelector('#sim-zone');
  const visBoard = state.board_visible > 0 ? state.board_cards.slice(0, state.board_visible) : [];
  const seats = buildSimSeats(state);
  const dealerSeat = state.hero_is_sb ? 0 : 3;
  const streetLabel = state.street === 'preflop' ? 'Preflop' : state.street.charAt(0).toUpperCase() + state.street.slice(1);

  // Street indicator
  let streetIndicator = '';
  if (state.street !== 'preflop') {
    let streetColor;
    if (state.street === 'flop') streetColor = 'bg-emerald-900/40 text-emerald-400';
    else if (state.street === 'turn') streetColor = 'bg-blue-900/40 text-blue-400';
    else streetColor = 'bg-purple-900/40 text-purple-400';
    streetIndicator = `<div class="text-center">
      <span class="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${streetColor}">${state.street}</span>
    </div>`;
  }

  // Villain action message
  let villainMsg = '';
  if (state.villain_last_action && !state.hand_over) {
    const va = state.villain_last_action;
    let suffix = '';
    if (va === 'raise') suffix = state.street === 'preflop' ? 'd to 2.5 BB' : 's';
    else if (va === 'call') suffix = 'ed';
    else if (va === 'check') suffix = 's';
    else if (va.includes('bet')) suffix = 's';
    villainMsg = `<p class="text-center text-xs text-gray-500">Villain ${va}${suffix}.</p>`;
  }

  // Phase-specific content
  let phaseContent = '';

  if (state.sim_phase === 'preflop_decision' || state.sim_phase === 'postflop_decision') {
    const actions = getAvailableActions(state);
    const labels = getActionLabels(actions, state);
    phaseContent = `${villainMsg}${renderActionButtons(actions, labels)}`;
  } else if (state.sim_phase === 'showdown') {
    const pot = state.pot.toFixed(1);
    let resultHtml;
    if (state.winner === 'hero') {
      resultHtml = `<span class="text-emerald-400 text-2xl font-bold">&#10003;</span>
        <span class="text-emerald-400 font-semibold">You win ${pot} BB!</span>`;
    } else if (state.winner === 'villain') {
      resultHtml = `<span class="text-red-400 text-2xl font-bold">&#10007;</span>
        <span class="text-red-400 font-semibold">Villain wins ${pot} BB</span>`;
    } else {
      resultHtml = `<span class="text-gray-400 text-2xl font-bold">=</span>
        <span class="text-gray-400 font-semibold">Split pot</span>`;
    }
    phaseContent = `<div class="text-center space-y-2">
      <div class="flex items-center justify-center gap-2">${resultHtml}</div>
      <p class="text-xs text-gray-500">Villain had ${state.villain_hand_key}</p>
    </div>
    <div class="flex justify-center gap-3 pt-2">
      <button id="next-hand-btn" class="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition-all text-sm">Next Hand &rarr;</button>
      <button id="end-session-btn" class="px-6 py-3 bg-gray-900 hover:bg-gray-800 rounded-lg text-gray-400 transition-all text-sm border border-gray-800">End Session</button>
    </div>`;
  } else if (state.sim_phase === 'hand_over') {
    let resultHtml;
    if (state.winner === 'hero') {
      resultHtml = `<span class="text-emerald-400 text-xl font-bold">&#10003;</span>
        <span class="text-emerald-400 font-semibold text-sm">Villain folds. You win ${state.pot.toFixed(1)} BB</span>`;
    } else {
      resultHtml = `<span class="text-red-400 text-xl font-bold">&#10007;</span>
        <span class="text-red-400 font-semibold text-sm">You fold</span>`;
    }
    phaseContent = `<div class="text-center space-y-2">
      <div class="flex items-center justify-center gap-2">${resultHtml}</div>
    </div>
    <div class="flex justify-center gap-3 pt-2">
      <button id="next-hand-btn" class="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition-all text-sm">Next Hand &rarr;</button>
      <button id="end-session-btn" class="px-6 py-3 bg-gray-900 hover:bg-gray-800 rounded-lg text-gray-400 transition-all text-sm border border-gray-800">End Session</button>
    </div>`;
  }

  // Build bets for chip display
  const bets = {};
  if (state.hero_street_invested > 0) bets[0] = state.hero_street_invested.toFixed(1);
  if (state.villain_street_invested > 0) bets[3] = state.villain_street_invested.toFixed(1);

  zone.innerHTML = `<div class="space-y-5 flash-in">
    ${renderPokerTable({ seats, board: visBoard, dealerSeat, pot: state.pot.toFixed(1) + ' BB', situation: streetLabel, bets })}
    ${streetIndicator}
    <div class="text-center text-sm">
      <span class="text-gray-500 font-mono">${state.hero_hand_key}</span>
      <span class="mx-2 text-gray-700">|</span>
      <span class="text-gray-400">${state.hero_position}</span>
      <span class="mx-2 text-gray-700">|</span>
      <span class="text-xs text-gray-500">Pot: ${state.pot.toFixed(1)} BB</span>
    </div>
    ${phaseContent}
    ${renderActionLog(state.action_log)}
  </div>`;

  updateHeader(state);

  // Auto-scroll action log to bottom
  const logEl = zone.querySelector('#action-log');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;

  // Bind action buttons
  zone.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      simState = processHeroAction(simState, btn.dataset.action);
      renderSimHand(container);
    });
  });

  // Bind next hand / end session buttons
  const nextBtn = zone.querySelector('#next-hand-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const heroStack = simState.hero_stack;
      const villainStack = simState.villain_stack;
      const handNumber = simState.hand_number + 1;
      const heroIsSb = !simState.hero_is_sb;
      const sessionLog = simState.session_log;

      simState = generateSimHand(heroStack, villainStack, handNumber, heroIsSb);
      simState.session_log = sessionLog;
      simState.action_log = [];

      if (simState.street_to_act === 'villain') {
        simState = runVillainTurn(simState);
      }
      renderSimHand(container);
    });
  }

  const endBtn = zone.querySelector('#end-session-btn');
  if (endBtn) {
    endBtn.addEventListener('click', () => renderSessionReview(container));
  }
}

function renderSessionReview(container) {
  const review = computeSessionReview(simState.session_log);
  const zone = container.querySelector('#sim-zone');

  let plColor;
  if (review.total_pl > 0) plColor = 'text-emerald-400';
  else if (review.total_pl < 0) plColor = 'text-red-400';
  else plColor = 'text-gray-400';

  let mistakesHtml;
  if (review.top_mistakes.length > 0) {
    const rows = review.top_mistakes.map(m => `
      <div class="flex items-center gap-3 text-sm">
        <span class="text-red-400 font-mono text-xs w-8">${Math.round(m.deviation * 100)}%</span>
        <span class="text-gray-400">
          Hand #${m.hand_num}: ${m.hero_hand} on ${m.street}
          — played <span class="text-red-400">${m.hero_action}</span>,
          GTO says <span class="text-emerald-400">${m.gto_action}</span>
        </span>
      </div>`).join('');

    mistakesHtml = `<div class="bg-gray-900/60 rounded-xl p-4">
      <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Top Mistakes</h3>
      <div class="space-y-2">${rows}</div>
    </div>`;
  } else {
    mistakesHtml = '<p class="text-center text-gray-500 text-sm">No significant mistakes detected!</p>';
  }

  zone.innerHTML = `<div class="space-y-6 flash-in max-w-lg mx-auto">
    <h2 class="text-xl font-bold text-center">Session Review</h2>
    <div class="text-center">
      <div class="text-4xl font-bold font-mono ${plColor}">
        ${review.total_pl > 0 ? '+' : ''}${review.total_pl} BB
      </div>
      <p class="text-xs text-gray-500 mt-1">
        ${review.hands_played} hands | ${review.bb_per_hand} BB/hand
      </p>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div class="bg-gray-900/60 rounded-lg p-3 text-center">
        <div class="text-emerald-400 font-bold font-mono">+${review.biggest_win}</div>
        <div class="text-xs text-gray-500">Biggest Win</div>
      </div>
      <div class="bg-gray-900/60 rounded-lg p-3 text-center">
        <div class="text-red-400 font-bold font-mono">${review.biggest_loss}</div>
        <div class="text-xs text-gray-500">Biggest Loss</div>
      </div>
    </div>
    ${mistakesHtml}
    <div class="flex justify-center gap-3 pt-2">
      <button id="play-again-btn" class="px-8 py-3 bg-emerald-800 hover:bg-emerald-700 rounded-lg font-semibold transition-all text-sm">Play Again</button>
      <a href="#home" class="px-6 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400 transition-all text-sm">Home</a>
    </div>
  </div>`;

  zone.querySelector('#play-again-btn')?.addEventListener('click', () => render(container));
}

// =================================================================
// Multiway simulate mode (3-6 players)
// =================================================================

function mwLogAction(state, actorName, description) {
  state.action_log.push({ actor: actorName, description, street: state.street });
}

function mwLogStreetTransition(state) {
  const boardVis = state.board_cards.slice(0, state.board_visible);
  const cardStrs = boardVis.map(c => `${c.rank}${c.suit_symbol}`).join(' ');
  state.action_log.push({ actor: 'system', description: `${state.street}: ${cardStrs}`, street: state.street });
}

function mwAdvanceStreet(state) {
  if (state.street === 'preflop') { state.street = 'flop'; state.board_visible = 3; }
  else if (state.street === 'flop') { state.street = 'turn'; state.board_visible = 4; }
  else if (state.street === 'turn') { state.street = 'river'; state.board_visible = 5; }

  mwLogStreetTransition(state);
  state.current_bet = 0;
  state.last_raiser_idx = -1;
  for (const p of state.players) { p.street_invested = 0; }
  state.action_queue = getMultiwayPostflopOrder(state.players, state.dealer_player_idx);
  state.action_queue_pos = 0;
  return state;
}

function mwActivePlayers(state) {
  return state.players.filter(p => !p.folded);
}

function mwEndHand(state, winnerIdxs, fold = false) {
  state.hand_over = true;
  state.winner_idxs = winnerIdxs;
  state.winner_idx = winnerIdxs[0];

  const hero = state.players[state.hero_idx];
  const share = winnerIdxs.includes(state.hero_idx) ? state.pot / winnerIdxs.length : 0;
  const winAmount = share - hero.total_invested;

  // Distribute pot
  if (winnerIdxs.length > 0) {
    const perPlayer = state.pot / winnerIdxs.length;
    for (const idx of winnerIdxs) {
      state.players[idx].stack += perPlayer;
    }
  }

  state.sim_phase = fold ? 'hand_over' : 'showdown';
  state.session_log.push({
    hand_num: state.hand_number,
    hero_hand_key: hero.hand_key,
    result_bb: Math.round(winAmount * 10) / 10,
    actions: state.current_hand_actions,
  });
  return state;
}

function mwVillainAct(state, playerIdx) {
  const player = state.players[playerIdx];
  const street = state.street;
  const facingBet = state.current_bet > player.street_invested;
  const actorName = `V${playerIdx} (${player.position})`;

  let action;
  if (street === 'preflop') {
    action = villainPreflopAct(player.hand_key, player.position, facingBet);
  } else {
    const boardVis = state.board_strs.slice(0, state.board_visible);
    const ipPositions = new Set(['BTN', 'CO']);
    const vPos = ipPositions.has(player.position) ? 'IP' : 'OOP';
    action = villainPostflopAct(player.hand_strs, boardVis, vPos, facingBet);
  }

  state = mwApplyAction(state, playerIdx, action, actorName);

  // Narrow villain's estimated range based on action
  if (!player.is_hero && player.estimated_range && !player.folded) {
    if (street === 'preflop') {
      const openerPos = state.opener_idx >= 0 ? state.players[state.opener_idx].position : null;
      const preflopAction = state.last_raiser_idx === playerIdx ? 'raise' : action;
      narrowPreflop(player.estimated_range, player.position, preflopAction, openerPos);
    } else {
      const boardVis = state.board_strs.slice(0, state.board_visible);
      const hero = state.players[state.hero_idx];
      const blocked = new Set([...boardVis, ...hero.hand_strs]);
      const ipPositions = new Set(['BTN', 'CO']);
      const posLabel = ipPositions.has(player.position) ? 'IP' : 'OOP';
      narrowPostflop(player.estimated_range, boardVis, blocked, posLabel, action, facingBet);
    }
  }

  return state;
}

function mwApplyAction(state, playerIdx, action, actorName) {
  const player = state.players[playerIdx];

  if (action === 'fold') {
    player.folded = true;
    mwLogAction(state, actorName, 'folds');

    // Check if only one player remains
    const active = mwActivePlayers(state);
    if (active.length === 1) {
      return mwEndHand(state, [active[0].idx], true);
    }
    return state;
  }

  if (action === 'call') {
    const callAmount = Math.min(state.current_bet - player.street_invested, player.stack);
    player.stack -= callAmount;
    player.total_invested += callAmount;
    player.street_invested += callAmount;
    state.pot += callAmount;
    mwLogAction(state, actorName, `calls ${callAmount.toFixed(1)} BB`);
    return state;
  }

  if (action === 'check') {
    mwLogAction(state, actorName, 'checks');
    return state;
  }

  // Bet or raise
  let betAmount;
  if (state.street === 'preflop') {
    betAmount = state.current_bet > 0 && state.last_raiser_idx >= 0 ? THREE_BET : OPEN_RAISE;
  } else {
    betAmount = applyBetAmount(state.pot, action);
    if (state.current_bet > 0) betAmount = Math.max(betAmount, state.current_bet * 2.5);
  }

  const additional = Math.min(betAmount - player.street_invested, player.stack);
  player.stack -= additional;
  player.total_invested += additional;
  player.street_invested += additional;
  state.pot += additional;
  state.current_bet = player.street_invested;
  // Track first preflop raiser as opener (for FACING_OPEN lookups)
  if (state.street === 'preflop' && state.opener_idx < 0) {
    state.opener_idx = playerIdx;
  }
  state.last_raiser_idx = playerIdx;

  if (action.includes('bet')) {
    mwLogAction(state, actorName, formatBetAction(action, additional));
  } else {
    mwLogAction(state, actorName, `raises to ${player.street_invested.toFixed(1)} BB`);
  }

  return state;
}

function mwRunUntilHero(state) {
  // Process villain actions until it's hero's turn or hand ends
  while (state.action_queue_pos < state.action_queue.length && !state.hand_over) {
    const currentIdx = state.action_queue[state.action_queue_pos];
    const player = state.players[currentIdx];

    if (player.folded) {
      state.action_queue_pos++;
      continue;
    }

    if (player.is_hero) {
      // Hero's turn - stop and wait for input
      const facingBet = state.current_bet > player.street_invested;
      state.sim_phase = state.street === 'preflop' ? 'preflop_decision' : 'postflop_decision';
      return state;
    }

    // Villain acts
    state = mwVillainAct(state, currentIdx);
    if (state.hand_over) return state;

    // If this villain raised, everyone else needs to act again
    if (state.last_raiser_idx === currentIdx) {
      // Rebuild the remaining queue: everyone who hasn't folded and hasn't matched the bet
      const newQueue = [];
      const n = state.num_players;
      for (let i = 1; i < n; i++) {
        const idx = (currentIdx + i) % n;
        if (!state.players[idx].folded && idx !== currentIdx) {
          newQueue.push(idx);
        }
      }
      state.action_queue = newQueue;
      state.action_queue_pos = 0;
      continue;
    }

    state.action_queue_pos++;
  }

  if (state.hand_over) return state;

  // Everyone has acted for this round — advance street or showdown
  return mwFinishRound(state);
}

function mwFinishRound(state) {
  const active = mwActivePlayers(state);
  if (active.length === 1) {
    return mwEndHand(state, [active[0].idx], true);
  }

  if (state.street === 'river') {
    const { winner_idxs } = resolveMultiwayShowdown(state.players, state.board_strs);
    return mwEndHand(state, winner_idxs);
  }

  // Advance to next street
  state = mwAdvanceStreet(state);
  return mwRunUntilHero(state);
}

function mwProcessHeroAction(state, heroAction) {
  const hero = state.players[state.hero_idx];
  const actorName = `Hero (${hero.position})`;
  const facingBet = state.current_bet > hero.street_invested;

  // Track GTO deviation
  const boardVis = state.board_visible > 0 ? state.board_strs.slice(0, state.board_visible) : null;
  const gtoAction = getHeroGtoAction(
    hero.hand_key, hero.position, state.street,
    hero.hand_strs, boardVis, facingBet,
  );
  const dev = computeDeviation(heroAction, gtoAction);
  state.current_hand_actions.push({ street: state.street, action: heroAction, gto_action: gtoAction, deviation: dev });

  const wasRaiser = state.last_raiser_idx;
  state = mwApplyAction(state, state.hero_idx, heroAction, actorName);
  if (state.hand_over) return state;

  // If hero raised, rebuild action queue for remaining players
  if (state.last_raiser_idx === state.hero_idx && state.last_raiser_idx !== wasRaiser) {
    const newQueue = [];
    const n = state.num_players;
    for (let i = 1; i < n; i++) {
      const idx = (state.hero_idx + i) % n;
      if (!state.players[idx].folded) newQueue.push(idx);
    }
    state.action_queue = newQueue;
    state.action_queue_pos = 0;
  } else {
    state.action_queue_pos++;
  }

  // Continue running villains
  return mwRunUntilHero(state);
}

function mwGetAvailableActions(state) {
  const hero = state.players[state.hero_idx];
  const facingBet = state.current_bet > hero.street_invested;

  if (state.street === 'preflop') {
    if (facingBet) return ['raise', 'call', 'fold'];
    return ['raise', 'fold'];
  }
  if (facingBet) return ['fold', 'call', 'raise'];
  return ['check', 'bet_s', 'bet_m', 'bet_l'];
}

function buildMultiwaySeats(state) {
  const seatMap = SEAT_MAPS[state.num_players];
  const showdown = state.sim_phase === 'showdown';
  const seats = [];

  for (let s = 0; s < 6; s++) {
    const playerI = seatMap.indexOf(s);
    if (playerI === -1) {
      seats.push({ position: '', is_hero: false, is_active: false, cards: null });
      continue;
    }
    const p = state.players[playerI];
    seats.push({
      position: p.position,
      is_hero: p.is_hero,
      is_active: !p.folded && (!state.hand_over || showdown),
      cards: p.is_hero || showdown ? p.hand_cards : null,
      show_cards: showdown && !p.folded,
      stack: p.stack.toFixed(1),
    });
  }
  return seats;
}

function renderVillainRanges(state) {
  const villains = state.players.filter(p => !p.is_hero && !p.folded && p.estimated_range);
  if (villains.length === 0) return '';

  const grid = buildGrid();
  const hero = state.players[state.hero_idx];

  const panels = villains.map((v, vi) => {
    const stats = getRangeStats(v.estimated_range);
    const isFirst = vi === 0;

    let rows = '';
    for (let i = 0; i < 13; i++) {
      let cells = '';
      for (let j = 0; j < 13; j++) {
        const key = grid[i][j];
        const weight = v.estimated_range.get(key) || 0;
        const isHero = key === hero.hand_key;
        const heroClass = isHero ? 'range-cell-hero' : '';

        let bg;
        if (weight > 0.05) {
          const alpha = Math.round(weight * 80) / 100; // 0.01 to 0.80
          bg = `background: rgba(16, 185, 129, ${alpha})`;
        } else {
          bg = 'background: rgba(17, 24, 39, 0.6)';
        }

        cells += `<td class="range-cell border border-gray-800/50 ${heroClass}" style="${bg}">${key}</td>`;
      }
      rows += `<tr>${cells}</tr>`;
    }

    return `<details class="bucket-details" ${isFirst ? 'open' : ''}>
      <summary class="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-gray-800/40 rounded-lg transition-colors">
        <span class="text-sm font-semibold text-gray-300">${v.position}</span>
        <span class="text-xs text-gray-500">${stats.combos} combos (${stats.pct}%)</span>
      </summary>
      <div class="overflow-x-auto pt-2 pb-1">
        <table class="mx-auto border-collapse">${rows}</table>
      </div>
    </details>`;
  }).join('');

  const legend = `
    <span class="inline-block w-3 h-3 rounded-sm mr-1 align-middle" style="background: rgba(16,185,129,0.8)"></span> Likely
    <span class="inline-block w-3 h-3 rounded-sm mr-1 ml-2 align-middle" style="background: rgba(16,185,129,0.3)"></span> Possible
    <span class="inline-block w-3 h-3 rounded-sm mr-1 ml-2 align-middle" style="background: rgba(17,24,39,0.6)"></span> Out
    <span class="inline-block w-3 h-3 rounded-sm mr-1 ml-2 align-middle" style="outline: 2px solid #facc15; background: rgba(250,204,21,0.25);"></span> You`;

  return `<div class="bg-gray-900/40 rounded-xl p-3 space-y-2">
    <div class="text-xs text-gray-500 text-center uppercase tracking-wider font-semibold">Estimated Ranges</div>
    <div class="text-xs text-gray-500 text-center">${legend}</div>
    ${panels}
  </div>`;
}

function renderMultiwayHand(container) {
  const state = simState;
  const zone = container.querySelector('#sim-zone');
  const visBoard = state.board_visible > 0 ? state.board_cards.slice(0, state.board_visible) : [];
  const seats = buildMultiwaySeats(state);
  const seatMap = SEAT_MAPS[state.num_players];
  const dealerSeat = seatMap[state.players.findIndex(p => p.idx === state.dealer_player_idx)];
  const streetLabel = state.street === 'preflop' ? 'Preflop' : state.street.charAt(0).toUpperCase() + state.street.slice(1);
  const hero = state.players[state.hero_idx];

  let streetIndicator = '';
  if (state.street !== 'preflop') {
    let streetColor;
    if (state.street === 'flop') streetColor = 'bg-emerald-900/40 text-emerald-400';
    else if (state.street === 'turn') streetColor = 'bg-blue-900/40 text-blue-400';
    else streetColor = 'bg-purple-900/40 text-purple-400';
    streetIndicator = `<div class="text-center"><span class="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${streetColor}">${state.street}</span></div>`;
  }

  // Build bets
  const bets = {};
  for (let i = 0; i < state.num_players; i++) {
    if (state.players[i].street_invested > 0) {
      bets[seatMap[i]] = state.players[i].street_invested.toFixed(1);
    }
  }

  let phaseContent = '';
  if (state.sim_phase === 'preflop_decision' || state.sim_phase === 'postflop_decision') {
    const actions = mwGetAvailableActions(state);
    const labels = getActionLabels(actions, state);
    phaseContent = renderActionButtons(actions, labels);
  } else if (state.sim_phase === 'showdown') {
    const pot = state.pot.toFixed(1);
    const heroWon = state.winner_idxs.includes(state.hero_idx);
    const splitWin = state.winner_idxs.length > 1;
    let resultHtml;
    if (heroWon && !splitWin) {
      resultHtml = `<span class="text-emerald-400 text-2xl font-bold">&#10003;</span>
        <span class="text-emerald-400 font-semibold">You win ${pot} BB!</span>`;
    } else if (heroWon && splitWin) {
      const share = (state.pot / state.winner_idxs.length).toFixed(1);
      resultHtml = `<span class="text-gray-400 text-2xl font-bold">=</span>
        <span class="text-gray-400 font-semibold">Split pot — you get ${share} BB</span>`;
    } else {
      const winnerPos = state.players[state.winner_idxs[0]]?.position || '?';
      resultHtml = `<span class="text-red-400 text-2xl font-bold">&#10007;</span>
        <span class="text-red-400 font-semibold">${winnerPos} wins ${pot} BB</span>`;
    }
    const villainHandsHtml = state.players.filter(p => !p.is_hero && !p.folded)
      .map(p => `<span class="text-gray-400">${p.position}: ${p.hand_key}</span>`).join(' | ');
    phaseContent = `<div class="text-center space-y-2">
      <div class="flex items-center justify-center gap-2">${resultHtml}</div>
      <p class="text-xs text-gray-500">${villainHandsHtml}</p>
    </div>
    <div class="flex justify-center gap-3 pt-2">
      <button id="next-hand-btn" class="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition-all text-sm">Next Hand &rarr;</button>
      <button id="end-session-btn" class="px-6 py-3 bg-gray-900 hover:bg-gray-800 rounded-lg text-gray-400 transition-all text-sm border border-gray-800">End Session</button>
    </div>`;
  } else if (state.sim_phase === 'hand_over') {
    const heroWon = state.winner_idxs.includes(state.hero_idx);
    let resultHtml;
    if (heroWon) {
      resultHtml = `<span class="text-emerald-400 text-xl font-bold">&#10003;</span>
        <span class="text-emerald-400 font-semibold text-sm">Everyone folds. You win ${state.pot.toFixed(1)} BB</span>`;
    } else if (hero.folded) {
      resultHtml = `<span class="text-red-400 text-xl font-bold">&#10007;</span>
        <span class="text-red-400 font-semibold text-sm">You fold</span>`;
    } else {
      const winnerPos = state.players[state.winner_idxs[0]]?.position || '?';
      resultHtml = `<span class="text-red-400 text-xl font-bold">&#10007;</span>
        <span class="text-red-400 font-semibold text-sm">${winnerPos} wins — others fold</span>`;
    }
    phaseContent = `<div class="text-center space-y-2">
      <div class="flex items-center justify-center gap-2">${resultHtml}</div>
    </div>
    <div class="flex justify-center gap-3 pt-2">
      <button id="next-hand-btn" class="px-8 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg font-semibold transition-all text-sm">Next Hand &rarr;</button>
      <button id="end-session-btn" class="px-6 py-3 bg-gray-900 hover:bg-gray-800 rounded-lg text-gray-400 transition-all text-sm border border-gray-800">End Session</button>
    </div>`;
  }

  zone.innerHTML = `<div class="space-y-5 flash-in">
    ${renderPokerTable({ seats, board: visBoard, dealerSeat, pot: state.pot.toFixed(1) + ' BB', situation: `${state.num_players}-max ${streetLabel}`, bets })}
    ${streetIndicator}
    <div class="text-center text-sm">
      <span class="text-gray-500 font-mono">${hero.hand_key}</span>
      <span class="mx-2 text-gray-700">|</span>
      <span class="text-gray-400">${hero.position}</span>
      <span class="mx-2 text-gray-700">|</span>
      <span class="text-xs text-gray-500">Pot: ${state.pot.toFixed(1)} BB</span>
    </div>
    ${phaseContent}
    ${renderVillainRanges(state)}
    ${renderActionLog(state.action_log)}
  </div>`;

  updateHeader(state);
  const logEl = zone.querySelector('#action-log');
  if (logEl) logEl.scrollTop = logEl.scrollHeight;

  // Bind action buttons
  zone.querySelectorAll('.action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      simState = mwProcessHeroAction(simState, btn.dataset.action);
      renderMultiwayHand(container);
    });
  });

  // Next hand / end session
  const nextBtn = zone.querySelector('#next-hand-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const handNumber = simState.hand_number + 1;
      const sessionLog = simState.session_log;
      const numPlayers = randomPlayerCount();
      const stacks = Array(numPlayers).fill(100.0);
      const heroOffset = Math.floor(Math.random() * numPlayers);

      simState = generateMultiwayHand(numPlayers, stacks, handNumber, heroOffset);
      simState.session_log = sessionLog;
      initRangesForState(simState);
      simState = mwRunUntilHero(simState);
      renderMultiwayHand(container);
    });
  }

  const endBtn = zone.querySelector('#end-session-btn');
  if (endBtn) {
    endBtn.addEventListener('click', () => renderSessionReview(container));
  }
}

function initRangesForState(state) {
  for (const p of state.players) {
    p.estimated_range = p.is_hero ? null : initVillainRange(p.position);
  }
}

function startMultiwaySession(container, numPlayers) {
  const stacks = Array(numPlayers).fill(100.0);
  simState = generateMultiwayHand(numPlayers, stacks, 1, 0);
  initRangesForState(simState);
  simState = mwRunUntilHero(simState);
  renderMultiwayHand(container);
}

// --- Entry point ---

export function render(container) {
  const streakDisplay = document.getElementById('streak-display');
  if (streakDisplay) {
    streakDisplay.innerHTML = `<span class="text-gray-400 font-mono text-sm">
      <span class="text-gray-500">Hand</span>
      <span id="hand-num" class="ml-1 font-bold">1</span>
      <span class="mx-2 text-gray-700">|</span>
      <span id="hero-stack" class="text-emerald-400 font-bold">100.0 bb</span>
    </span>`;
  }

  container.innerHTML = '<div id="sim-zone" class="flash-in"></div>';
  startMultiwaySession(container, randomPlayerCount());
}
