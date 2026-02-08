"""Check user answers and generate feedback."""

from engine.abstraction import BUCKET_EXAMPLES
from engine.postflop import get_correct_actions


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
    }
