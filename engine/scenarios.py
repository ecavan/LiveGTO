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

POSITION_ORDER = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB']


def build_seats(hero_position, hero_hand_cards=None, active_positions=None):
    """Build 6-seat table layout with hero at seat 1 (bottom center).

    Args:
        hero_position: Hero's position string (e.g. 'BTN')
        hero_hand_cards: List of card dicts for hero's face-up cards, or None
        active_positions: Set of positions currently in the hand.
                         If None, all positions are active.

    Returns:
        tuple: (seats_list, dealer_seat_index)
        seats_list is 6 dicts: {position, is_hero, is_active, cards}
        dealer_seat_index is the index (0-5) of the BTN seat
    """
    hero_idx = POSITION_ORDER.index(hero_position)
    # Seats go clockwise from hero: seat 0=hero, 1=next clockwise, ...
    seats = []
    dealer_seat = 0
    for i in range(6):
        pos = POSITION_ORDER[(hero_idx + i) % 6]
        is_hero = (i == 0)
        if active_positions is not None:
            is_active = pos in active_positions
        else:
            is_active = True
        seats.append({
            'position': pos,
            'is_hero': is_hero,
            'is_active': is_active or is_hero,
            'cards': hero_hand_cards if is_hero else None,
        })
        if pos == 'BTN':
            dealer_seat = i
    return seats, dealer_seat


def generate_preflop_rfi():
    """Generate a raise-first-in scenario."""
    position = random.choice(['UTG', 'MP', 'CO', 'BTN', 'SB'])
    deck = Deck()
    hand = deck.draw(2)
    hand_key = hand_to_key(hand[0], hand[1])

    is_raise = hand_key in RFI_RANGES[position]
    correct = 'raise' if is_raise else 'fold'

    hand_cards = [card_to_dict(c) for c in hand]
    seats, dealer_seat = build_seats(position, hand_cards)

    return {
        'type': 'preflop_rfi',
        'position': position,
        'opener': '',
        'situation': f'RFI from {position}',
        'hand': hand_cards,
        'hand_key': hand_key,
        'correct_action': correct,
        'range': sorted(RFI_RANGES[position]),
        'raise_range': None,
        'call_range': None,
        'range_size': len(RFI_RANGES[position]),
        'actions': ['raise', 'fold'],
        'action_labels': {'raise': 'Raise', 'fold': 'Fold'},
        'seats': seats,
        'dealer_seat': dealer_seat,
        'board': [],
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

    hand_cards = [card_to_dict(c) for c in hand]
    active = {hero_pos, opener_pos}
    seats, dealer_seat = build_seats(hero_pos, hand_cards, active)

    return {
        'type': 'preflop_facing',
        'position': hero_pos,
        'opener': opener_pos,
        'situation': f'{hero_pos} vs {opener_pos} open',
        'hand': hand_cards,
        'hand_key': hand_key,
        'correct_action': correct,
        'raise_range': sorted(ranges.get('raise', set())),
        'call_range': sorted(ranges.get('call', set())),
        'range': sorted(ranges.get('raise', set()) | ranges.get('call', set())),
        'range_size': len(ranges.get('raise', set())) + len(ranges.get('call', set())),
        'actions': ['raise', 'call', 'fold'],
        'action_labels': {'raise': '3-Bet', 'call': 'Call', 'fold': 'Fold'},
        'seats': seats,
        'dealer_seat': dealer_seat,
        'board': [],
    }


def generate_preflop():
    """Generate a random preflop scenario (RFI or facing open)."""
    if random.random() < 0.5:
        return generate_preflop_rfi()
    return generate_preflop_facing()


# --- Position-to-OOP/IP mapping for play mode ---
IP_POSITIONS = {'BTN', 'CO'}
OOP_POSITIONS = {'UTG', 'MP', 'SB', 'BB'}


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

    # Map OOP/IP to table positions for visual
    hand_cards = [card_to_dict(c) for c in hand]
    board_cards = [card_to_dict(c) for c in board]
    if position == 'OOP':
        hero_pos = random.choice(['UTG', 'MP', 'SB', 'BB'])
        villain_pos = random.choice(['CO', 'BTN'])
    else:
        hero_pos = random.choice(['CO', 'BTN'])
        villain_pos = random.choice(['UTG', 'MP', 'SB', 'BB'])
    active = {hero_pos, villain_pos}
    seats, dealer_seat = build_seats(hero_pos, hand_cards, active)
    pot = random.choice([6, 8, 10, 12, 15, 20])

    return {
        'type': 'postflop',
        'position': position,
        'situation': situation,
        'facing_bet': facing_bet,
        'hand': hand_cards,
        'hand_key': hand_to_key(hand[0], hand[1]),
        'board': board_cards,
        'texture': texture,
        'texture_label': TEXTURE_LABELS[texture],
        'bucket': bucket,
        'bucket_label': BUCKET_LABELS[bucket],
        'strategy': strategy,
        'correct_actions': correct_actions,
        'actions': actions,
        'action_labels': action_labels,
        'range_breakdown': range_breakdown,
        'pot': pot,
        'seats': seats,
        'dealer_seat': dealer_seat,
    }


def generate_play_scenario():
    """Generate a full hand for play mode (preflop + postflop combined).

    Deals hand + board upfront, computes both preflop and postflop data.
    Board is stored but hidden during preflop, revealed for postflop.
    """
    deck = Deck()
    hand = deck.draw(2)
    board = deck.draw(3)

    hand_cards = [card_to_dict(c) for c in hand]
    board_cards = [card_to_dict(c) for c in board]
    hand_key = hand_to_key(hand[0], hand[1])

    # Pick a random position for hero
    position = random.choice(POSITION_ORDER)

    # --- Preflop data ---
    # Determine if this is RFI or facing open based on position
    # Try facing open first (more interesting), fall back to RFI
    facing_matchups = [(h, o) for h, o in FACING_OPEN.keys() if h == position]
    if facing_matchups and random.random() < 0.5:
        hero_pos, opener_pos = random.choice(facing_matchups)
        ranges = FACING_OPEN[(hero_pos, opener_pos)]
        if hand_key in ranges.get('raise', set()):
            preflop_correct = 'raise'
        elif hand_key in ranges.get('call', set()):
            preflop_correct = 'call'
        else:
            preflop_correct = 'fold'
        preflop_type = 'preflop_facing'
        preflop_situation = f'{hero_pos} vs {opener_pos} open'
        preflop_actions = ['raise', 'call', 'fold']
        preflop_action_labels = {'raise': '3-Bet', 'call': 'Call', 'fold': 'Fold'}
        preflop_range = sorted(ranges.get('raise', set()) | ranges.get('call', set()))
        preflop_raise_range = sorted(ranges.get('raise', set()))
        preflop_call_range = sorted(ranges.get('call', set()))
        preflop_range_size = len(ranges.get('raise', set())) + len(ranges.get('call', set()))
    else:
        # RFI (BB can't RFI, use SB for check)
        rfi_pos = position if position in RFI_RANGES else 'SB'
        is_raise = hand_key in RFI_RANGES[rfi_pos]
        preflop_correct = 'raise' if is_raise else 'fold'
        preflop_type = 'preflop_rfi'
        preflop_situation = f'RFI from {rfi_pos}'
        preflop_actions = ['raise', 'fold']
        preflop_action_labels = {'raise': 'Raise', 'fold': 'Fold'}
        preflop_range = sorted(RFI_RANGES[rfi_pos])
        preflop_raise_range = None
        preflop_call_range = None
        preflop_range_size = len(RFI_RANGES[rfi_pos])
        opener_pos = ''

    # --- Postflop data ---
    postflop_position = 'IP' if position in IP_POSITIONS else 'OOP'
    texture = classify_texture(board)
    bucket = classify_hand(hand, board, texture)
    facing_bet = random.random() < 0.3
    strategy = get_strategy(postflop_position, texture, bucket, facing_bet=facing_bet)
    correct_actions = get_correct_actions(strategy)

    if facing_bet:
        post_actions = ['fold', 'call', 'raise']
        post_action_labels = {'fold': 'Fold', 'call': 'Call', 'raise': 'Raise'}
        post_situation = f'{postflop_position} facing bet'
    elif postflop_position == 'OOP':
        post_actions = ['check', 'bet_s', 'bet_m', 'bet_l']
        post_action_labels = {'check': 'Check', 'bet_s': 'Bet 33%', 'bet_m': 'Bet 66%', 'bet_l': 'Bet 100%'}
        post_situation = 'OOP first to act'
    else:
        post_actions = ['check', 'bet_s', 'bet_m', 'bet_l']
        post_action_labels = {'check': 'Check', 'bet_s': 'Bet 33%', 'bet_m': 'Bet 66%', 'bet_l': 'Bet 100%'}
        post_situation = 'IP after check'

    range_breakdown = {}
    for b in BUCKETS:
        s = get_strategy(postflop_position, texture, b, facing_bet=facing_bet)
        range_breakdown[b] = s

    # Build seats — for play mode, show villain in a logical position
    if postflop_position == 'IP':
        villain_pos_pick = random.choice(['UTG', 'MP', 'SB', 'BB'])
    else:
        villain_pos_pick = random.choice(['CO', 'BTN'])
    active = {position, villain_pos_pick}
    seats, dealer_seat = build_seats(position, hand_cards, active)
    pot = random.choice([6, 8, 10, 12, 15, 20])

    return {
        # Shared
        'hand': hand_cards,
        'hand_key': hand_key,
        'board': board_cards,
        'position': position,
        'seats': seats,
        'dealer_seat': dealer_seat,
        'pot': pot,

        # Preflop phase
        'preflop_type': preflop_type,
        'preflop_situation': preflop_situation,
        'preflop_correct': preflop_correct,
        'preflop_actions': preflop_actions,
        'preflop_action_labels': preflop_action_labels,
        'preflop_range': preflop_range,
        'preflop_raise_range': preflop_raise_range,
        'preflop_call_range': preflop_call_range,
        'preflop_range_size': preflop_range_size,
        'preflop_opener': opener_pos if preflop_type == 'preflop_facing' else '',

        # Postflop phase
        'postflop_position': postflop_position,
        'postflop_situation': post_situation,
        'texture': texture,
        'texture_label': TEXTURE_LABELS[texture],
        'bucket': bucket,
        'bucket_label': BUCKET_LABELS[bucket],
        'strategy': strategy,
        'correct_actions': correct_actions,
        'postflop_actions': post_actions,
        'postflop_action_labels': post_action_labels,
        'range_breakdown': range_breakdown,
        'facing_bet': facing_bet,
    }
