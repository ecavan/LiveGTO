"""Range vs Range analysis using precomputed bucket probabilities and equity matrix."""

import json
import os

_DATA_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'strategies.json')
_BUCKET_PROBS = {}
_EQUITY_MATRIX = {}

try:
    with open(_DATA_PATH) as f:
        _data = json.load(f)
    _BUCKET_PROBS = _data.get('bucket_probs', {})
    _EQUITY_MATRIX = _data.get('equity_matrix', {})
except FileNotFoundError:
    pass

# Positional tightness multipliers: tighter positions have more strong hands
# Values represent how to skew the base distribution
_POSITION_SKEW = {
    'OOP': {'premium': 1.1, 'nut': 1.05, 'strong': 1.0, 'good': 1.0,
            'medium': 1.0, 'draw': 1.0, 'weak_made': 0.95, 'weak_draw': 0.95, 'air': 0.9},
    'IP':  {'premium': 0.9, 'nut': 0.95, 'strong': 1.0, 'good': 1.05,
            'medium': 1.05, 'draw': 1.05, 'weak_made': 1.0, 'weak_draw': 1.0, 'air': 1.1},
}


def _apply_skew(base_dist, position):
    """Apply positional skew to a bucket distribution and re-normalize."""
    skew = _POSITION_SKEW.get(position, {})
    adjusted = {}
    for bucket, prob in base_dist.items():
        adjusted[bucket] = prob * skew.get(bucket, 1.0)
    total = sum(adjusted.values())
    if total > 0:
        adjusted = {b: p / total for b, p in adjusted.items()}
    return adjusted


def compute_range_vs_range(texture, hero_position):
    """Compute range vs range analysis for a given texture and position.

    Args:
        texture: board texture string (e.g. 'wet', 'monotone')
        hero_position: 'OOP' or 'IP'

    Returns:
        dict with hero_dist, villain_dist, hero_equity, advantage_label, advantage_magnitude
        or None if data unavailable
    """
    if texture not in _BUCKET_PROBS or texture not in _EQUITY_MATRIX:
        return None

    base_dist = _BUCKET_PROBS[texture]
    villain_position = 'IP' if hero_position == 'OOP' else 'OOP'

    hero_dist = _apply_skew(base_dist, hero_position)
    villain_dist = _apply_skew(base_dist, villain_position)
    equity_matrix = _EQUITY_MATRIX[texture]

    # Compute weighted equity: sum over all hero_bucket x villain_bucket matchups
    hero_equity = 0.0
    for hb, hp in hero_dist.items():
        for vb, vp in villain_dist.items():
            if hb in equity_matrix and vb in equity_matrix.get(hb, {}):
                eq = equity_matrix[hb][vb]
                hero_equity += hp * vp * eq

    # Determine advantage
    diff = hero_equity - 0.5
    if diff > 0.03:
        advantage_label = 'Hero has range advantage'
        advantage_color = 'emerald'
    elif diff < -0.03:
        advantage_label = 'Villain has range advantage'
        advantage_color = 'red'
    else:
        advantage_label = 'Ranges are roughly even'
        advantage_color = 'gray'

    return {
        'hero_dist': hero_dist,
        'villain_dist': villain_dist,
        'hero_equity': round(hero_equity * 100, 1),
        'villain_equity': round((1 - hero_equity) * 100, 1),
        'advantage_label': advantage_label,
        'advantage_color': advantage_color,
        'advantage_magnitude': round(abs(diff) * 100, 1),
    }
