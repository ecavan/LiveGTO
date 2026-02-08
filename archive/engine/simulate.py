"""Simulate mode — heads-up session with imperfect AI villain."""

import random
from treys import Card, Deck
from engine.cards import hand_to_key, card_to_dict, EVALUATOR
from engine.ranges import RFI_RANGES, FACING_OPEN
from engine.abstraction import classify_hand
from engine.postflop import (
    classify_texture, get_strategy, get_correct_actions,
    ACTION_LABELS, TEXTURE_LABELS,
)


def _card_str_to_int(s):
    """Convert '8h' to treys card int."""
    return Card.new(s)


def _card_int_to_str(c):
    """Convert treys card int to '8h' string."""
    return Card.int_to_str(c)


def generate_sim_hand(hero_stack, villain_stack, hand_number, hero_is_sb):
    """Deal a new hand for simulate mode.

    In heads-up:
    - SB = BTN = posts 0.5 BB, acts first preflop, acts last postflop (IP)
    - BB = posts 1.0 BB, acts last preflop, acts first postflop (OOP)
    """
    deck = Deck()
    hero_hand = deck.draw(2)
    villain_hand = deck.draw(2)
    board = deck.draw(5)

    hero_hand_strs = [_card_int_to_str(c) for c in hero_hand]
    villain_hand_strs = [_card_int_to_str(c) for c in villain_hand]
    board_strs = [_card_int_to_str(c) for c in board]

    hero_hand_cards = [card_to_dict(c) for c in hero_hand]
    villain_hand_cards = [card_to_dict(c) for c in villain_hand]
    board_cards = [card_to_dict(c) for c in board]

    hero_hand_key = hand_to_key(hero_hand[0], hero_hand[1])
    villain_hand_key = hand_to_key(villain_hand[0], villain_hand[1])

    # Post blinds
    sb_amount = 0.5
    bb_amount = 1.0
    if hero_is_sb:
        hero_invested = sb_amount
        villain_invested = bb_amount
        hero_position = 'SB'
        villain_position = 'BB'
    else:
        hero_invested = bb_amount
        villain_invested = sb_amount
        hero_position = 'BB'
        villain_position = 'SB'

    pot = sb_amount + bb_amount

    return {
        'hero_stack': hero_stack - hero_invested,
        'villain_stack': villain_stack - villain_invested,
        'pot': pot,
        'hand_number': hand_number,
        'hero_is_sb': hero_is_sb,
        'hero_position': hero_position,
        'villain_position': villain_position,
        'hero_hand_strs': hero_hand_strs,
        'villain_hand_strs': villain_hand_strs,
        'board_strs': board_strs,
        'hero_hand': hero_hand_cards,
        'villain_hand': villain_hand_cards,
        'board_cards': board_cards,
        'hero_hand_key': hero_hand_key,
        'villain_hand_key': villain_hand_key,
        'street': 'preflop',
        'board_visible': 0,
        'street_to_act': 'hero' if hero_is_sb else 'villain',
        'street_bet': 0.0,
        'hero_street_invested': 0.0,
        'villain_street_invested': 0.0,
        'hero_total_invested': hero_invested,
        'villain_total_invested': villain_invested,
        'sim_phase': 'preflop_decision',
        'villain_last_action': None,
        'session_log': [],
        'current_hand_actions': [],
        'hand_over': False,
        'winner': None,
    }


def villain_preflop_act(hand_key, position, facing_raise=False, noise=0.30):
    """Determine villain's preflop action.

    70% GTO-based, 30% random noise.
    """
    if random.random() < noise:
        # Noise: random action
        if facing_raise:
            return random.choice(['call', 'fold', 'raise'])
        else:
            return random.choice(['raise', 'fold'])

    # GTO action
    if facing_raise:
        # Villain facing a raise — check FACING_OPEN
        if position == 'BB':
            matchups = [(h, o) for h, o in FACING_OPEN.keys() if h == 'BB']
        else:
            matchups = [(h, o) for h, o in FACING_OPEN.keys() if h == position]

        if matchups:
            hero_pos, opener_pos = matchups[0]
            ranges = FACING_OPEN[(hero_pos, opener_pos)]
            if hand_key in ranges.get('raise', set()):
                return 'raise'
            elif hand_key in ranges.get('call', set()):
                return 'call'
        return 'fold'
    else:
        # Villain RFI — check if hand is in RFI range for position
        rfi_pos = position if position in RFI_RANGES else 'BTN'
        if hand_key in RFI_RANGES[rfi_pos]:
            return 'raise'
        return 'fold'


def villain_postflop_act(hand_strs, board_strs, position, facing_bet=False, noise=0.30):
    """Determine villain's postflop action.

    position: 'OOP' or 'IP'
    """
    hand_ints = [_card_str_to_int(s) for s in hand_strs]
    board_ints = [_card_str_to_int(s) for s in board_strs]

    texture = classify_texture(board_ints)
    bucket = classify_hand(hand_ints, board_ints, texture)
    strategy = get_strategy(position, texture, bucket, facing_bet=facing_bet)

    if random.random() < noise:
        # Noise: random action
        if facing_bet:
            return random.choice(['call', 'fold', 'raise'])
        else:
            return random.choice(['check', 'bet_m'])

    # Sample from GTO distribution
    actions = list(strategy.keys())
    probs = list(strategy.values())
    total = sum(probs)
    if total == 0:
        return 'check' if not facing_bet else 'fold'
    probs = [p / total for p in probs]
    chosen = random.choices(actions, weights=probs, k=1)[0]

    # Map bet sizes to a single 'bet' action for simplicity
    if chosen in ('bet_s', 'bet_m', 'bet_l'):
        return chosen
    return chosen


def resolve_showdown(hero_hand_strs, villain_hand_strs, board_strs):
    """Determine winner at showdown.

    Returns 'hero', 'villain', or 'split'.
    """
    hero_ints = [_card_str_to_int(s) for s in hero_hand_strs]
    villain_ints = [_card_str_to_int(s) for s in villain_hand_strs]
    board_ints = [_card_str_to_int(s) for s in board_strs]

    hero_score = EVALUATOR.evaluate(board_ints, hero_ints)
    villain_score = EVALUATOR.evaluate(board_ints, villain_ints)

    if hero_score < villain_score:
        return 'hero'
    elif villain_score < hero_score:
        return 'villain'
    return 'split'


def get_hero_gto_action(hand_key, position, street, hand_strs=None, board_strs=None, facing_bet=False):
    """Get the GTO-correct action for hero (for deviation tracking)."""
    if street == 'preflop':
        if facing_bet:
            matchups = [(h, o) for h, o in FACING_OPEN.keys() if h == position]
            if matchups:
                _, opener = matchups[0]
                ranges = FACING_OPEN[(position, opener)]
                if hand_key in ranges.get('raise', set()):
                    return 'raise'
                elif hand_key in ranges.get('call', set()):
                    return 'call'
            return 'fold'
        else:
            rfi_pos = position if position in RFI_RANGES else 'BTN'
            if hand_key in RFI_RANGES[rfi_pos]:
                return 'raise'
            return 'fold'
    else:
        # Postflop
        if hand_strs and board_strs:
            hand_ints = [_card_str_to_int(s) for s in hand_strs]
            board_ints = [_card_str_to_int(s) for s in board_strs]
            postflop_pos = 'IP' if position in ('SB', 'BTN') else 'OOP'
            texture = classify_texture(board_ints)
            bucket = classify_hand(hand_ints, board_ints, texture)
            strategy = get_strategy(postflop_pos, texture, bucket, facing_bet=facing_bet)
            correct = get_correct_actions(strategy)
            return correct[0] if correct else 'check'
    return 'check'


def compute_deviation(hero_action, gto_action, strategy=None):
    """Compute how far hero's action deviates from GTO.

    Returns 0.0 for the best action, up to 1.0 for the worst.
    """
    if hero_action == gto_action:
        return 0.0
    if strategy:
        hero_freq = strategy.get(hero_action, 0)
        max_freq = max(strategy.values()) if strategy else 1
        if max_freq > 0:
            return 1.0 - (hero_freq / max_freq)
    return 1.0


def compute_session_review(session_log):
    """Compute session review stats from the hand log.

    Returns dict with stats and top mistakes.
    """
    if not session_log:
        return {
            'total_pl': 0,
            'hands_played': 0,
            'bb_per_hand': 0,
            'biggest_win': 0,
            'biggest_loss': 0,
            'top_mistakes': [],
        }

    total_pl = sum(h.get('result_bb', 0) for h in session_log)
    hands_played = len(session_log)
    bb_per_hand = total_pl / hands_played if hands_played > 0 else 0

    results = [h.get('result_bb', 0) for h in session_log]
    biggest_win = max(results) if results else 0
    biggest_loss = min(results) if results else 0

    # Collect all deviations from all hands
    all_deviations = []
    for hand in session_log:
        for action_record in hand.get('actions', []):
            dev = action_record.get('deviation', 0)
            if dev > 0.3:  # Only track significant deviations
                all_deviations.append({
                    'hand_num': hand.get('hand_num', 0),
                    'hero_hand': hand.get('hero_hand_key', '?'),
                    'street': action_record.get('street', '?'),
                    'hero_action': action_record.get('action', '?'),
                    'gto_action': action_record.get('gto_action', '?'),
                    'deviation': dev,
                })

    # Top 5 worst mistakes
    all_deviations.sort(key=lambda x: -x['deviation'])
    top_mistakes = all_deviations[:5]

    return {
        'total_pl': round(total_pl, 1),
        'hands_played': hands_played,
        'bb_per_hand': round(bb_per_hand, 2),
        'biggest_win': round(biggest_win, 1),
        'biggest_loss': round(biggest_loss, 1),
        'top_mistakes': top_mistakes,
    }


# Bet sizing constants
OPEN_RAISE = 2.5
THREE_BET = 8.0
BET_SIZES = {'bet_s': 0.33, 'bet_m': 0.66, 'bet_l': 1.0}


def apply_bet_amount(pot, action):
    """Calculate bet amount in BB."""
    if action in BET_SIZES:
        return round(pot * BET_SIZES[action], 1)
    elif action == 'raise':
        return round(pot * 0.75, 1)  # Standard raise = 75% pot
    return 0
