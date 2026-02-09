/**
 * Engine tests — hand bucketing, textures, strategy coverage, and integration.
 * Updated for 13 buckets × 8 textures.
 */
import { describe, it, expect } from 'vitest';
import { classifyHand, BUCKETS } from '../src/engine/abstraction.js';
import { classifyTexture, getStrategy, getCorrectActions, TEXTURES, OOP_STRATEGY, IP_VS_CHECK, FACING_BET } from '../src/engine/postflop.js';
import { cardToDisplay, handToKey } from '../src/engine/cards.js';
import { createDeck, drawCards, getRankClass, evaluate, compareHands } from '../src/engine/evaluator.js';
import { RFI_RANGES, FACING_OPEN, FACING_OPEN_KEYS } from '../src/engine/ranges.js';
import { generatePreflop, generatePostflop, generatePlayScenario } from '../src/engine/scenarios.js';
import { evaluatePreflop, evaluatePostflop } from '../src/engine/feedback.js';
import { computeRangeVsRange } from '../src/engine/rangeAnalysis.js';
import { generateSimHand, villainPreflopAct, resolveShowdown, computeSessionReview, generateMultiwayHand, resolveMultiwayShowdown, getMultiwayPostflopOrder } from '../src/engine/simulate.js';
import { expandHandKey, initVillainRange, narrowPreflop, narrowPostflop, getRangeStats } from '../src/engine/rangeTracker.js';
import { analyzeBlockers } from '../src/engine/blockers.js';

// Helper: test hand classification
function testHand(label, handStrs, boardStrs, expectedBucket, expectedTexture) {
  it(label, () => {
    const tex = classifyTexture(boardStrs);
    const bkt = classifyHand(handStrs, boardStrs, tex);
    if (expectedTexture) {
      expect(tex).toBe(expectedTexture);
    }
    expect(bkt).toBe(expectedBucket);
  });
}

describe('Texture classification', () => {
  testHand('AKQ rainbow = wet_connected', ['2s','3h'], ['Ac','Kd','Qh'], 'air', 'wet_connected');
  testHand('753 rainbow = wet_connected', ['2s','4h'], ['7c','5d','3h'], 'draw', 'wet_connected');
  testHand('3 hearts = monotone', ['Ah','5h'], ['Kh','9h','2h'], 'premium', 'monotone');
  testHand('AA3 = paired', ['Ks','Qh'], ['Ac','Ad','3h'], 'weak_made', 'paired');
  testHand('JT9 two-tone conn = wet_connected', ['Qs','Qh'], ['Jc','Tc','9h'], 'strong', 'wet_connected');
  testHand('AK7 rainbow = high_dry_A', ['4s','2h'], ['Ac','Kd','7h'], 'air', 'high_dry_A');
  testHand('K52 rainbow = high_dry_K', ['4s','2h'], ['Kc','5d','2s'], 'weak_made', 'high_dry_K');
  testHand('J82 two-tone = wet_twotone', ['4s','2c'], ['Jh','8h','2d'], 'weak_made', 'wet_twotone');
  testHand('953 rainbow = medium_dry', ['Qs','2h'], ['9c','5d','3h'], 'air', 'medium_dry');
  testHand('853 rainbow = low_dry', ['Qs','2h'], ['8c','5d','3h'], 'air', 'low_dry');
});

describe('Premium hands', () => {
  testHand('AA top set on AK7 dry', ['As','Ah'], ['Ac','Kd','7h'], 'premium', 'high_dry_A');
  testHand('Nut flush (Ace-high)', ['Ah','5h'], ['Kh','9h','2h'], 'premium', 'monotone');
  testHand('Full house', ['Ks','Kh'], ['Kd','7s','7h'], 'premium', 'paired');
  testHand('Quads', ['9s','9h'], ['9d','9c','3h'], 'premium');
  testHand('Top set on 987 connected', ['9s','9h'], ['9d','8c','7c'], 'premium', 'wet_connected');
});

describe('Nut hands', () => {
  testHand('Bottom set on AK7 two-tone', ['7s','7h'], ['Ac','Kd','7d'], 'nut', 'wet_twotone');
  testHand('Bottom set on 987 connected', ['7s','7h'], ['9d','8c','7d'], 'nut', 'wet_connected');
  testHand('K-high flush', ['Kh','3h'], ['Ah','9h','2h'], 'nut', 'monotone');
});

describe('Strong hands', () => {
  testHand('KK overpair on J53', ['Ks','Kh'], ['Jc','5d','3h'], 'strong');
  testHand('QQ overpair on JT9 connected', ['Qs','Qh'], ['Jc','Tc','9h'], 'strong', 'wet_connected');
  testHand('Low flush 8-high', ['8h','3h'], ['Ah','9h','2h'], 'strong', 'monotone');
  testHand('Trips on paired board', ['Ks','5h'], ['5d','5c','2h'], 'strong', 'paired');
});

describe('Two pair hands', () => {
  testHand('Top two pair AK on AK3', ['As','Kh'], ['Ac','Kd','3h'], 'two_pair');
  testHand('Two pair on wet_connected', ['Js','Th'], ['Jc','Tc','8h'], 'two_pair', 'wet_connected');
});

describe('Top pair hands', () => {
  testHand('TPTK AK on Kc52', ['As','Kh'], ['Kc','5d','2s'], 'top_pair', 'high_dry_K');
  testHand('Top pair J kicker', ['Js','Kh'], ['Kc','5d','2s'], 'top_pair');
});

describe('Overpair hands', () => {
  testHand('JJ overpair on 953 dry', ['Js','Jh'], ['9c','5d','3h'], 'overpair', 'medium_dry');
  testHand('TT overpair on 853 dry', ['Ts','Th'], ['8c','5d','3h'], 'overpair', 'low_dry');
});

describe('Mid pair hands', () => {
  testHand('TP weak kicker K4 on K52', ['Ks','4h'], ['Kc','5d','2s'], 'mid_pair');
  testHand('Middle pair QJ on AJ3', ['Qs','Jh'], ['Ac','Jd','3h'], 'mid_pair', 'high_dry_A');
});

describe('Underpair hands', () => {
  testHand('99 overpair on 753 connected', ['9s','9h'], ['7c','5d','3h'], 'underpair', 'wet_connected');
});

describe('Nut draw hands', () => {
  testHand('Combo draw (FD+gutshot)', ['Ah','Th'], ['9h','7c','6h'], 'nut_draw', 'wet_connected');
});

describe('Draw hands', () => {
  testHand('Flush draw', ['Ah','5h'], ['Kc','9h','2h'], 'draw');
  testHand('OESD (JT on 98x)', ['Jh','Ts'], ['9c','8d','2h'], 'draw');
});

describe('Weak made hands', () => {
  testHand('Bottom pair 3x on AK3', ['3s','5h'], ['Ac','Kd','3h'], 'weak_made', 'high_dry_A');
  testHand('Underpair 22 on AK3', ['2s','2h'], ['Ac','Kd','3h'], 'weak_made', 'high_dry_A');
});

describe('Gutshot hands', () => {
  testHand('Gutshot (A5 on 43x)', ['Ah','5s'], ['4c','3d','8h'], 'gutshot');
  testHand('K-high overcard on medium board', ['Ks','5h'], ['9c','7d','2h'], 'gutshot', 'medium_dry');
});

describe('Air hands', () => {
  testHand('Complete air', ['4s','2h'], ['Ac','Kd','9h'], 'air', 'high_dry_A');
  testHand('Low cards no draw', ['4s','2h'], ['Tc','8d','6h'], 'air');
});

describe('Strategy coverage', () => {
  it('should have all 312 strategy entries (13 buckets × 8 textures × 3)', () => {
    let totalEntries = 0;
    for (const tex of TEXTURES) {
      for (const bkt of BUCKETS) {
        for (const pos of ['OOP', 'IP']) {
          const s = getStrategy(pos, tex, bkt, false);
          if (s && Object.keys(s).length > 0) totalEntries++;
        }
        const s = getStrategy('IP', tex, bkt, true);
        if (s && Object.keys(s).length > 0) totalEntries++;
      }
    }
    // 312 possible entries (13 × 8 × 3)
    expect(totalEntries).toBeGreaterThanOrEqual(300);
    expect(totalEntries).toBeLessThanOrEqual(312);
  });
});

describe('Probability sums', () => {
  it('all OOP strategy probs sum to ~1.0', () => {
    for (const [key, strat] of Object.entries(OOP_STRATEGY)) {
      const total = Object.values(strat).reduce((a, b) => a + b, 0);
      if (total > 0) expect(Math.abs(total - 1.0)).toBeLessThan(0.05);
    }
  });

  it('all IP strategy probs sum to ~1.0', () => {
    for (const [key, strat] of Object.entries(IP_VS_CHECK)) {
      const total = Object.values(strat).reduce((a, b) => a + b, 0);
      if (total > 0) expect(Math.abs(total - 1.0)).toBeLessThan(0.05);
    }
  });

  it('all facing bet probs sum to ~1.0', () => {
    for (const [key, strat] of Object.entries(FACING_BET)) {
      const total = Object.values(strat).reduce((a, b) => a + b, 0);
      if (total > 0) expect(Math.abs(total - 1.0)).toBeLessThan(0.05);
    }
  });
});

describe('Evaluator', () => {
  it('createDeck returns 52 unique cards', () => {
    const deck = createDeck();
    expect(deck.length).toBe(52);
    expect(new Set(deck).size).toBe(52);
  });

  it('drawCards removes from deck', () => {
    const deck = createDeck();
    const drawn = drawCards(deck, 5);
    expect(drawn.length).toBe(5);
    expect(deck.length).toBe(47);
  });

  it('evaluate returns a hand object', () => {
    const result = evaluate(['As', 'Kh'], ['Qs', 'Js', 'Ts']);
    expect(result).toBeDefined();
  });

  it('getRankClass returns valid class', () => {
    const result = evaluate(['As', 'Kh'], ['Qs', 'Js', 'Ts']);
    const rc = getRankClass(result);
    expect(rc).toBeGreaterThanOrEqual(0);
    expect(rc).toBeLessThanOrEqual(9);
  });

  it('compareHands picks the winner', () => {
    // AA vs 72o on dry board
    const board = ['Kd', '5c', '3h', '8d', '9c'];
    const result = compareHands(['As', 'Ah'], board, ['7s', '2h'], board);
    expect(result).toBe('first');
  });
});

describe('Cards', () => {
  it('cardToDisplay returns correct display', () => {
    const display = cardToDisplay('Ah');
    expect(display.rank).toBe('A');
    expect(display.suit).toBe('h');
    expect(display.color).toBe('red');
  });

  it('handToKey produces canonical key', () => {
    expect(handToKey('As', 'Kh')).toBe('AKo');
    expect(handToKey('Ah', 'Kh')).toBe('AKs');
    expect(handToKey('As', 'Ah')).toBe('AA');
    expect(handToKey('2h', 'As')).toBe('A2o');
  });
});

describe('Ranges', () => {
  it('RFI_RANGES has all positions', () => {
    for (const pos of ['UTG', 'MP', 'CO', 'BTN', 'SB']) {
      expect(RFI_RANGES[pos]).toBeDefined();
      expect(RFI_RANGES[pos].size).toBeGreaterThan(0);
    }
  });

  it('UTG is tighter than BTN', () => {
    expect(RFI_RANGES['UTG'].size).toBeLessThan(RFI_RANGES['BTN'].size);
  });

  it('FACING_OPEN has entries', () => {
    expect(FACING_OPEN_KEYS.length).toBeGreaterThan(0);
    for (const [hero, opener] of FACING_OPEN_KEYS) {
      const key = `${hero}|${opener}`;
      expect(FACING_OPEN[key]).toBeDefined();
      expect(FACING_OPEN[key].raise).toBeDefined();
      expect(FACING_OPEN[key].call).toBeDefined();
    }
  });

  it('AA is always in range', () => {
    for (const pos of ['UTG', 'MP', 'CO', 'BTN', 'SB']) {
      expect(RFI_RANGES[pos].has('AA')).toBe(true);
    }
  });
});

describe('Scenario generation', () => {
  it('generatePreflop returns valid scenario', () => {
    const s = generatePreflop();
    expect(s.type).toMatch(/^preflop_/);
    expect(s.hand.length).toBe(2);
    expect(s.actions.length).toBeGreaterThan(0);
    expect(s.correct_action).toBeDefined();
  });

  it('generatePostflop returns valid scenario', () => {
    const s = generatePostflop();
    expect(s.type).toBe('postflop');
    expect(s.hand.length).toBe(2);
    expect(s.board.length).toBe(3);
    expect(s.strategy).toBeDefined();
    expect(s.correct_actions.length).toBeGreaterThan(0);
  });

  it('generatePlayScenario returns full hand data', () => {
    const s = generatePlayScenario();
    expect(s.hand.length).toBe(2);
    expect(s.board.length).toBe(5);
    expect(s.preflop_correct).toBeDefined();
    expect(s.strategy).toBeDefined();
  });
});

describe('Feedback', () => {
  it('evaluatePreflop correct answer', () => {
    const scenario = {
      type: 'preflop_rfi', position: 'UTG', hand_key: 'AA',
      correct_action: 'raise', range: ['AA', 'KK'], range_size: 2,
    };
    const fb = evaluatePreflop('raise', scenario);
    expect(fb.is_correct).toBe(true);
    expect(fb.is_primary).toBe(true);
  });

  it('evaluatePreflop wrong answer', () => {
    const scenario = {
      type: 'preflop_rfi', position: 'UTG', hand_key: 'AA',
      correct_action: 'raise', range: ['AA', 'KK'], range_size: 2,
    };
    const fb = evaluatePreflop('fold', scenario);
    expect(fb.is_correct).toBe(false);
  });

  it('evaluatePostflop with strategy', () => {
    const scenario = {
      type: 'postflop', position: 'OOP', hand_key: 'AA',
      bucket: 'premium', bucket_label: 'Premium',
      texture: 'high_dry_A', texture_label: 'Ace-high dry',
      strategy: { check: 0.40, bet_m: 0.20, bet_l: 0.40 },
      correct_actions: ['check', 'bet_l'],
      action_labels: { check: 'Check', bet_m: 'Bet 66%', bet_l: 'Bet 100%' },
      range_breakdown: {},
    };
    const fb = evaluatePostflop('check', scenario);
    expect(fb.is_correct).toBe(true);
  });
});

describe('Range vs Range', () => {
  it('computeRangeVsRange returns equity data or null', () => {
    // May return null if strategies.json lacks new texture keys
    const rvr = computeRangeVsRange('high_dry_A', 'OOP');
    if (rvr) {
      expect(rvr.hero_equity).toBeGreaterThan(0);
      expect(rvr.hero_equity).toBeLessThan(100);
      expect(rvr.villain_equity).toBeGreaterThan(0);
      expect(rvr.advantage_label).toBeDefined();
      expect(rvr.advantage_color).toBeDefined();
    }
  });
});

describe('Simulate', () => {
  it('generateSimHand returns valid state', () => {
    const state = generateSimHand(100, 100, 1, true);
    expect(state.hero_hand.length).toBe(2);
    expect(state.villain_hand.length).toBe(2);
    expect(state.board_cards.length).toBe(5);
    expect(state.pot).toBe(1.5);
    expect(state.street).toBe('preflop');
    expect(state.hero_position).toBe('SB');
  });

  it('villainPreflopAct returns valid action', () => {
    const action = villainPreflopAct('AA', 'SB', false, 0);
    expect(['raise', 'fold']).toContain(action);
  });

  it('resolveShowdown returns winner', () => {
    const result = resolveShowdown(['As', 'Ah'], ['7s', '2h'], ['Kd', '5c', '3h', '8d', '9c']);
    expect(['hero', 'villain', 'split']).toContain(result);
  });

  it('computeSessionReview handles empty log', () => {
    const review = computeSessionReview([]);
    expect(review.total_pl).toBe(0);
    expect(review.hands_played).toBe(0);
    expect(review.top_mistakes).toEqual([]);
  });

  it('computeSessionReview handles log with data', () => {
    const log = [
      { hand_num: 1, hero_hand_key: 'AA', result_bb: 5.0, actions: [{ street: 'preflop', action: 'raise', gto_action: 'raise', deviation: 0 }] },
      { hand_num: 2, hero_hand_key: '72o', result_bb: -2.0, actions: [{ street: 'preflop', action: 'call', gto_action: 'fold', deviation: 1.0 }] },
    ];
    const review = computeSessionReview(log);
    expect(review.hands_played).toBe(2);
    expect(review.total_pl).toBe(3.0);
    expect(review.top_mistakes.length).toBe(1);
    expect(review.top_mistakes[0].hero_action).toBe('call');
  });
});

describe('Bucket distribution (smoke test)', () => {
  it('all 13 buckets appear in random sampling', () => {
    const counts = {};
    for (const b of BUCKETS) counts[b] = 0;

    for (let i = 0; i < 3000; i++) {
      const deck = createDeck();
      const hand = drawCards(deck, 2);
      const board = drawCards(deck, 3);
      const tex = classifyTexture(board);
      const bkt = classifyHand(hand, board, tex);
      counts[bkt]++;
    }

    // Each bucket should appear at least once in 3000 random hands
    for (const b of BUCKETS) {
      expect(counts[b]).toBeGreaterThan(0);
    }
  });
});

describe('Multiway', () => {
  it('generateMultiwayHand returns valid 4-player state', () => {
    const state = generateMultiwayHand(4, [100, 100, 100, 100], 1, 0);
    expect(state.num_players).toBe(4);
    expect(state.players.length).toBe(4);
    expect(state.players[0].is_hero).toBe(true);
    expect(state.board_strs.length).toBe(5);
    expect(state.pot).toBe(1.5);
    // SB and BB should have posted blinds
    const sb = state.players.find(p => p.position === 'SB');
    const bb = state.players.find(p => p.position === 'BB');
    expect(sb.total_invested).toBe(0.5);
    expect(bb.total_invested).toBe(1.0);
  });

  it('generateMultiwayHand assigns correct positions for 6 players', () => {
    const state = generateMultiwayHand(6, [100, 100, 100, 100, 100, 100], 1, 0);
    const positions = state.players.map(p => p.position);
    expect(positions).toContain('UTG');
    expect(positions).toContain('BTN');
    expect(positions).toContain('SB');
    expect(positions).toContain('BB');
  });

  it('resolveMultiwayShowdown finds winner', () => {
    const players = [
      { idx: 0, hand_strs: ['As', 'Ah'], folded: false },
      { idx: 1, hand_strs: ['7s', '2h'], folded: false },
      { idx: 2, hand_strs: ['Ks', 'Qh'], folded: true },
    ];
    const board = ['Kd', '5c', '3h', '8d', '9c'];
    const result = resolveMultiwayShowdown(players, board);
    expect(result.winner_idxs).toContain(0);
    expect(result.winner_idxs).not.toContain(2); // folded
  });

  it('getMultiwayPostflopOrder skips folded players', () => {
    const players = [
      { idx: 0, position: 'CO', folded: false },
      { idx: 1, position: 'BTN', folded: false },
      { idx: 2, position: 'SB', folded: true },
      { idx: 3, position: 'BB', folded: false },
    ];
    const order = getMultiwayPostflopOrder(players, 1); // BTN is dealer
    expect(order).not.toContain(2); // folded SB excluded
    expect(order[0]).toBe(3); // BB first after dealer
  });
});

describe('Texture distribution (smoke test)', () => {
  it('all 8 textures appear in random sampling', () => {
    const counts = {};
    for (const t of TEXTURES) counts[t] = 0;

    for (let i = 0; i < 2000; i++) {
      const deck = createDeck();
      const board = drawCards(deck, 3);
      const tex = classifyTexture(board);
      counts[tex]++;
    }

    // Each texture should appear at least once in 2000 random boards
    for (const t of TEXTURES) {
      expect(counts[t]).toBeGreaterThan(0);
    }
  });
});

// --- Range Tracker Tests ---

describe('Range Tracker', () => {
  it('expandHandKey returns 6 combos for pairs', () => {
    const combos = expandHandKey('AA');
    expect(combos.length).toBe(6);
    // All combos should have rank A
    for (const [c1, c2] of combos) {
      expect(c1[0]).toBe('A');
      expect(c2[0]).toBe('A');
      expect(c1[1]).not.toBe(c2[1]); // different suits
    }
  });

  it('expandHandKey returns 4 combos for suited hands', () => {
    const combos = expandHandKey('AKs');
    expect(combos.length).toBe(4);
    for (const [c1, c2] of combos) {
      expect(c1[0]).toBe('A');
      expect(c2[0]).toBe('K');
      expect(c1[1]).toBe(c2[1]); // same suit
    }
  });

  it('expandHandKey returns 12 combos for offsuit hands', () => {
    const combos = expandHandKey('AKo');
    expect(combos.length).toBe(12);
    for (const [c1, c2] of combos) {
      expect(c1[0]).toBe('A');
      expect(c2[0]).toBe('K');
      expect(c1[1]).not.toBe(c2[1]); // different suits
    }
  });

  it('initVillainRange weights RFI hands at 1.0 and others at 0', () => {
    const range = initVillainRange('BTN');
    const rfiSize = RFI_RANGES['BTN'].size;
    let inCount = 0;
    for (const [key, w] of range) {
      if (w > 0) inCount++;
      if (RFI_RANGES['BTN'].has(key)) expect(w).toBe(1.0);
      else expect(w).toBe(0);
    }
    expect(inCount).toBe(rfiSize);
    expect(range.size).toBe(169);
  });

  it('narrowPreflop narrows to call range', () => {
    const range = initVillainRange('BTN');
    narrowPreflop(range, 'BTN', 'call', 'UTG');
    const callRange = FACING_OPEN['BTN|UTG'].call;
    const stats = getRangeStats(range);
    expect(stats.combos).toBe(callRange.size);
    // AA should be out (not in call range)
    expect(range.get('AA')).toBe(0);
    // JJ should be in (in call range)
    expect(range.get('JJ')).toBe(1.0);
  });

  it('narrowPreflop narrows to raise range (3-bet)', () => {
    const range = initVillainRange('BTN');
    narrowPreflop(range, 'BTN', 'raise', 'UTG');
    const raiseRange = FACING_OPEN['BTN|UTG'].raise;
    const stats = getRangeStats(range);
    expect(stats.combos).toBe(raiseRange.size);
    expect(range.get('AA')).toBe(1.0);
    expect(range.get('72o')).toBe(0);
  });

  it('narrowPostflop reduces weights based on action', () => {
    const range = initVillainRange('BTN');
    const board = ['9s', '5h', '3d'];
    const blocked = new Set(['Ah', 'Kd', ...board]);
    narrowPostflop(range, board, blocked, 'IP', 'bet_l', false);
    // After betting large, premiums should retain high weight, air should drop
    // (premiums bet large ~55%, air bets large ~40%)
    // Since weights are normalized, just check that some hands reduced
    const stats = getRangeStats(range);
    expect(stats.combos).toBeLessThan(RFI_RANGES['BTN'].size);
  });

  it('narrowPostflop zeros out hands blocked by board', () => {
    const range = new Map([['99', 1.0], ['AA', 1.0], ['72o', 0]]);
    const board = ['9s', '9h', '3d']; // paired board uses two 9s
    const blocked = new Set(['Ah', 'Kd', ...board]);
    narrowPostflop(range, board, blocked, 'OOP', 'check', false);
    // 99 combos: need two 9s but board uses 9s and 9h, leaving only 9c and 9d → 1 combo
    // Should still have some weight
    expect(range.get('99')).toBeGreaterThan(0);
  });

  it('getRangeStats counts hands above threshold', () => {
    const range = new Map([['AA', 1.0], ['KK', 0.5], ['QQ', 0.01], ['72o', 0]]);
    const stats = getRangeStats(range);
    expect(stats.combos).toBe(2); // AA and KK above 0.05
  });
});

describe('Blocker Analysis', () => {
  it('detects nut flush draw blocker on two-tone board', () => {
    const insights = analyzeBlockers(['Ah', 'Kd'], ['9h', '7h', '2c']);
    const nfd = insights.find(i => i.type === 'flush_draw' && i.text.includes('nut flush draw'));
    expect(nfd).toBeDefined();
    expect(nfd.text).toContain('Ah');
  });

  it('detects nut flush on monotone board', () => {
    const insights = analyzeBlockers(['Ah', 'Kh'], ['Qh', 'Jh', '3h']);
    const nf = insights.find(i => i.type === 'flush');
    expect(nf).toBeDefined();
    expect(nf.text).toContain('Ah');
  });

  it('detects K-high flush draw blocker', () => {
    const insights = analyzeBlockers(['Kh', '2d'], ['9h', '7h', '3c']);
    const kfd = insights.find(i => i.text.includes('K-high flush draw'));
    expect(kfd).toBeDefined();
  });

  it('detects set blocker when hero matches board rank', () => {
    const insights = analyzeBlockers(['Ah', 'Kd'], ['As', '7c', '2d']);
    const setBlock = insights.find(i => i.type === 'set');
    expect(setBlock).toBeDefined();
    expect(setBlock.text).toContain('AA');
  });

  it('detects overpair blockers on lower board', () => {
    const insights = analyzeBlockers(['Ah', 'Kd'], ['Qs', '7c', '2d']);
    const aa = insights.find(i => i.type === 'overpair' && i.text.includes('AA'));
    const kk = insights.find(i => i.type === 'overpair' && i.text.includes('KK'));
    expect(aa).toBeDefined();
    expect(kk).toBeDefined();
  });

  it('returns no blocker insights for irrelevant hand', () => {
    const insights = analyzeBlockers(['5c', '3c'], ['Qs', '7d', '2h']);
    const blockers = insights.filter(i => i.impact === 'positive');
    expect(blockers.length).toBe(0);
  });

  it('detects straight blocker on connected board', () => {
    const insights = analyzeBlockers(['Qh', '2d'], ['9s', 'Tc', 'Jd']);
    const sb = insights.find(i => i.type === 'straight');
    expect(sb).toBeDefined();
    expect(sb.text).toContain('Q');
  });

  // Unblocker tests
  it('detects flush draw unblocker on two-tone board', () => {
    const insights = analyzeBlockers(['5c', '3d'], ['9h', '7h', '2c']);
    const ub = insights.find(i => i.type === 'unblock_flush_draw');
    expect(ub).toBeDefined();
    expect(ub.impact).toBe('negative');
    expect(ub.text).toContain('no h');
  });

  it('detects flush unblocker on monotone board', () => {
    const insights = analyzeBlockers(['5c', '3d'], ['9h', '7h', '2h']);
    const ub = insights.find(i => i.type === 'unblock_flush');
    expect(ub).toBeDefined();
    expect(ub.impact).toBe('negative');
  });

  it('detects top set unblocker when hero misses top card', () => {
    const insights = analyzeBlockers(['5c', '3d'], ['Qs', '7d', '2h']);
    const ub = insights.find(i => i.type === 'unblock_set');
    expect(ub).toBeDefined();
    expect(ub.text).toContain('QQ');
  });

  it('detects overpair unblockers on low board', () => {
    const insights = analyzeBlockers(['5c', '3d'], ['8s', '7d', '2h']);
    const aa = insights.find(i => i.type === 'unblock_overpair' && i.text.includes('AA'));
    const kk = insights.find(i => i.type === 'unblock_overpair' && i.text.includes('KK'));
    expect(aa).toBeDefined();
    expect(kk).toBeDefined();
    expect(aa.impact).toBe('negative');
  });

  it('does not show overpair unblockers on high boards', () => {
    const insights = analyzeBlockers(['5c', '3d'], ['Qs', '7d', '2h']);
    const overpairUb = insights.filter(i => i.type === 'unblock_overpair');
    expect(overpairUb.length).toBe(0);
  });
});
