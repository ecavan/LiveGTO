"""Random scenario generators for all game modes."""

import random
from treys import Deck
from engine.cards import hand_to_key, card_to_dict
from engine.ranges import POSITIONS, RFI_RANGES, FACING_OPEN
from engine.abstraction import classify_hand, BUCKET_LABELS, BUCKETS
from engine.postflop import (
    classify_texture, get_strategy, get_correct_actions,
    ACTION_LABELS, TEXTURE_LABELS,
)


def generate_preflop_rfi():
    """Generate a raise-first-in scenario."""
    position = random.choice(['UTG', 'MP', 'CO', 'BTN', 'SB'])
    deck = Deck()
    hand = deck.draw(2)
    hand_key = hand_to_key(hand[0], hand[1])

    is_raise = hand_key in RFI_RANGES[position]
    correct = 'raise' if is_raise else 'fold'

    return {
        'type': 'preflop_rfi',
        'position': position,
        'opener': '',
        'situation': f'RFI from {position}',
        'hand': [card_to_dict(c) for c in hand],
        'hand_key': hand_key,
        'correct_action': correct,
        'range': sorted(RFI_RANGES[position]),
        'raise_range': None,
        'call_range': None,
        'range_size': len(RFI_RANGES[position]),
        'actions': ['raise', 'fold'],
        'action_labels': {'raise': 'Raise', 'fold': 'Fold'},
    }


def generate_preflop_facing():
    """Generate a facing-open scenario."""
    matchups = list(FACING_OPEN.keys())
    hero_pos, opener_pos = random.choice(matchups)

    deck = Deck()
    hand = deck.draw(2)
    hand_key = hand_to_key(hand[0], hand[1])

    ranges = FACING_OPEN[(hero_pos, opener_pos)]
    if hand_key in ranges.get('raise', set()):
        correct = 'raise'
    elif hand_key in ranges.get('call', set()):
        correct = 'call'
    else:
        correct = 'fold'

    return {
        'type': 'preflop_facing',
        'position': hero_pos,
        'opener': opener_pos,
        'situation': f'{hero_pos} vs {opener_pos} open',
        'hand': [card_to_dict(c) for c in hand],
        'hand_key': hand_key,
        'correct_action': correct,
        'raise_range': sorted(ranges.get('raise', set())),
        'call_range': sorted(ranges.get('call', set())),
        'range': sorted(ranges.get('raise', set()) | ranges.get('call', set())),
        'range_size': len(ranges.get('raise', set())) + len(ranges.get('call', set())),
        'actions': ['raise', 'call', 'fold'],
        'action_labels': {'raise': '3-Bet', 'call': 'Call', 'fold': 'Fold'},
    }


def generate_preflop():
    """Generate a random preflop scenario (RFI or facing open)."""
    if random.random() < 0.5:
        return generate_preflop_rfi()
    return generate_preflop_facing()


def generate_postflop():
    """Generate a postflop decision scenario."""
    deck = Deck()
    hand = deck.draw(2)
    board = deck.draw(3)

    position = random.choice(['OOP', 'IP'])
    texture = classify_texture(board)
    bucket = classify_hand(hand, board, texture)

    # Randomly decide if facing a bet or acting first
    facing_bet = random.random() < 0.3
    strategy = get_strategy(position, texture, bucket, facing_bet=facing_bet)
    correct_actions = get_correct_actions(strategy)

    if facing_bet:
        actions = ['fold', 'call', 'raise']
        action_labels = {'fold': 'Fold', 'call': 'Call', 'raise': 'Raise'}
        situation = f'{position} facing bet on {texture.replace("_", " ")} board'
    elif position == 'OOP':
        actions = ['check', 'bet_s', 'bet_m', 'bet_l']
        action_labels = {'check': 'Check', 'bet_s': 'Bet 33%', 'bet_m': 'Bet 66%', 'bet_l': 'Bet 100%'}
        situation = f'OOP first to act on {texture.replace("_", " ")} board'
    else:
        actions = ['check', 'bet_s', 'bet_m', 'bet_l']
        action_labels = {'check': 'Check', 'bet_s': 'Bet 33%', 'bet_m': 'Bet 66%', 'bet_l': 'Bet 100%'}
        situation = f'IP after check on {texture.replace("_", " ")} board'

    # Build range breakdown for all buckets
    range_breakdown = {}
    for b in BUCKETS:
        s = get_strategy(position, texture, b, facing_bet=facing_bet)
        range_breakdown[b] = s

    return {
        'type': 'postflop',
        'position': position,
        'situation': situation,
        'facing_bet': facing_bet,
        'hand': [card_to_dict(c) for c in hand],
        'hand_key': hand_to_key(hand[0], hand[1]),
        'board': [card_to_dict(c) for c in board],
        'texture': texture,
        'texture_label': TEXTURE_LABELS[texture],
        'bucket': bucket,
        'bucket_label': BUCKET_LABELS[bucket],
        'strategy': strategy,
        'correct_actions': correct_actions,
        'actions': actions,
        'action_labels': action_labels,
        'range_breakdown': range_breakdown,
        'pot': random.choice([6, 8, 10, 12, 15, 20]),
    }
