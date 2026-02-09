"""Board texture classification + strategy tables (13 buckets × 8 textures).
Strategy tables loaded from pre-computed JSON, falls back to generated defaults.
"""

import json
import os
from collections import Counter
from treys import Card

# Board textures — 8 categories
MONOTONE = 'monotone'
PAIRED = 'paired'
WET_CONNECTED = 'wet_connected'
WET_TWOTONE = 'wet_twotone'
HIGH_DRY_A = 'high_dry_A'
HIGH_DRY_K = 'high_dry_K'
MEDIUM_DRY = 'medium_dry'
LOW_DRY = 'low_dry'

TEXTURES = [MONOTONE, PAIRED, WET_CONNECTED, WET_TWOTONE,
            HIGH_DRY_A, HIGH_DRY_K, MEDIUM_DRY, LOW_DRY]

TEXTURE_LABELS = {
    MONOTONE: 'Monotone (3+ same suit)',
    PAIRED: 'Paired board',
    WET_CONNECTED: 'Wet connected (straight-draw heavy)',
    WET_TWOTONE: 'Wet two-tone (flush-draw heavy)',
    HIGH_DRY_A: 'Ace-high dry',
    HIGH_DRY_K: 'K/Q-high dry',
    MEDIUM_DRY: 'Medium dry (J-8 high)',
    LOW_DRY: 'Low dry (7-high or less)',
}

ACTION_LABELS = {
    'check': 'Check', 'bet_s': 'Bet 33%', 'bet_m': 'Bet 66%', 'bet_l': 'Bet 100%',
    'fold': 'Fold', 'call': 'Call', 'raise': 'Raise',
}


def classify_texture(board):
    """Classify board into one of 8 texture categories."""
    ranks = [Card.get_rank_int(c) for c in board]
    suits = [Card.get_suit_int(c) for c in board]

    suit_counts = Counter(suits)
    rank_counts = Counter(ranks)

    if max(suit_counts.values()) >= 3:
        return MONOTONE
    if max(rank_counts.values()) >= 2:
        return PAIRED

    sorted_ranks = sorted(ranks)
    max_gap = max(sorted_ranks[i + 1] - sorted_ranks[i] for i in range(len(sorted_ranks) - 1))
    is_connected = max_gap <= 2
    is_two_tone = max(suit_counts.values()) >= 2

    if is_connected:
        return WET_CONNECTED
    if is_two_tone:
        return WET_TWOTONE

    # Rainbow, not connected
    highest = max(ranks)
    if highest == 12:
        return HIGH_DRY_A
    if highest >= 10:
        return HIGH_DRY_K
    if highest >= 7:
        return MEDIUM_DRY
    return LOW_DRY


# ================================================================
# Default strategy generation for 13 buckets × 8 textures
# ================================================================

_OOP_DEFAULTS = {
    'premium':  {'check': 0.25, 'bet_m': 0.25, 'bet_l': 0.50},
    'nut':      {'check': 0.20, 'bet_m': 0.30, 'bet_l': 0.50},
    'strong':   {'check': 0.20, 'bet_m': 0.55, 'bet_l': 0.25},
    'two_pair': {'check': 0.25, 'bet_m': 0.50, 'bet_l': 0.25},
    'top_pair': {'check': 0.35, 'bet_s': 0.25, 'bet_m': 0.40},
    'overpair': {'check': 0.40, 'bet_s': 0.25, 'bet_m': 0.35},
    'mid_pair': {'check': 0.60, 'bet_s': 0.25, 'bet_m': 0.15},
    'underpair':{'check': 0.70, 'bet_s': 0.20, 'bet_m': 0.10},
    'nut_draw': {'check': 0.25, 'bet_m': 0.40, 'bet_l': 0.35},
    'draw':     {'check': 0.40, 'bet_s': 0.30, 'bet_m': 0.30},
    'weak_made':{'check': 0.80, 'bet_s': 0.20},
    'gutshot':  {'check': 0.75, 'bet_s': 0.25},
    'air':      {'check': 0.65, 'bet_s': 0.10, 'bet_l': 0.25},
}

_IP_DEFAULTS = {
    'premium':  {'check': 0.20, 'bet_m': 0.25, 'bet_l': 0.55},
    'nut':      {'check': 0.15, 'bet_m': 0.35, 'bet_l': 0.50},
    'strong':   {'check': 0.15, 'bet_m': 0.60, 'bet_l': 0.25},
    'two_pair': {'check': 0.20, 'bet_m': 0.55, 'bet_l': 0.25},
    'top_pair': {'check': 0.25, 'bet_s': 0.30, 'bet_m': 0.45},
    'overpair': {'check': 0.30, 'bet_s': 0.35, 'bet_m': 0.35},
    'mid_pair': {'check': 0.45, 'bet_s': 0.35, 'bet_m': 0.20},
    'underpair':{'check': 0.55, 'bet_s': 0.30, 'bet_m': 0.15},
    'nut_draw': {'check': 0.15, 'bet_m': 0.45, 'bet_l': 0.40},
    'draw':     {'check': 0.25, 'bet_s': 0.35, 'bet_m': 0.40},
    'weak_made':{'check': 0.65, 'bet_s': 0.35},
    'gutshot':  {'check': 0.55, 'bet_s': 0.45},
    'air':      {'check': 0.45, 'bet_s': 0.15, 'bet_l': 0.40},
}

_FB_DEFAULTS = {
    'premium':  {'call': 0.30, 'raise': 0.70},
    'nut':      {'call': 0.40, 'raise': 0.60},
    'strong':   {'call': 0.80, 'raise': 0.20},
    'two_pair': {'call': 0.75, 'raise': 0.25},
    'top_pair': {'call': 0.75, 'fold': 0.10, 'raise': 0.15},
    'overpair': {'call': 0.70, 'fold': 0.15, 'raise': 0.15},
    'mid_pair': {'call': 0.55, 'fold': 0.45},
    'underpair':{'call': 0.40, 'fold': 0.60},
    'nut_draw': {'call': 0.45, 'raise': 0.35, 'fold': 0.20},
    'draw':     {'call': 0.50, 'raise': 0.20, 'fold': 0.30},
    'weak_made':{'fold': 0.55, 'call': 0.45},
    'gutshot':  {'fold': 0.60, 'call': 0.40},
    'air':      {'fold': 0.70, 'raise': 0.15, 'call': 0.15},
}


def _build_default_tables():
    """Generate strategy tables for all texture/bucket combinations."""
    from engine.abstraction import BUCKETS
    oop = {}
    ip = {}
    fb = {}
    for tex in TEXTURES:
        for bkt in BUCKETS:
            oop[('OOP', tex, bkt)] = dict(_OOP_DEFAULTS.get(bkt, {'check': 1.0}))
            ip[('IP', tex, bkt)] = dict(_IP_DEFAULTS.get(bkt, {'check': 1.0}))
            fb[(tex, bkt)] = dict(_FB_DEFAULTS.get(bkt, {'fold': 0.5, 'call': 0.5}))
    return oop, ip, fb


OOP_STRATEGY, IP_VS_CHECK, FACING_BET = _build_default_tables()


def get_strategy(position, texture, bucket, facing_bet=False):
    """Look up strategy for a given context."""
    if facing_bet:
        return FACING_BET.get((texture, bucket), {'fold': 0.5, 'call': 0.5})
    if position == 'OOP':
        return OOP_STRATEGY.get(('OOP', texture, bucket), {'check': 1.0})
    return IP_VS_CHECK.get(('IP', texture, bucket), {'check': 1.0})


def get_correct_actions(strategy):
    """Determine acceptable actions from a mixed strategy."""
    sorted_actions = sorted(strategy.items(), key=lambda x: -x[1])
    best_action, best_prob = sorted_actions[0]
    if best_prob >= 0.50:
        return [best_action]
    correct = [best_action]
    if len(sorted_actions) > 1:
        second_action, second_prob = sorted_actions[1]
        if second_prob >= 0.25:
            correct.append(second_action)
    return correct


# ================================================================
# Load pre-computed strategies from JSON if available
# ================================================================

_DATA_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'strategies.json')

if os.path.exists(_DATA_PATH):
    with open(_DATA_PATH) as _f:
        _SOLVED = json.load(_f)

    _strats = _SOLVED.get('strategies', {})

    for tex in TEXTURES:
        for bkt_strat in (_strats.get('OOP', {}).get(tex, {})).items():
            bkt, strat = bkt_strat
            if strat and len(strat) > 0:
                OOP_STRATEGY[('OOP', tex, bkt)] = strat

        for bkt_strat in (_strats.get('IP', {}).get(tex, {})).items():
            bkt, strat = bkt_strat
            if strat and len(strat) > 0:
                IP_VS_CHECK[('IP', tex, bkt)] = strat

        for bkt_strat in (_strats.get('FACING_BET', {}).get(tex, {})).items():
            bkt, strat = bkt_strat
            if strat and len(strat) > 0:
                FACING_BET[(tex, bkt)] = strat
