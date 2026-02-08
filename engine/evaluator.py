"""Check user answers and generate feedback."""

from engine.abstraction import BUCKET_EXAMPLES
from engine.postflop import get_correct_actions
from engine.range_analysis import compute_range_vs_range


def evaluate_preflop(user_action, scenario):
    """Evaluate a preflop answer with mixed strategy awareness.

    For facing-open scenarios: if the hand is in the call range but user raises
    (or vice versa), that's acceptable — both are "in range" actions.
    For RFI: strictly correct or incorrect, but with softer messaging for
    borderline hands.
    """
    correct = scenario['correct_action']
    hand_key = scenario['hand_key']
    position = scenario['position']
    is_correct = user_action == correct

    # Mixed strategy logic for facing-open scenarios
    is_acceptable = False
    if scenario['type'] == 'preflop_facing':
        raise_range = scenario.get('raise_range') or []
        call_range = scenario.get('call_range') or []
        in_raise = hand_key in raise_range
        in_call = hand_key in call_range
        in_range = in_raise or in_call

        if not is_correct:
            # Raising when should call (or vice versa) is acceptable — both in-range
            if user_action in ('raise', 'call') and in_range:
                is_acceptable = True
            # Folding an in-range hand is wrong, raising/calling a fold hand is wrong

    if scenario['type'] == 'preflop_rfi':
        if is_correct:
            explanation = (f"Correct! {hand_key} is a "
                          f"{correct} from {position}.")
        else:
            explanation = (f"{hand_key} should be a {correct} "
                          f"from {position}. "
                          f"The {position} RFI range has "
                          f"{scenario['range_size']} combos.")
    else:
        opener = scenario.get('opener', '')
        if is_correct:
            explanation = (f"Correct! {hand_key} is a "
                          f"{correct} from {position} "
                          f"vs {opener} open.")
        elif is_acceptable:
            explanation = (f"Acceptable. {hand_key} is primarily a "
                          f"{correct} from {position} "
                          f"vs {opener} open, but {user_action} "
                          f"is a reasonable alternative since it's in range.")
        else:
            explanation = (f"{hand_key} should be a {correct} "
                          f"from {position} "
                          f"vs {opener} open.")

    return {
        'is_correct': is_correct or is_acceptable,
        'is_primary': is_correct,  # Exactly the GTO action
        'is_acceptable': is_acceptable,  # In range but not primary
        'user_action': user_action,
        'correct_action': correct,
        'explanation': explanation,
        'hand_key': hand_key,
        'range': scenario.get('range', []),
        'raise_range': scenario.get('raise_range'),
        'call_range': scenario.get('call_range'),
    }


_TEXTURE_THEORY = {
    'monotone': ('Flush dominates this board. Having a flush or flush draw is critical. '
                 'Without flush equity, hands lose significant value. Bluffing is risky '
                 'because opponents often have flush draws.'),
    'paired': ('Paired boards are polarized — players either have trips/full house or nothing. '
               'Medium-strength hands like one pair lose value. Betting ranges tend to be '
               'polarized (strong hands and bluffs, fewer medium-strength bets).'),
    'wet': ('Connected, two-tone boards have many draws available. Equity shifts dramatically '
            'on turn/river. Bet larger to deny equity from draws. Check-raising is common '
            'to build pots with strong hands and semi-bluffs.'),
    'high_dry': ('High dry boards (broadway-heavy) favor the preflop raiser who has more '
                 'big card combos. Low pair hands have little value. Value bet thinner '
                 'since draws are rare.'),
    'low_dry': ('Low dry boards favor the caller who has more small pairs and connectors. '
                'Overpairs are very strong here. With few draws available, check more '
                'frequently from OOP to protect your range.'),
}

_POSITION_THEORY = {
    'OOP': ('Out of position, you act first without information. Check frequently to '
            'protect your range — if you only bet strong hands, opponents exploit by '
            'raising your bets and floating your checks.'),
    'IP': ('In position, you act last with more information. You can bet wider after '
           'opponent checks (showing weakness). You can also check back to realize '
           'equity cheaply with medium-strength hands.'),
}

_BUCKET_THEORY = {
    'premium': 'Premium hands can slow-play to trap or bet for value. On wet boards, prefer betting to deny equity.',
    'nut': 'Nut hands should usually bet for value, but can check to induce bluffs on dry boards.',
    'strong': 'Strong hands bet for value and protection. Size up on wet boards to price out draws.',
    'good': 'Good hands bet for thin value on dry boards. On wet boards, consider check-calling to control pot.',
    'medium': 'Medium hands often check to control pot size. Avoid bloating the pot out of position.',
    'draw': 'Draws can semi-bluff (bet/raise) to fold out better hands or build the pot for when they hit.',
    'weak_made': 'Weak made hands prefer checking. They have showdown value but can\'t stand a raise.',
    'weak_draw': 'Weak draws (gutshots, backdoors) make good bluff candidates since they have some equity if called.',
    'air': 'Air hands either bluff (if you need bluffs at this frequency) or give up. Polarize your range.',
}


def generate_explanation(position, texture, bucket, strategy, rvr, facing_bet):
    """Generate theory explanation points for a postflop spot.

    Returns a list of dicts with {title, body, category, color}.
    """
    points = []

    # 1. Range advantage
    if rvr:
        if rvr['advantage_color'] == 'emerald':
            points.append({
                'title': 'You have range advantage',
                'body': (f"Hero's range has {rvr['hero_equity']}% equity here. "
                        f"With range advantage, you can bet more aggressively and "
                        f"use larger sizings to pressure villain's capped range."),
                'category': 'range',
                'color': 'emerald',
            })
        elif rvr['advantage_color'] == 'red':
            points.append({
                'title': 'Villain has range advantage',
                'body': (f"Villain's range has {rvr['villain_equity']}% equity here. "
                        f"When villain has range advantage, play more defensively — "
                        f"check more and use smaller bet sizes when you do bet."),
                'category': 'range',
                'color': 'red',
            })

    # 2. Board texture
    tex_theory = _TEXTURE_THEORY.get(texture)
    if tex_theory:
        tex_label = texture.replace('_', ' ').title()
        points.append({
            'title': f'{tex_label} board texture',
            'body': tex_theory,
            'category': 'texture',
            'color': 'amber',
        })

    # 3. Position
    pos_theory = _POSITION_THEORY.get(position)
    if pos_theory:
        points.append({
            'title': f'Playing {position}' + (' facing a bet' if facing_bet else ''),
            'body': pos_theory,
            'category': 'position',
            'color': 'blue',
        })

    # 4. Hand strength
    bucket_theory = _BUCKET_THEORY.get(bucket)
    if bucket_theory:
        points.append({
            'title': f'{bucket.replace("_", " ").title()} hand',
            'body': bucket_theory,
            'category': 'hand_strength',
            'color': 'purple',
        })

    # 5. Strategy type (pure vs mixed)
    sorted_strat = sorted(strategy.items(), key=lambda x: -x[1])
    top_freq = sorted_strat[0][1] if sorted_strat else 0
    if top_freq >= 0.95:
        points.append({
            'title': 'Pure strategy',
            'body': ('This is essentially a pure strategy — one action dominates. '
                    'GTO says to almost always take this action with this hand class.'),
            'category': 'strategy',
            'color': 'gray',
        })
    elif top_freq < 0.6 and len([a for a, p in sorted_strat if p > 0.15]) >= 2:
        mixed_actions = [a for a, p in sorted_strat if p > 0.15]
        points.append({
            'title': 'Mixed strategy',
            'body': (f"This is a mixed strategy spot — GTO mixes between "
                    f"{len(mixed_actions)} actions. In practice, pick one based on "
                    f"exploitative reads, or randomize to stay balanced."),
            'category': 'strategy',
            'color': 'gray',
        })

    return points


def evaluate_postflop(user_action, scenario):
    """Evaluate a postflop answer."""
    strategy = scenario['strategy']
    correct_actions = get_correct_actions(strategy)
    is_correct = user_action in correct_actions

    # Also accept actions with >15% frequency as "acceptable"
    is_acceptable = False
    if not is_correct:
        user_freq = strategy.get(user_action, 0)
        if user_freq >= 0.15:
            is_acceptable = True

    sorted_strat = sorted(strategy.items(), key=lambda x: -x[1])
    strat_str = ', '.join(
        f"{scenario['action_labels'].get(a, a)}: {p:.0%}"
        for a, p in sorted_strat
    )

    if is_correct:
        explanation = (f"Good play! With a {scenario['bucket']} hand "
                      f"on a {scenario['texture'].replace('_', ' ')} board. "
                      f"Strategy: {strat_str}")
    elif is_acceptable:
        user_freq = strategy.get(user_action, 0)
        best = scenario['action_labels'].get(correct_actions[0], correct_actions[0])
        user_label = scenario['action_labels'].get(user_action, user_action)
        explanation = (f"Mixed spot. {user_label} at {user_freq:.0%} frequency "
                      f"is reasonable, but {best} is preferred. "
                      f"Strategy: {strat_str}")
    else:
        best = scenario['action_labels'].get(correct_actions[0], correct_actions[0])
        explanation = (f"With a {scenario['bucket']} hand "
                      f"on a {scenario['texture'].replace('_', ' ')} board, "
                      f"prefer {best}. Strategy: {strat_str}")

    # Range vs Range analysis
    position = scenario.get('position', 'OOP')
    rvr = compute_range_vs_range(scenario['texture'], position)

    # Generate explanation points
    facing_bet = scenario.get('facing_bet', False)
    explanation_points = generate_explanation(
        position, scenario['texture'], scenario['bucket'],
        strategy, rvr, facing_bet
    )

    return {
        'is_correct': is_correct or is_acceptable,
        'is_primary': is_correct,
        'is_acceptable': is_acceptable,
        'user_action': user_action,
        'correct_actions': correct_actions,
        'explanation': explanation,
        'strategy': strategy,
        'bucket': scenario['bucket'],
        'bucket_label': scenario['bucket_label'],
        'texture': scenario['texture'],
        'texture_label': scenario['texture_label'],
        'range_breakdown': scenario.get('range_breakdown', {}),
        'action_labels': scenario.get('action_labels', {}),
        'bucket_examples': BUCKET_EXAMPLES,
        'range_vs_range': rvr,
        'explanation_points': explanation_points,
    }
