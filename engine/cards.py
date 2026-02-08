from treys import Card, Deck, Evaluator

EVALUATOR = Evaluator()

RANK_MAP = {0: '2', 1: '3', 2: '4', 3: '5', 4: '6', 5: '7',
            6: '8', 7: '9', 8: 'T', 9: 'J', 10: 'Q', 11: 'K', 12: 'A'}
SUIT_MAP = {1: 's', 2: 'h', 4: 'd', 8: 'c'}
SUIT_SYMBOLS = {1: '\u2660', 2: '\u2665', 4: '\u2666', 8: '\u2663'}
SUIT_COLORS = {1: 'black', 2: 'red', 4: 'red', 8: 'black'}


def card_to_dict(card_int):
    """Convert treys card int to display dict for templates."""
    rank_int = Card.get_rank_int(card_int)
    suit_int = Card.get_suit_int(card_int)
    return {
        'rank': RANK_MAP[rank_int],
        'suit': SUIT_MAP[suit_int],
        'suit_symbol': SUIT_SYMBOLS[suit_int],
        'color': SUIT_COLORS[suit_int],
        'str': RANK_MAP[rank_int] + SUIT_MAP[suit_int],
    }


def hand_to_key(card1_int, card2_int):
    """Convert two hole cards to canonical preflop key like 'AKs', 'QJo', '88'."""
    r1 = Card.get_rank_int(card1_int)
    r2 = Card.get_rank_int(card2_int)
    s1 = Card.get_suit_int(card1_int)
    s2 = Card.get_suit_int(card2_int)
    high, low = max(r1, r2), min(r1, r2)
    high_c = RANK_MAP[high]
    low_c = RANK_MAP[low]
    if high == low:
        return f"{high_c}{low_c}"
    elif s1 == s2:
        return f"{high_c}{low_c}s"
    else:
        return f"{high_c}{low_c}o"


def deal_hand(num_board=0):
    """Deal hole cards and optional board cards."""
    deck = Deck()
    hand = deck.draw(2)
    board = deck.draw(num_board) if num_board > 0 else []
    return hand, board
