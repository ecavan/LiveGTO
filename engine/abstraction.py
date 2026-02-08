"""Context-aware hand bucketing using treys evaluator + board texture."""

from collections import Counter
from treys import Card
from engine.cards import EVALUATOR

# 9 buckets — ordered strongest to weakest
PREMIUM = 'premium'
NUT = 'nut'
STRONG = 'strong'
GOOD = 'good'
MEDIUM = 'medium'
DRAW = 'draw'
WEAK_MADE = 'weak_made'
WEAK_DRAW = 'weak_draw'
AIR = 'air'

BUCKETS = [PREMIUM, NUT, STRONG, GOOD, MEDIUM, DRAW, WEAK_MADE, WEAK_DRAW, AIR]

BUCKET_LABELS = {
    PREMIUM: 'Premium (top set dry, nut flush, full house+)',
    NUT: 'Nut (set, flush, top two, combo draw)',
    STRONG: 'Strong (overpair QQ+, TPTK, straight)',
    GOOD: 'Good (overpair TT-JJ, TP good kicker)',
    MEDIUM: 'Medium (low overpair, TP weak kicker, mid pair)',
    DRAW: 'Draw (flush draw, OESD)',
    WEAK_MADE: 'Weak made (bottom pair, underpair)',
    WEAK_DRAW: 'Weak draw (gutshot, backdoor)',
    AIR: 'Air (nothing)',
}

BUCKET_EXAMPLES = {
    PREMIUM: ['AA on A72r', 'KK on K83r', 'Full house+', 'Nut flush (Ah on 3-flush)'],
    NUT: ['Set (e.g. 77 on 7T2)', 'Non-nut flush', 'Top two pair', 'Combo draw (FD+OESD)'],
    STRONG: ['QQ+ overpair on wet', 'TPTK (e.g. AK on K94)', 'Straight using both cards'],
    GOOD: ['TT-JJ overpair', 'TP good kicker (e.g. KQ on K85)', 'One-card straight'],
    MEDIUM: ['Low overpair (88-99)', 'TP weak kicker (e.g. K7 on K94)', 'Middle pair'],
    DRAW: ['Flush draw (4 to flush)', 'Open-ended straight draw (8 outs)'],
    WEAK_MADE: ['Bottom pair', 'Underpair below 2nd board card', 'Pocket pair < board'],
    WEAK_DRAW: ['Gutshot (4 outs)', 'Backdoor flush draw', 'A/K overcard'],
    AIR: ['No pair, no draw', 'Missed completely'],
}


def classify_hand(hand, board, texture=None):
    """
    Classify hand into one of 9 buckets.
    Texture-aware: the same hand ranks differently on different boards.
    """
    if texture is None:
        from engine.postflop import classify_texture
        texture = classify_texture(board)

    score = EVALUATOR.evaluate(board, hand)
    rank_class = EVALUATOR.get_rank_class(score)
    # 0=Royal Flush, 1=Straight Flush, 2=Four of a Kind, 3=Full House,
    # 4=Flush, 5=Straight, 6=Three of a Kind, 7=Two Pair, 8=Pair, 9=High Card

    # --- Unbeatable / near-unbeatable ---
    if rank_class <= 1:  # Royal flush, straight flush
        return PREMIUM
    if rank_class == 2:  # Quads
        return PREMIUM
    if rank_class == 3:  # Full house
        return PREMIUM

    # --- Flush: depends on how high ---
    if rank_class == 4:
        return _classify_flush(hand, board, texture)

    # --- Straight: depends on board texture and nut-ness ---
    if rank_class == 5:
        return _classify_straight(hand, board, texture)

    # --- Three of a kind (set or trips): heavily texture-dependent ---
    if rank_class == 6:
        return _classify_trips(hand, board, texture)

    # --- Two pair ---
    if rank_class == 7:
        return _classify_two_pair(hand, board, texture)

    # --- One pair ---
    if rank_class == 8:
        return _classify_pair(hand, board, texture)

    # --- High card: check for draws ---
    return _classify_unmade(hand, board, texture)


# ================================================================
# Made hand sub-classifiers
# ================================================================

def _classify_flush(hand, board, texture):
    """Nut flush vs non-nut flush."""
    # Find the flush suit
    all_cards = hand + board
    suits = [Card.get_suit_int(c) for c in all_cards]
    suit_counts = Counter(suits)
    flush_suit = max(suit_counts, key=suit_counts.get)

    # Get ranks of our hole cards in the flush suit
    hero_flush_ranks = []
    for c in hand:
        if Card.get_suit_int(c) == flush_suit:
            hero_flush_ranks.append(Card.get_rank_int(c))

    if not hero_flush_ranks:
        # Board flush — we don't really "have" it, treat as the board's hand
        return GOOD

    best_hero = max(hero_flush_ranks)
    if best_hero == 12:  # Ace-high flush
        return PREMIUM
    if best_hero >= 10:  # King or Queen-high flush
        return NUT
    return STRONG  # Low flush — vulnerable to higher flushes


def _classify_straight(hand, board, texture):
    """Nut straight vs non-nut, texture-aware."""
    hand_ranks = sorted([Card.get_rank_int(c) for c in hand], reverse=True)
    board_ranks = sorted([Card.get_rank_int(c) for c in board], reverse=True)

    # Check if we're using both hole cards (stronger) or just one
    all_ranks = sorted([Card.get_rank_int(c) for c in hand + board], reverse=True)
    uses_both = _straight_uses_both(hand_ranks, board_ranks)

    is_wet = texture in ('wet', 'monotone')

    if uses_both:
        # Two-card straight with both hole cards — strong
        if is_wet:
            return STRONG
        return NUT
    else:
        # One-card straight — more vulnerable, easy to be dominated
        if is_wet:
            return GOOD
        return STRONG


def _straight_uses_both(hand_ranks, board_ranks):
    """Heuristic: if both hole cards are needed for the straight."""
    # If either hole card is also a board rank, we only "need" one
    return not any(hr in board_ranks for hr in hand_ranks)


def _classify_trips(hand, board, texture):
    """
    Set vs trips, top vs bottom, texture-aware.
    Set = pocket pair + board match. Trips = one in hand + board pair.
    """
    hand_ranks = [Card.get_rank_int(c) for c in hand]
    board_ranks = sorted([Card.get_rank_int(c) for c in board], reverse=True)
    top_board = board_ranks[0]

    is_set = hand_ranks[0] == hand_ranks[1]  # Pocket pair
    trip_rank = hand_ranks[0] if is_set else None
    if not is_set:
        # Find which rank makes trips
        board_rank_counts = Counter(board_ranks)
        for r, cnt in board_rank_counts.items():
            if cnt >= 2 and r in hand_ranks:
                trip_rank = r
                break
            if cnt >= 2:
                # Board trips, we don't have it
                trip_rank = r
                break

    is_scary = texture in ('wet', 'monotone')

    if is_set:
        # Sets are hidden and strong
        if trip_rank == top_board:
            # Top set
            if is_scary:
                return NUT  # Top set on wet — great but draws are out there
            return PREMIUM  # Top set on dry — monster
        else:
            # Middle or bottom set
            if is_scary:
                return STRONG  # Vulnerable to straights/flushes
            return NUT  # Still very strong on dry
    else:
        # Trips (board pair) — more visible, weaker kicker situation
        if is_scary:
            return GOOD
        return STRONG


def _classify_two_pair(hand, board, texture):
    """Top two vs bottom two, texture-aware."""
    hand_ranks = sorted([Card.get_rank_int(c) for c in hand], reverse=True)
    board_ranks = sorted([Card.get_rank_int(c) for c in board], reverse=True)
    top_board = board_ranks[0]
    second_board = board_ranks[1] if len(board_ranks) > 1 else 0

    is_scary = texture in ('wet', 'monotone')

    # Check if both hole cards pair board cards
    hero_paired = [hr for hr in hand_ranks if hr in board_ranks]

    if len(hero_paired) >= 2:
        # True two pair using both hole cards
        if hand_ranks[0] == top_board and hand_ranks[1] == second_board:
            # Top two pair
            if is_scary:
                return STRONG
            return NUT
        elif hand_ranks[0] == top_board or hand_ranks[1] == top_board:
            # Top + bottom two pair
            if is_scary:
                return GOOD
            return STRONG
        else:
            # Bottom two pair
            if is_scary:
                return GOOD
            return STRONG
    else:
        # Counterfeitable or using one hole card
        if is_scary:
            return GOOD
        return STRONG


def _classify_pair(hand, board, texture):
    """Overpair / top pair / middle pair / bottom pair — very granular."""
    hand_ranks = sorted([Card.get_rank_int(c) for c in hand], reverse=True)
    board_ranks = sorted([Card.get_rank_int(c) for c in board], reverse=True)
    top_board = board_ranks[0]
    second_board = board_ranks[1] if len(board_ranks) > 1 else -1
    third_board = board_ranks[2] if len(board_ranks) > 2 else -1

    is_scary = texture in ('wet', 'monotone')

    # --- Overpair: pocket pair above all board cards ---
    if hand_ranks[0] == hand_ranks[1] and hand_ranks[0] > top_board:
        pair_rank = hand_ranks[0]
        if pair_rank >= 10:  # QQ, KK, AA
            if is_scary:
                return GOOD  # Even QQ+ is just "good" on a wet/monotone board
            return STRONG
        elif pair_rank >= 8:  # TT, JJ
            if is_scary:
                return MEDIUM
            return GOOD
        else:  # 99 and below
            return MEDIUM

    # --- Top pair ---
    if hand_ranks[0] == top_board or hand_ranks[1] == top_board:
        kicker = hand_ranks[0] if hand_ranks[1] == top_board else hand_ranks[1]
        if kicker >= 12:  # Ace kicker
            if is_scary:
                return GOOD
            return STRONG  # TPTK
        elif kicker >= 9:  # J-Q kicker
            if is_scary:
                return MEDIUM
            return GOOD  # TP good kicker
        else:
            return MEDIUM  # TP weak kicker

    # --- Middle pair ---
    if hand_ranks[0] == second_board or hand_ranks[1] == second_board:
        # Check for draws to upgrade
        draw = _check_draws(hand, board)
        if draw == DRAW:
            return DRAW  # Middle pair + flush draw plays as a draw
        return MEDIUM if not is_scary else WEAK_MADE

    # --- Bottom pair / underpair ---
    if hand_ranks[0] == third_board or hand_ranks[1] == third_board:
        return WEAK_MADE

    # Pocket pair below the board (underpair)
    if hand_ranks[0] == hand_ranks[1] and hand_ranks[0] < top_board:
        if hand_ranks[0] > second_board:
            return MEDIUM  # Between top and second — has some showdown
        return WEAK_MADE

    # Small pair with a draw
    draw = _check_draws(hand, board)
    if draw:
        return draw
    return WEAK_MADE


# ================================================================
# Draw classifiers
# ================================================================

def _classify_unmade(hand, board, texture):
    """For unpaired hands: check draws, then overcards, then air."""
    draw = _check_draws(hand, board)
    if draw:
        return draw

    # Overcards (A or K high, unpaired) — very marginal but not pure air
    hand_ranks = sorted([Card.get_rank_int(c) for c in hand], reverse=True)
    board_ranks = sorted([Card.get_rank_int(c) for c in board], reverse=True)
    if hand_ranks[0] > board_ranks[0]:
        # We have an overcard — slight equity
        return WEAK_DRAW if hand_ranks[0] >= 11 else AIR  # K+ overcards

    return AIR


def _check_draws(hand, board):
    """Detect flush draws, straight draws, combo draws."""
    all_cards = hand + board
    suits = [Card.get_suit_int(c) for c in all_cards]
    ranks = sorted(set(Card.get_rank_int(c) for c in all_cards))

    suit_counts = Counter(suits)
    has_flush_draw = any(count == 4 for count in suit_counts.values())
    has_oesd = _has_open_ended(ranks)
    has_gutshot = _has_gutshot(ranks)

    # Combo draw — flush draw + straight draw
    if has_flush_draw and (has_oesd or has_gutshot):
        return NUT  # Combo draws have massive equity, play like strong hands
    if has_flush_draw:
        return DRAW
    if has_oesd:
        return DRAW
    if has_gutshot:
        return WEAK_DRAW

    # Backdoor flush (flop only)
    if len(board) == 3:
        if any(count == 3 for count in suit_counts.values()):
            return WEAK_DRAW

    return None


def _has_open_ended(sorted_ranks):
    """4 consecutive ranks, open on both ends."""
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
    """4 ranks within a span of 5."""
    extended = sorted_ranks[:]
    if 12 in extended:
        extended = [-1] + extended
    for i in range(len(extended) - 3):
        if extended[i + 3] - extended[i] == 4:
            return True
    return False
