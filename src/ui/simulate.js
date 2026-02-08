/**
 * Simulate mode — heads-up session with AI villain.
 * Full state machine ported from Flask routes.
 */
import {
  generateSimHand, villainPreflopAct, villainPostflopAct,
  resolveShowdown, getHeroGtoAction, computeDeviation,
  computeSessionReview, applyBetAmount, OPEN_RAISE, THREE_BET,
} from '../engine/simulate.js';
import { renderPokerTable, renderActionButtons } from './components.js';

let simState = null;

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
    return endHand(state, 'hero', true);
  } else if (vAction === 'call') {
    const callAmount = Math.min(
      state.hero_street_invested - state.villain_street_invested,
      state.villain_stack
    );
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
    return endHand(state, 'villain', true);
  } else if (heroAction === 'call') {
    const callAmount = Math.min(
      state.villain_street_invested - state.hero_street_invested,
      state.hero_stack
    );
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
  if (heroStack) heroStack.textContent = `${(state.hero_stack + state.hero_total_invested).toFixed(1)} bb`;
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

  zone.innerHTML = `<div class="space-y-5 flash-in">
    ${renderPokerTable({ seats, board: visBoard, dealerSeat, pot: state.pot.toFixed(1) + ' BB', situation: streetLabel })}
    ${streetIndicator}
    <div class="text-center text-sm">
      <span class="text-gray-500 font-mono">${state.hero_hand_key}</span>
      <span class="mx-2 text-gray-700">|</span>
      <span class="text-gray-400">${state.hero_position}</span>
      <span class="mx-2 text-gray-700">|</span>
      <span class="text-xs text-gray-500">Pot: ${state.pot.toFixed(1)} BB</span>
    </div>
    ${phaseContent}
  </div>`;

  updateHeader(state);

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

// --- Entry point ---

export function render(container) {
  // Set up simulate header
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

  simState = generateSimHand(100.0, 100.0, 1, true);
  if (simState.street_to_act === 'villain') {
    simState = runVillainTurn(simState);
  }

  renderSimHand(container);
}
