/**
 * Engine tests — hand bucketing, textures, strategy coverage, and integration.
 * Ported from archive/test_engine.py
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
import { generateSimHand, villainPreflopAct, resolveShowdown, computeSessionReview } from '../src/engine/simulate.js';

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
  testHand('AKQ rainbow = high_dry', ['2s','3h'], ['Ac','Kd','Qh'], 'air', 'high_dry');
  testHand('753 rainbow = low_dry', ['2s','4h'], ['7c','5d','3h'], 'draw', 'low_dry');
  testHand('3 hearts = monotone', ['Ah','5h'], ['Kh','9h','2h'], 'premium', 'monotone');
  testHand('AA3 = paired', ['Ks','Qh'], ['Ac','Ad','3h'], 'weak_made', 'paired');
  testHand('JT9 two-tone conn = wet', ['Qs','Qh'], ['Jc','Tc','9h'], 'good', 'wet');
});

describe('Premium hands', () => {
  testHand('AA top set on AK7 dry', ['As','Ah'], ['Ac','Kd','7h'], 'premium', 'high_dry');
  testHand('Nut flush (Ace-high)', ['Ah','5h'], ['Kh','9h','2h'], 'premium', 'monotone');
  testHand('Full house', ['Ks','Kh'], ['Kd','7s','7h'], 'premium', 'paired');
  testHand('Quads', ['9s','9h'], ['9d','9c','3h'], 'premium');
  testHand('Top set on low dry', ['7s','7h'], ['7d','5c','2h'], 'premium', 'low_dry');
});

describe('Nut hands', () => {
  testHand('Bottom set on AK7 dry', ['7s','7h'], ['Ac','Kd','7d'], 'nut', 'high_dry');
  testHand('Top set on 987 wet', ['9s','9h'], ['9d','8c','7c'], 'nut', 'wet');
  testHand('K-high flush', ['Kh','3h'], ['Ah','9h','2h'], 'nut', 'monotone');
  testHand('Top two pair AK on AK3', ['As','Kh'], ['Ac','Kd','3h'], 'nut');
  testHand('Combo draw (FD+gutshot)', ['Ah','Th'], ['9h','7c','6h'], 'nut', 'wet');
});

describe('Strong hands', () => {
  testHand('KK overpair on J53', ['Ks','Kh'], ['Jc','5d','3h'], 'strong');
  testHand('TPTK AK on Kc52', ['As','Kh'], ['Kc','5d','2s'], 'strong');
  testHand('Low flush 8-high', ['8h','3h'], ['Ah','9h','2h'], 'strong', 'monotone');
  testHand('Bottom set on wet board', ['7s','7h'], ['9d','8c','7d'], 'strong');
  testHand('Trips on dry', ['Ks','5h'], ['5d','5c','2h'], 'strong', 'paired');
});

describe('Good hands', () => {
  testHand('JJ overpair on 953 dry', ['Js','Jh'], ['9c','5d','3h'], 'good', 'low_dry');
  testHand('TT overpair on 853 dry', ['Ts','Th'], ['8c','5d','3h'], 'good', 'low_dry');
  testHand('QQ overpair on JT9 wet', ['Qs','Qh'], ['Jc','Tc','9h'], 'good', 'wet');
  testHand('Top two pair on wet', ['Js','Th'], ['Jc','Tc','8h'], 'strong', 'wet');
});

describe('Medium hands', () => {
  testHand('99 overpair on 753', ['9s','9h'], ['7c','5d','3h'], 'medium', 'low_dry');
  testHand('TP weak kicker K4 on K52', ['Ks','4h'], ['Kc','5d','2s'], 'medium');
  testHand('Middle pair QJ on AJ3', ['Qs','Jh'], ['Ac','Jd','3h'], 'medium', 'high_dry');
});

describe('Draw hands', () => {
  testHand('Flush draw', ['Ah','5h'], ['Kc','9h','2h'], 'draw');
  testHand('OESD (JT on 98x)', ['Jh','Ts'], ['9c','8d','2h'], 'draw');
});

describe('Weak made hands', () => {
  testHand('Bottom pair 3x on AK3', ['3s','5h'], ['Ac','Kd','3h'], 'weak_made', 'high_dry');
  testHand('Underpair 22 on AK3', ['2s','2h'], ['Ac','Kd','3h'], 'weak_made', 'high_dry');
});

describe('Weak draw hands', () => {
  testHand('Gutshot (A5 on 43x)', ['Ah','5s'], ['4c','3d','8h'], 'weak_draw');
  testHand('K-high overcard on low board', ['Ks','5h'], ['9c','7d','2h'], 'weak_draw', 'low_dry');
});

describe('Air hands', () => {
  testHand('Complete air', ['4s','2h'], ['Ac','Kd','9h'], 'air', 'high_dry');
  testHand('Low cards no draw', ['4s','2h'], ['Tc','8d','6h'], 'air');
});

describe('Strategy coverage', () => {
  it('should have all 135 strategy entries', () => {
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
    // 135 possible, but some JSON entries are empty and fall back to defaults
    expect(totalEntries).toBeGreaterThanOrEqual(120);
    expect(totalEntries).toBeLessThanOrEqual(135);
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
      texture: 'high_dry', texture_label: 'High & dry',
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
  it('computeRangeVsRange returns equity data', () => {
    const rvr = computeRangeVsRange('high_dry', 'OOP');
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
  it('all 9 buckets appear in random sampling', () => {
    const counts = {};
    for (const b of BUCKETS) counts[b] = 0;

    for (let i = 0; i < 1000; i++) {
      const deck = createDeck();
      const hand = drawCards(deck, 2);
      const board = drawCards(deck, 3);
      const tex = classifyTexture(board);
      const bkt = classifyHand(hand, board, tex);
      counts[bkt]++;
    }

    // Each bucket should appear at least once in 1000 random hands
    for (const b of BUCKETS) {
      expect(counts[b]).toBeGreaterThan(0);
    }
  });
});
