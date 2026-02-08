import os
import json
from flask import Flask, render_template, request

app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), '..', 'templates'),
)

from engine.scenarios import (
    generate_preflop, generate_postflop, generate_play_scenario,
    compute_street_data,
)
from engine.evaluator import evaluate_preflop, evaluate_postflop


@app.route('/')
def home():
    return render_template('home.html')


# --- PREFLOP ---

@app.route('/preflop')
def preflop():
    scenario = generate_preflop()
    return render_template('preflop.html', scenario=scenario, streak=0)


@app.route('/api/preflop/answer', methods=['POST'])
def preflop_answer():
    user_action = request.form['action']
    streak = int(request.form.get('streak', 0))

    # Reconstruct scenario from hidden fields
    scenario = {
        'type': request.form['type'],
        'position': request.form['position'],
        'hand_key': request.form['hand_key'],
        'correct_action': request.form['correct_action'],
        'range': json.loads(request.form.get('range', '[]')),
        'range_size': int(request.form.get('range_size', 0)),
        'opener': request.form.get('opener', ''),
        'raise_range': json.loads(request.form.get('raise_range', 'null')),
        'call_range': json.loads(request.form.get('call_range', 'null')),
    }

    feedback = evaluate_preflop(user_action, scenario)
    streak = streak + 1 if feedback['is_correct'] else 0

    # Reconstruct full scenario for re-rendering with poker table
    full_scenario = {
        **scenario,
        'hand': json.loads(request.form.get('hand', '[]')),
        'board': json.loads(request.form.get('board', '[]')),
        'seats': json.loads(request.form.get('seats', '[]')),
        'dealer_seat': int(request.form.get('dealer_seat', 0)),
        'situation': request.form.get('situation', ''),
        'actions': [],
        'action_labels': {},
    }

    return render_template('partials/scenario_preflop.html',
                          scenario=full_scenario, feedback=feedback, streak=streak)


@app.route('/api/preflop/next', methods=['POST'])
def preflop_next():
    streak = int(request.form.get('streak', 0))
    scenario = generate_preflop()
    return render_template('partials/scenario_preflop.html',
                          scenario=scenario, streak=streak)


# --- POSTFLOP ---

@app.route('/postflop')
def postflop():
    scenario = generate_postflop()
    return render_template('postflop.html', scenario=scenario, streak=0)


@app.route('/api/postflop/answer', methods=['POST'])
def postflop_answer():
    user_action = request.form['action']
    streak = int(request.form.get('streak', 0))

    scenario = {
        'type': 'postflop',
        'position': request.form['position'],
        'hand_key': request.form['hand_key'],
        'bucket': request.form['bucket'],
        'bucket_label': request.form['bucket_label'],
        'texture': request.form['texture'],
        'texture_label': request.form['texture_label'],
        'strategy': json.loads(request.form['strategy']),
        'correct_actions': json.loads(request.form['correct_actions']),
        'action_labels': json.loads(request.form.get('action_labels', '{}')),
        'range_breakdown': json.loads(request.form.get('range_breakdown', '{}')),
    }

    feedback = evaluate_postflop(user_action, scenario)
    streak = streak + 1 if feedback['is_correct'] else 0

    # Reconstruct full scenario for re-rendering with poker table
    full_scenario = {
        **scenario,
        'hand': json.loads(request.form.get('hand', '[]')),
        'board': json.loads(request.form.get('board', '[]')),
        'seats': json.loads(request.form.get('seats', '[]')),
        'dealer_seat': int(request.form.get('dealer_seat', 0)),
        'pot': request.form.get('pot', '10'),
        'situation': request.form.get('situation', ''),
        'facing_bet': request.form.get('facing_bet', '') == 'True',
        'actions': [],
    }

    return render_template('partials/scenario_postflop.html',
                          scenario=full_scenario, feedback=feedback, streak=streak)


@app.route('/api/postflop/next', methods=['POST'])
def postflop_next():
    streak = int(request.form.get('streak', 0))
    scenario = generate_postflop()
    return render_template('partials/scenario_postflop.html',
                          scenario=scenario, streak=streak)


# --- PLAY MODE ---

@app.route('/play')
def play():
    scenario = generate_play_scenario()
    return render_template('play.html', scenario=scenario, streak=0)


@app.route('/api/play/preflop', methods=['POST'])
def play_preflop_answer():
    """Evaluate preflop action in play mode."""
    user_action = request.form['action']
    streak = int(request.form.get('streak', 0))

    preflop_scenario = {
        'type': request.form['preflop_type'],
        'position': request.form['position'],
        'hand_key': request.form['hand_key'],
        'correct_action': request.form['preflop_correct'],
        'range': json.loads(request.form.get('preflop_range', '[]')),
        'range_size': int(request.form.get('preflop_range_size', 0)),
        'opener': request.form.get('preflop_opener', ''),
        'raise_range': json.loads(request.form.get('preflop_raise_range', 'null')),
        'call_range': json.loads(request.form.get('preflop_call_range', 'null')),
    }

    feedback = evaluate_preflop(user_action, preflop_scenario)
    streak = streak + 1 if feedback['is_correct'] else 0

    # Determine if we should continue to postflop
    show_flop = (request.form['preflop_correct'] != 'fold')

    # Reconstruct full scenario for re-rendering
    full_scenario = {
        'hand': json.loads(request.form.get('hand', '[]')),
        'hand_key': request.form['hand_key'],
        'board': json.loads(request.form.get('board', '[]')),
        'position': request.form['position'],
        'seats': json.loads(request.form.get('seats', '[]')),
        'dealer_seat': int(request.form.get('dealer_seat', 0)),
        'pot': request.form.get('pot', '10'),
        'preflop_situation': request.form.get('preflop_situation', ''),
        'preflop_actions': [],
        'preflop_action_labels': {},
        'postflop_position': request.form.get('postflop_position', ''),
        'facing_bet': request.form.get('facing_bet', 'False'),
    }

    return render_template('partials/scenario_play_preflop.html',
                          scenario=full_scenario, feedback=feedback,
                          show_flop=show_flop, streak=streak)


@app.route('/api/play/postflop', methods=['POST'])
def play_show_postflop():
    """Show the postflop decision (board revealed) — flop entry point."""
    streak = int(request.form.get('streak', 0))

    hand = json.loads(request.form['hand'])
    board_full = json.loads(request.form['board_full'])
    seats = json.loads(request.form['seats'])
    dealer_seat = int(request.form['dealer_seat'])
    pot = request.form.get('pot', '10')
    position = request.form.get('position', '')
    postflop_position = request.form['postflop_position']

    # Flop = first 3 cards
    board_visible = board_full[:3]

    # Compute strategy for this street
    street_data = compute_street_data(hand, board_visible, postflop_position)

    # Build bet chips if facing a bet
    bets = None
    if street_data.get('bets_info'):
        # Find villain seat (first active non-hero)
        villain_idx = next(
            (i for i, s in enumerate(seats) if s.get('is_active') and not s.get('is_hero')),
            None
        )
        if villain_idx is not None:
            bets = {villain_idx: f"{street_data['bets_info']['bet_size']} BB"}

    scenario = {
        'hand': hand,
        'hand_key': request.form['hand_key'],
        'position': position,
        'seats': seats,
        'dealer_seat': dealer_seat,
        'pot': pot,
        'postflop_position': postflop_position,
        'bets': bets,
        **street_data,
    }

    return render_template('partials/scenario_play_postflop.html',
                          scenario=scenario, streak=streak,
                          board_visible=board_visible, board_full=board_full,
                          street='flop')


@app.route('/api/play/postflop_answer', methods=['POST'])
def play_postflop_answer():
    """Evaluate postflop action in play mode."""
    user_action = request.form['action']
    streak = int(request.form.get('streak', 0))
    street = request.form.get('street', 'flop')

    scenario = {
        'type': 'postflop',
        'position': request.form['postflop_position'],
        'hand_key': request.form['hand_key'],
        'bucket': request.form['bucket'],
        'bucket_label': request.form['bucket_label'],
        'texture': request.form['texture'],
        'texture_label': request.form['texture_label'],
        'strategy': json.loads(request.form['strategy']),
        'correct_actions': json.loads(request.form['correct_actions']),
        'action_labels': json.loads(request.form.get('postflop_action_labels', '{}')),
        'range_breakdown': json.loads(request.form.get('range_breakdown', '{}')),
    }

    feedback = evaluate_postflop(user_action, scenario)
    streak = streak + 1 if feedback['is_correct'] else 0

    # Determine if there's a next street
    has_next_street = street in ('flop', 'turn')

    # Reconstruct full scenario for re-rendering
    board_full = json.loads(request.form.get('board_full', '[]'))
    board_visible = json.loads(request.form.get('board_visible', '[]'))

    full_scenario = {
        'hand': json.loads(request.form.get('hand', '[]')),
        'hand_key': request.form['hand_key'],
        'position': request.form.get('position', ''),
        'postflop_position': request.form['postflop_position'],
        'seats': json.loads(request.form.get('seats', '[]')),
        'dealer_seat': int(request.form.get('dealer_seat', 0)),
        'pot': request.form.get('pot', '10'),
        'postflop_situation': request.form.get('postflop_situation', ''),
        'bucket': request.form['bucket'],
        'bucket_label': request.form['bucket_label'],
        'texture': request.form['texture'],
        'texture_label': request.form['texture_label'],
        'postflop_actions': [],
        'postflop_action_labels': {},
        'strategy': json.loads(request.form['strategy']),
        'correct_actions': json.loads(request.form['correct_actions']),
        'range_breakdown': json.loads(request.form.get('range_breakdown', '{}')),
    }

    return render_template('partials/scenario_play_postflop.html',
                          scenario=full_scenario, feedback=feedback, streak=streak,
                          board_visible=board_visible, board_full=board_full,
                          street=street, has_next_street=has_next_street)


@app.route('/api/play/next_street', methods=['POST'])
def play_next_street():
    """Advance to the next street (turn or river)."""
    streak = int(request.form.get('streak', 0))
    current_street = request.form['street']

    hand = json.loads(request.form['hand'])
    board_full = json.loads(request.form['board_full'])
    seats = json.loads(request.form['seats'])
    dealer_seat = int(request.form['dealer_seat'])
    pot = request.form.get('pot', '10')
    position = request.form.get('position', '')
    postflop_position = request.form['postflop_position']

    # Determine next street and visible board
    if current_street == 'flop':
        next_street = 'turn'
        board_visible = board_full[:4]
    else:
        next_street = 'river'
        board_visible = board_full[:5]

    # Re-compute strategy for the new board
    street_data = compute_street_data(hand, board_visible, postflop_position)

    # Build bet chips if facing a bet
    bets = None
    if street_data.get('bets_info'):
        villain_idx = next(
            (i for i, s in enumerate(seats) if s.get('is_active') and not s.get('is_hero')),
            None
        )
        if villain_idx is not None:
            bets = {villain_idx: f"{street_data['bets_info']['bet_size']} BB"}

    scenario = {
        'hand': hand,
        'hand_key': request.form['hand_key'],
        'position': position,
        'seats': seats,
        'dealer_seat': dealer_seat,
        'pot': pot,
        'postflop_position': postflop_position,
        'bets': bets,
        **street_data,
    }

    return render_template('partials/scenario_play_postflop.html',
                          scenario=scenario, streak=streak,
                          board_visible=board_visible, board_full=board_full,
                          street=next_street)


@app.route('/api/play/next', methods=['POST'])
def play_next():
    streak = int(request.form.get('streak', 0))
    scenario = generate_play_scenario()
    return render_template('partials/scenario_play_preflop.html',
                          scenario=scenario, streak=streak)
