"""Check user answers and generate feedback."""

from engine.postflop import get_correct_actions


def evaluate_preflop(user_action, scenario):
    """Evaluate a preflop answer."""
    correct = scenario['correct_action']
    is_correct = user_action == correct

    if scenario['type'] == 'preflop_rfi':
        if is_correct:
            explanation = (f"Correct! {scenario['hand_key']} is a "
                          f"{correct} from {scenario['position']}.")
        else:
            explanation = (f"{scenario['hand_key']} should be a {correct} "
                          f"from {scenario['position']}. "
                          f"The {scenario['position']} RFI range has "
                          f"{scenario['range_size']} combos.")
    else:
        if is_correct:
            explanation = (f"Correct! {scenario['hand_key']} is a "
                          f"{correct} from {scenario['position']} "
                          f"vs {scenario['opener']} open.")
        else:
            explanation = (f"{scenario['hand_key']} should be a {correct} "
                          f"from {scenario['position']} "
                          f"vs {scenario['opener']} open.")

    return {
        'is_correct': is_correct,
        'user_action': user_action,
        'correct_action': correct,
        'explanation': explanation,
        'hand_key': scenario['hand_key'],
        'range': scenario.get('range', []),
        'raise_range': scenario.get('raise_range'),
        'call_range': scenario.get('call_range'),
    }


def evaluate_postflop(user_action, scenario):
    """Evaluate a postflop answer."""
    strategy = scenario['strategy']
    correct_actions = get_correct_actions(strategy)
    is_correct = user_action in correct_actions

    sorted_strat = sorted(strategy.items(), key=lambda x: -x[1])
    strat_str = ', '.join(
        f"{scenario['action_labels'].get(a, a)}: {p:.0%}"
        for a, p in sorted_strat
    )

    if is_correct:
        explanation = (f"Good play! With a {scenario['bucket']} hand "
                      f"on a {scenario['texture'].replace('_', ' ')} board. "
                      f"Strategy: {strat_str}")
    else:
        best = scenario['action_labels'].get(correct_actions[0], correct_actions[0])
        explanation = (f"With a {scenario['bucket']} hand "
                      f"on a {scenario['texture'].replace('_', ' ')} board, "
                      f"prefer {best}. Strategy: {strat_str}")

    return {
        'is_correct': is_correct,
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
    }
