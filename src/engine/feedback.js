/**
 * Answer evaluation + explanation generation.
 * (Named feedback.js to avoid confusion with evaluator.js which handles hand evaluation)
 */
import { BUCKET_EXAMPLES } from './abstraction.js';
import { getCorrectActions } from './postflop.js';
import { computeRangeVsRange } from './rangeAnalysis.js';

export function evaluatePreflop(userAction, scenario) {
  const correct = scenario.correct_action;
  const handKey = scenario.hand_key;
  const position = scenario.position;
  let isCorrect = userAction === correct;
  let isAcceptable = false;

  if (scenario.type === 'preflop_facing') {
    const raiseRange = scenario.raise_range || [];
    const callRange = scenario.call_range || [];
    const inRaise = raiseRange.includes(handKey);
    const inCall = callRange.includes(handKey);
    const inRange = inRaise || inCall;
    if (!isCorrect && (userAction === 'raise' || userAction === 'call') && inRange) {
      isAcceptable = true;
    }
  }

  let explanation;
  if (scenario.type === 'preflop_rfi') {
    explanation = isCorrect
      ? `Correct! ${handKey} is a ${correct} from ${position}.`
      : `${handKey} should be a ${correct} from ${position}. The ${position} RFI range has ${scenario.range_size} combos.`;
  } else {
    const opener = scenario.opener || '';
    if (isCorrect) {
      explanation = `Correct! ${handKey} is a ${correct} from ${position} vs ${opener} open.`;
    } else if (isAcceptable) {
      explanation = `Acceptable. ${handKey} is primarily a ${correct} from ${position} vs ${opener} open, but ${userAction} is a reasonable alternative since it's in range.`;
    } else {
      explanation = `${handKey} should be a ${correct} from ${position} vs ${opener} open.`;
    }
  }

  return {
    is_correct: isCorrect || isAcceptable,
    is_primary: isCorrect,
    is_acceptable: isAcceptable,
    user_action: userAction,
    correct_action: correct,
    explanation,
    hand_key: handKey,
    range: scenario.range || [],
    raise_range: scenario.raise_range,
    call_range: scenario.call_range,
  };
}

const _TEXTURE_THEORY = {
  monotone: 'Flush dominates this board. Having a flush or flush draw is critical. Without flush equity, hands lose significant value. Bluffing is risky because opponents often have flush draws.',
  paired: 'Paired boards are polarized \u2014 players either have trips/full house or nothing. Medium-strength hands like one pair lose value. Betting ranges tend to be polarized (strong hands and bluffs, fewer medium-strength bets).',
  wet_connected: 'Connected boards have many straight draws available. Equity shifts dramatically on turn/river. Bet larger to deny equity from draws. Check-raising is common with strong hands and semi-bluffs.',
  wet_twotone: 'Two-tone boards create flush draw possibilities. Opponents often have flush draws, so bet for value and protection. Semi-bluffing with your own flush draws is profitable.',
  high_dry_A: 'Ace-high dry boards heavily favor the preflop raiser who has more Ax combos. C-bet frequently with small sizings. Opponents struggle to continue without an ace.',
  high_dry_K: 'King/Queen-high dry boards favor the raiser but less than ace-high. Check-raising from OOP is more viable here since the caller has more Kx and Qx combos.',
  medium_dry: 'Medium dry boards (J-8 high) are relatively neutral. Neither player has a huge range advantage. Bet selectively with strong hands and check more with medium-strength holdings.',
  low_dry: 'Low dry boards favor the caller who has more small pairs and connectors. Overpairs are very strong here. With few draws available, check more frequently from OOP to protect your range.',
};

const _POSITION_THEORY = {
  OOP: 'Out of position, you act first without information. Check frequently to protect your range \u2014 if you only bet strong hands, opponents exploit by raising your bets and floating your checks.',
  IP: 'In position, you act last with more information. You can bet wider after opponent checks (showing weakness). You can also check back to realize equity cheaply with medium-strength hands.',
};

const _BUCKET_THEORY = {
  premium: 'Premium hands can slow-play to trap or bet for value. On wet boards, prefer betting to deny equity.',
  nut: 'Nut hands should usually bet for value, but can check to induce bluffs on dry boards.',
  strong: 'Strong hands bet for value and protection. Size up on wet boards to price out draws.',
  two_pair: 'Two pair hands are strong but vulnerable to straight/flush completions. Bet for value and protection, especially on wet boards.',
  top_pair: 'Top pair with a good kicker bets for thin value on dry boards. On wet boards, consider check-calling to control pot.',
  overpair: 'Overpairs (TT-JJ) are strong but not invulnerable. Bet for value on low boards, play more carefully on high boards.',
  mid_pair: 'Mid pair and weak top pair often check to control pot size. Avoid bloating the pot out of position.',
  underpair: 'Underpairs have showdown value but are vulnerable. Check to control the pot and avoid getting raised off your equity.',
  nut_draw: 'Nut draws (combo draws, nut flush draws) are strong semi-bluff candidates. Bet or raise aggressively to build the pot and apply pressure.',
  draw: 'Draws can semi-bluff (bet/raise) to fold out better hands or build the pot for when they hit.',
  weak_made: "Weak made hands prefer checking. They have showdown value but can't stand a raise.",
  gutshot: 'Gutshots and backdoor draws make good bluff candidates since they have some equity if called.',
  air: 'Air hands either bluff (if you need bluffs at this frequency) or give up. Polarize your range.',
};

export function generateExplanation(position, texture, bucket, strategy, rvr, facingBet) {
  const points = [];

  if (rvr) {
    if (rvr.advantage_color === 'emerald') {
      points.push({
        title: 'You have range advantage',
        body: `Hero's range has ${rvr.hero_equity}% equity here. With range advantage, you can bet more aggressively and use larger sizings to pressure villain's capped range.`,
        category: 'range', color: 'emerald',
      });
    } else if (rvr.advantage_color === 'red') {
      points.push({
        title: 'Villain has range advantage',
        body: `Villain's range has ${rvr.villain_equity}% equity here. When villain has range advantage, play more defensively \u2014 check more and use smaller bet sizes when you do bet.`,
        category: 'range', color: 'red',
      });
    }
  }

  const texTheory = _TEXTURE_THEORY[texture];
  if (texTheory) {
    const texLabel = texture.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    points.push({ title: `${texLabel} board texture`, body: texTheory, category: 'texture', color: 'amber' });
  }

  const posTheory = _POSITION_THEORY[position];
  if (posTheory) {
    points.push({
      title: `Playing ${position}${facingBet ? ' facing a bet' : ''}`,
      body: posTheory, category: 'position', color: 'blue',
    });
  }

  const bucketTheory = _BUCKET_THEORY[bucket];
  if (bucketTheory) {
    const bucketLabel = bucket.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    points.push({ title: `${bucketLabel} hand`, body: bucketTheory, category: 'hand_strength', color: 'purple' });
  }

  const sorted = Object.entries(strategy).sort((a, b) => b[1] - a[1]);
  const topFreq = sorted[0]?.[1] || 0;
  if (topFreq >= 0.95) {
    points.push({
      title: 'Pure strategy',
      body: 'This is essentially a pure strategy \u2014 one action dominates. GTO says to almost always take this action with this hand class.',
      category: 'strategy', color: 'gray',
    });
  } else if (topFreq < 0.6 && sorted.filter(([, p]) => p > 0.15).length >= 2) {
    const mixedCount = sorted.filter(([, p]) => p > 0.15).length;
    points.push({
      title: 'Mixed strategy',
      body: `This is a mixed strategy spot \u2014 GTO mixes between ${mixedCount} actions. In practice, pick one based on exploitative reads, or randomize to stay balanced.`,
      category: 'strategy', color: 'gray',
    });
  }

  return points;
}

export function evaluatePostflop(userAction, scenario) {
  const strategy = scenario.strategy;
  const correctActions = getCorrectActions(strategy);
  let isCorrect = correctActions.includes(userAction);
  let isAcceptable = false;

  if (!isCorrect) {
    const userFreq = strategy[userAction] || 0;
    if (userFreq >= 0.15) isAcceptable = true;
  }

  const sorted = Object.entries(strategy).sort((a, b) => b[1] - a[1]);
  const stratStr = sorted.map(([a, p]) => `${scenario.action_labels?.[a] || a}: ${Math.round(p * 100)}%`).join(', ');

  let explanation;
  if (isCorrect) {
    explanation = `Good play! With a ${scenario.bucket} hand on a ${scenario.texture.replace(/_/g, ' ')} board. Strategy: ${stratStr}`;
  } else if (isAcceptable) {
    const userFreq = strategy[userAction] || 0;
    const best = scenario.action_labels?.[correctActions[0]] || correctActions[0];
    const userLabel = scenario.action_labels?.[userAction] || userAction;
    explanation = `Mixed spot. ${userLabel} at ${Math.round(userFreq * 100)}% frequency is reasonable, but ${best} is preferred. Strategy: ${stratStr}`;
  } else {
    const best = scenario.action_labels?.[correctActions[0]] || correctActions[0];
    explanation = `With a ${scenario.bucket} hand on a ${scenario.texture.replace(/_/g, ' ')} board, prefer ${best}. Strategy: ${stratStr}`;
  }

  const position = scenario.position || 'OOP';
  const rvr = computeRangeVsRange(scenario.texture, position);
  const facingBet = scenario.facing_bet || false;
  const explanationPoints = generateExplanation(position, scenario.texture, scenario.bucket, strategy, rvr, facingBet);

  return {
    is_correct: isCorrect || isAcceptable,
    is_primary: isCorrect,
    is_acceptable: isAcceptable,
    user_action: userAction,
    correct_actions: correctActions,
    explanation,
    strategy,
    bucket: scenario.bucket,
    bucket_label: scenario.bucket_label,
    texture: scenario.texture,
    texture_label: scenario.texture_label,
    range_breakdown: scenario.range_breakdown || {},
    action_labels: scenario.action_labels || {},
    bucket_examples: BUCKET_EXAMPLES,
    range_vs_range: rvr,
    explanation_points: explanationPoints,
  };
}
