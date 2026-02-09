"""Context-aware hand bucketing using treys evaluator + board texture.
Classifies hands into 13 strength buckets.
"""

from collections import Counter
from treys import Card
from engine.cards import EVALUATOR

# 13 buckets — ordered strongest to weakest
PREMIUM = 'premium'
NUT = 'nut'
STRONG = 'strong'
TWO_PAIR = 'two_pair'
TOP_PAIR = 'top_pair'
OVERPAIR = 'overpair'
MID_PAIR = 'mid_pair'
UNDERPAIR = 'underpair'
NUT_DRAW = 'nut_draw'
DRAW = 'draw'
WEAK_MADE = 'weak_made'
GUTSHOT = 'gutshot'
AIR = 'air'

BUCKETS = [PREMIUM, NUT, STRONG, TWO_PAIR, TOP_PAIR, OVERPAIR,
           MID_PAIR, UNDERPAIR, NUT_DRAW, DRAW, WEAK_MADE, GUTSHOT, AIR]

BUCKET_LABELS = {
    PREMIUM: 'Premium (full house+, nut flush, top set dry)',
    NUT: 'Nut (set, K/Q-high flush)',
    STRONG: 'Strong (overpair QQ+, TPTK, straight)',
    TWO_PAIR: 'Two pair',
    TOP_PAIR: 'Top pair good kicker',
    OVERPAIR: 'Overpair (TT-JJ)',
    MID_PAIR: 'Mid pair / TP weak kicker',
    UNDERPAIR: 'Underpair (88-99, pocket pair < board)',
    NUT_DRAW: 'Nut draw (combo draw, nut FD)',
    DRAW: 'Draw (flush draw, OESD)',
    WEAK_MADE: 'Weak made (bottom pair)',
    GUTSHOT: 'Gutshot / backdoor / overcards',
    AIR: 'Air (nothing)',
}


def classify_hand(hand, board, texture=None):
    """Classify hand into one of 13 buckets."""
    if texture is None:
        from engine.postflop import classify_texture
        texture = classify_texture(board)

    score = EVALUATOR.evaluate(board, hand)
    rank_class = EVALUATOR.get_rank_class(score)

    if rank_class <= 1:
        return PREMIUM
    if rank_class == 2:
        return PREMIUM
    if rank_class == 3:
        return PREMIUM
    if rank_class == 4:
        return _classify_flush(hand, board)
    if rank_class == 5:
        return _classify_straight(hand, board)
    if rank_class == 6:
        return _classify_trips(hand, board)
    if rank_class == 7:
        return TWO_PAIR
    if rank_class == 8:
        return _classify_pair(hand, board)
    return _classify_unmade(hand, board)


def _classify_flush(hand, board):
    all_cards = hand + board
    suits = [Card.get_suit_int(c) for c in all_cards]
    suit_counts = Counter(suits)
    flush_suit = max(suit_counts, key=suit_counts.get)

    hero_flush_ranks = [Card.get_rank_int(c) for c in hand
                        if Card.get_suit_int(c) == flush_suit]

    if not hero_flush_ranks:
        return MID_PAIR  # Board flush, shared equity

    best_hero = max(hero_flush_ranks)
    if best_hero == 12:
        return PREMIUM
    if best_hero >= 10:
        return NUT
    return STRONG


def _classify_straight(hand, board):
    hand_ranks = sorted([Card.get_rank_int(c) for c in hand], reverse=True)
    board_ranks = sorted([Card.get_rank_int(c) for c in board], reverse=True)
    uses_both = not any(hr in board_ranks for hr in hand_ranks)

    if uses_both:
        return STRONG
    return TWO_PAIR  # One-card straight, similar strength to two pair


def _classify_trips(hand, board):
    hand_ranks = [Card.get_rank_int(c) for c in hand]
    board_ranks = sorted([Card.get_rank_int(c) for c in board], reverse=True)
    top_board = board_ranks[0]
    is_set = hand_ranks[0] == hand_ranks[1]

    if is_set:
        trip_rank = hand_ranks[0]
        if trip_rank == top_board:
            return PREMIUM  # Top set
        return NUT  # Non-top set
    return STRONG  # Trips


def _classify_pair(hand, board):
    hand_ranks = sorted([Card.get_rank_int(c) for c in hand], reverse=True)
    board_ranks = sorted([Card.get_rank_int(c) for c in board], reverse=True)
    top_board = board_ranks[0]
    second_board = board_ranks[1] if len(board_ranks) > 1 else -1
    third_board = board_ranks[2] if len(board_ranks) > 2 else -1

    # Overpair
    if hand_ranks[0] == hand_ranks[1] and hand_ranks[0] > top_board:
        pair_rank = hand_ranks[0]
        if pair_rank >= 10:  # QQ, KK, AA
            return STRONG
        if pair_rank >= 8:  # TT, JJ
            return OVERPAIR
        return UNDERPAIR  # 99 and below

    # Top pair
    if hand_ranks[0] == top_board or hand_ranks[1] == top_board:
        kicker = hand_ranks[0] if hand_ranks[1] == top_board else hand_ranks[1]
        if kicker >= 9:  # J+ kicker
            return TOP_PAIR
        return MID_PAIR  # Weak kicker

    # Middle pair
    if hand_ranks[0] == second_board or hand_ranks[1] == second_board:
        draw = _check_draws(hand, board)
        if draw == DRAW or draw == NUT_DRAW:
            return draw
        return MID_PAIR

    # Bottom pair
    if hand_ranks[0] == third_board or hand_ranks[1] == third_board:
        return WEAK_MADE

    # Underpair
    if hand_ranks[0] == hand_ranks[1] and hand_ranks[0] < top_board:
        if hand_ranks[0] > second_board:
            return UNDERPAIR
        return WEAK_MADE

    draw = _check_draws(hand, board)
    if draw:
        return draw
    return WEAK_MADE


def _classify_unmade(hand, board):
    draw = _check_draws(hand, board)
    if draw:
        return draw

    hand_ranks = sorted([Card.get_rank_int(c) for c in hand], reverse=True)
    board_ranks = sorted([Card.get_rank_int(c) for c in board], reverse=True)
    if hand_ranks[0] > board_ranks[0]:
        return GUTSHOT if hand_ranks[0] >= 11 else AIR
    return AIR


def _check_draws(hand, board):
    all_cards = hand + board
    suits = [Card.get_suit_int(c) for c in all_cards]
    ranks = sorted(set(Card.get_rank_int(c) for c in all_cards))

    suit_counts = Counter(suits)
    has_flush_draw = any(count == 4 for count in suit_counts.values())
    has_oesd = _has_open_ended(ranks)
    has_gutshot = _has_gutshot(ranks)

    if has_flush_draw and (has_oesd or has_gutshot):
        return NUT_DRAW
    if has_flush_draw:
        return DRAW
    if has_oesd:
        return DRAW
    if has_gutshot:
        return GUTSHOT

    if len(board) == 3:
        if any(count == 3 for count in suit_counts.values()):
            return GUTSHOT

    return None


def _has_open_ended(sorted_ranks):
    extended = sorted_ranks[:]
    if 12 in extended:
        extended = [-1] + extended
    for i in range(len(extended) - 3):
        if extended[i + 3] - extended[i] == 3:
            low, high = extended[i], extended[i + 3]
            if low > -1 and high < 12:
                return True
    return False


def _has_gutshot(sorted_ranks):
    extended = sorted_ranks[:]
    if 12 in extended:
        extended = [-1] + extended
    for i in range(len(extended) - 3):
        if extended[i + 3] - extended[i] == 4:
            return True
    return False
