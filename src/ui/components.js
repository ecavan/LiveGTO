/**
 * Shared UI components — replaces all Jinja2 partials.
 */
import { buildGrid } from '../engine/ranges.js';
import { BUCKET_EXAMPLES, BUCKETS } from '../engine/abstraction.js';

// --- Card rendering ---

export function renderCard(card, extraClass = '') {
  const colorClass = card.color === 'red' ? 'card-red' : 'card-black';
  return `<div class="card-box ${extraClass} ${colorClass}">
    <span>${card.rank}</span>
    <span class="suit">${card.suit_symbol}</span>
  </div>`;
}

export function renderBoardCard(card) {
  return renderCard(card, 'board-card');
}

export function renderCardBack(style = '') {
  return `<div class="card-back" ${style ? `style="${style}"` : ''}></div>`;
}

// --- Poker Table ---

export function renderPokerTable({ seats, board, dealerSeat, pot, situation, bets }) {
  // Board area
  let boardHtml = '';
  if (board && board.length > 0) {
    boardHtml = board.map(c => renderBoardCard(c)).join('');
    for (let i = 0; i < 5 - board.length; i++) {
      boardHtml += '<div class="board-slot"></div>';
    }
  } else {
    for (let i = 0; i < 5; i++) {
      boardHtml += '<div class="board-slot"></div>';
    }
  }

  let potHtml = pot ? `<div class="pot-display">${pot}</div>` : '';
  let sitHtml = situation ? `<div class="text-xs text-gray-300/80 font-mono mb-1">${situation}</div>` : '';

  // Bet chips
  let betsHtml = '';
  if (bets) {
    for (const [seatIdx, amount] of Object.entries(bets)) {
      const chipPos = parseInt(seatIdx) + 1;
      betsHtml += `<div class="bet-chip bet-chip-${chipPos}">
        <div class="chip-icon"></div>
        <span class="chip-amount">${amount}</span>
      </div>`;
    }
  }

  // Seats
  let seatsHtml = '';
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i];
    let seatClass = 'seat-inactive';
    if (seat.is_hero) seatClass = 'seat-hero seat-active';
    else if (seat.is_active) seatClass = 'seat-active';

    let cardsHtml;
    if (seat.is_hero && seat.cards) {
      cardsHtml = seat.cards.map(c => renderCard(c)).join('');
    } else if (seat.show_cards && seat.cards) {
      cardsHtml = seat.cards.map(c => renderCard(c)).join('');
    } else if (seat.is_active) {
      cardsHtml = renderCardBack() + renderCardBack();
    } else {
      cardsHtml = renderCardBack('opacity: 0.2;') + renderCardBack('opacity: 0.2;');
    }

    let stackHtml = '';
    if (seat.stack != null) {
      stackHtml = `<span class="text-yellow-400/80"> ${seat.stack}bb</span>`;
    }

    let dealerHtml = '';
    if (i === dealerSeat) {
      dealerHtml = '<div class="dealer-chip">D</div>';
    }

    seatsHtml += `<div class="seat seat-${i + 1} ${seatClass}">
      <div class="seat-info" style="position: relative;">
        <div class="seat-cards">${cardsHtml}</div>
        <div class="seat-label">${seat.position}${stackHtml}</div>
        ${dealerHtml}
      </div>
    </div>`;
  }

  return `<div class="poker-table">
    <div class="table-felt"></div>
    <div class="board-area">
      ${sitHtml}
      <div class="board-cards">${boardHtml}</div>
      ${potHtml}
    </div>
    ${betsHtml}
    ${seatsHtml}
  </div>`;
}

// --- Range Grid ---

export function renderRangeGrid(range, raiseRange, callRange, heroKey) {
  const rangeSet = new Set(range || []);
  const raiseSet = raiseRange ? new Set(raiseRange) : null;
  const callSet = callRange ? new Set(callRange) : null;
  const grid = buildGrid();

  // Legend
  let legend;
  if (raiseSet && callSet) {
    legend = `
      <span class="inline-block w-3 h-3 rounded-sm bg-emerald-700 mr-1 align-middle"></span> 3-Bet
      <span class="inline-block w-3 h-3 rounded-sm bg-blue-800 mr-1 ml-3 align-middle"></span> Call
      <span class="inline-block w-3 h-3 rounded-sm bg-gray-800 mr-1 ml-3 align-middle"></span> Fold`;
  } else {
    legend = `
      <span class="inline-block w-3 h-3 rounded-sm bg-emerald-700 mr-1 align-middle"></span> In range
      <span class="inline-block w-3 h-3 rounded-sm bg-gray-800 mr-1 ml-3 align-middle"></span> Fold`;
  }
  legend += `<span class="inline-block w-3 h-3 rounded-sm mr-1 ml-3 align-middle" style="outline: 2.5px solid #facc15; background: rgba(250,204,21,0.25);"></span> You`;

  let rows = '';
  for (let i = 0; i < 13; i++) {
    let cells = '';
    for (let j = 0; j < 13; j++) {
      const key = grid[i][j];
      const inRaise = raiseSet && raiseSet.has(key);
      const inCall = callSet && callSet.has(key);
      const inRange = rangeSet.has(key);
      const isHero = key === heroKey;

      let bgClass;
      if (inRaise) bgClass = 'bg-emerald-700/80';
      else if (inCall) bgClass = 'bg-blue-800/70';
      else if (inRange) bgClass = 'bg-emerald-700/80';
      else bgClass = 'bg-gray-900/60';

      const heroClass = isHero ? 'range-cell-hero' : '';
      cells += `<td class="range-cell border border-gray-800/50 ${bgClass} ${heroClass}">${key}</td>`;
    }
    rows += `<tr>${cells}</tr>`;
  }

  return `<div class="overflow-x-auto pt-2">
    <div class="text-xs text-gray-500 text-center mb-2">${legend}</div>
    <table class="mx-auto border-collapse">${rows}</table>
  </div>`;
}

// --- Strategy Bars ---

export function renderStrategyBars(strategy, correctActions, actionLabels, bucketLabel) {
  const sorted = Object.entries(strategy).sort((a, b) => b[1] - a[1]);
  let bars = '';
  for (const [action, prob] of sorted) {
    const label = (actionLabels && actionLabels[action]) || action;
    const isCorrect = correctActions && correctActions.includes(action);
    const barColor = isCorrect ? 'bg-emerald-500' : 'bg-gray-600';
    const pct = Math.round(prob * 100);
    bars += `<div class="flex items-center gap-3">
      <span class="text-sm text-gray-400 w-20">${label}</span>
      <div class="flex-1 bg-gray-800 rounded-full h-2.5 overflow-hidden">
        <div class="h-full rounded-full ${barColor}" style="width: ${pct}%"></div>
      </div>
      <span class="text-xs text-gray-500 w-10 text-right font-mono">${pct}%</span>
    </div>`;
  }

  return `<div class="bg-gray-900/60 rounded-xl p-4 space-y-3">
    <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
      Your hand: ${bucketLabel || ''}
    </h3>
    <div class="space-y-1.5">${bars}</div>
  </div>`;
}

// --- Range Breakdown ---

export function renderRangeBreakdown(rangeBreakdown, actionLabels, textureLabel, heroBucket) {
  if (!rangeBreakdown || Object.keys(rangeBreakdown).length === 0) return '';

  let rows = '';
  for (const bucket of BUCKETS) {
    const strat = rangeBreakdown[bucket];
    if (!strat) continue;
    const sorted = Object.entries(strat).sort((a, b) => b[1] - a[1]);
    const isHero = bucket === heroBucket;
    const labelClass = isHero ? 'text-yellow-400 font-bold' : '';

    let tags = '';
    for (const [action, prob] of sorted) {
      if (prob <= 0) continue;
      const label = (actionLabels && actionLabels[action]) || action;
      const pct = Math.round(prob * 100);
      let tagColor;
      if (action.includes('bet') || action === 'raise') tagColor = 'bg-emerald-900/60 text-emerald-400';
      else if (action === 'call') tagColor = 'bg-blue-900/60 text-blue-400';
      else if (action === 'check') tagColor = 'bg-gray-800 text-gray-400';
      else tagColor = 'bg-gray-800 text-gray-500';
      tags += `<span class="text-xs px-1.5 py-0.5 rounded ${tagColor}">${label} ${pct}%</span> `;
    }

    let examples = '';
    const exList = BUCKET_EXAMPLES[bucket];
    if (exList) {
      examples = `<div class="ml-1 pl-4 border-l border-gray-800 mt-1 mb-2">
        <div class="flex flex-wrap gap-1.5">
          ${exList.map(ex => `<span class="text-xs text-gray-500 bg-gray-800/60 px-1.5 py-0.5 rounded">${ex}</span>`).join('')}
        </div>
      </div>`;
    }

    rows += `<details class="bucket-details">
      <summary class="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-gray-800/40 rounded px-1 -mx-1">
        <span class="text-gray-400 w-24 shrink-0 font-mono text-xs ${labelClass}">${bucket}</span>
        <div class="flex-1 flex gap-1 flex-wrap">${tags}</div>
      </summary>
      ${examples}
    </details>`;
  }

  return `<div class="bg-gray-900/60 rounded-xl p-4">
    <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
      Full Range Strategy (${textureLabel || ''})
    </h3>
    <div class="space-y-1 text-sm">${rows}</div>
  </div>`;
}

// --- Range vs Range ---

export function renderRangeVsRange(rvr, heroBucket) {
  if (!rvr) return '';

  let advClass;
  if (rvr.advantage_color === 'emerald') advClass = 'bg-emerald-900/60 text-emerald-400';
  else if (rvr.advantage_color === 'red') advClass = 'bg-red-900/60 text-red-400';
  else advClass = 'bg-gray-800 text-gray-400';

  const bucketColors = {
    premium: 'emerald', nut: 'emerald', strong: 'emerald',
    good: 'yellow', medium: 'yellow', draw: 'blue',
    weak_made: 'orange', weak_draw: 'orange', air: 'red',
  };

  let bucketRows = '';
  for (const bucket of BUCKETS) {
    const hp = Math.round((rvr.hero_dist[bucket] || 0) * 100);
    const vp = Math.round((rvr.villain_dist[bucket] || 0) * 100);
    if (hp === 0 && vp === 0) continue;
    const isHero = bucket === heroBucket;
    const labelClass = isHero ? 'text-yellow-400 font-bold' : '';

    bucketRows += `<div class="flex items-center gap-2 text-xs">
      <span class="text-gray-500 w-20 shrink-0 font-mono truncate ${labelClass}">${bucket}</span>
      <div class="flex-1 flex gap-0.5">
        <div class="flex-1 flex justify-end">
          <div class="bg-emerald-700/60 h-2 rounded-l" style="width: ${hp * 3}%"></div>
        </div>
        <div class="flex-1">
          <div class="bg-red-700/60 h-2 rounded-r" style="width: ${vp * 3}%"></div>
        </div>
      </div>
      <span class="text-gray-600 w-16 font-mono text-right">${hp}% / ${vp}%</span>
    </div>`;
  }

  return `<div class="bg-gray-900/60 rounded-xl p-4 space-y-3">
    <div class="flex items-center justify-between">
      <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Range vs Range</h3>
      <span class="text-xs px-2 py-0.5 rounded-full ${advClass}">${rvr.advantage_label}</span>
    </div>
    <div class="flex items-center gap-3">
      <span class="text-xs text-emerald-400 w-16 font-mono">Hero ${rvr.hero_equity}%</span>
      <div class="flex-1 bg-gray-800 rounded-full h-3 overflow-hidden flex">
        <div class="h-full bg-emerald-600 rounded-l-full" style="width: ${rvr.hero_equity}%"></div>
        <div class="h-full bg-red-700 rounded-r-full" style="width: ${rvr.villain_equity}%"></div>
      </div>
      <span class="text-xs text-red-400 w-16 font-mono text-right">${rvr.villain_equity}% Villain</span>
    </div>
    <div class="space-y-1">${bucketRows}</div>
    <div class="flex justify-between text-xs text-gray-600">
      <span>Hero</span>
      <span>Villain</span>
    </div>
  </div>`;
}

// --- Explanation Toggle ---

export function renderExplanation(points) {
  if (!points || points.length === 0) return '';

  const colorMap = {
    emerald: { border: 'border-emerald-600', text: 'text-emerald-400' },
    red: { border: 'border-red-600', text: 'text-red-400' },
    amber: { border: 'border-amber-600', text: 'text-amber-400' },
    blue: { border: 'border-blue-600', text: 'text-blue-400' },
    purple: { border: 'border-purple-600', text: 'text-purple-400' },
    gray: { border: 'border-gray-600', text: 'text-gray-400' },
  };

  let pointsHtml = '';
  for (const point of points) {
    const c = colorMap[point.color] || colorMap.gray;
    pointsHtml += `<div class="pl-3 border-l-2 ${c.border}">
      <h4 class="text-xs font-semibold ${c.text}">${point.title}</h4>
      <p class="text-xs text-gray-500 mt-0.5 leading-relaxed">${point.body}</p>
    </div>`;
  }

  return `<details class="bucket-details">
    <summary class="flex items-center gap-2 cursor-pointer py-2 px-3 bg-gray-900/60 rounded-xl
                    hover:bg-gray-800/60 transition-all">
      <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Why?</span>
      <span class="text-xs text-gray-600">Click for theory</span>
    </summary>
    <div class="bg-gray-900/60 rounded-b-xl px-4 pb-4 pt-2 -mt-2 space-y-3">
      ${pointsHtml}
    </div>
  </details>`;
}

// --- Feedback result banner ---

export function renderFeedbackBanner(feedback) {
  if (feedback.is_primary) {
    return `<div class="flex items-center justify-center gap-2 py-1">
      <span class="text-emerald-400 text-2xl font-bold">&#10003;</span>
      <span class="text-emerald-400 font-semibold text-sm">Correct</span>
    </div>`;
  } else if (feedback.is_acceptable) {
    return `<div class="flex items-center justify-center gap-2 py-1">
      <span class="text-amber-400 text-2xl font-bold">&#10003;</span>
      <span class="text-amber-400 font-semibold text-sm">Acceptable</span>
    </div>`;
  } else {
    return `<div class="flex items-center justify-center gap-2 py-1">
      <span class="text-red-400 text-2xl font-bold">&#10007;</span>
      <span class="text-red-400 font-semibold text-sm">Incorrect</span>
    </div>`;
  }
}

// --- Action buttons ---

export function renderActionButtons(actions, actionLabels, onClickAttr) {
  let btns = '';
  for (const action of actions) {
    let colorClass;
    if (action === 'raise') colorClass = 'bg-emerald-700 hover:bg-emerald-600 text-white';
    else if (action === 'call') colorClass = 'bg-blue-700 hover:bg-blue-600 text-white';
    else if (action === 'bet_s') colorClass = 'bg-emerald-800 hover:bg-emerald-700';
    else if (action === 'bet_m') colorClass = 'bg-emerald-700 hover:bg-emerald-600';
    else if (action === 'bet_l') colorClass = 'bg-emerald-600 hover:bg-emerald-500';
    else colorClass = 'bg-gray-700 hover:bg-gray-600 text-gray-200';

    const label = (actionLabels && actionLabels[action]) || action;
    btns += `<button data-action="${action}" class="action-btn px-5 py-2.5 rounded-lg font-semibold transition-all text-sm ${colorClass}">${label}</button>`;
  }
  return `<div class="flex justify-center gap-2 flex-wrap">${btns}</div>`;
}
