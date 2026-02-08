import os
import json
from flask import Flask, render_template, request

app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), '..', 'templates'),
)

from engine.scenarios import generate_preflop, generate_postflop, generate_play_scenario
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

    return render_template('partials/feedback.html',
                          feedback=feedback, streak=streak, mode='preflop')


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

    return render_template('partials/feedback_postflop.html',
                          feedback=feedback, streak=streak, mode='postflop')


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

    scenario = {
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

    feedback = evaluate_preflop(user_action, scenario)
    streak = streak + 1 if feedback['is_correct'] else 0

    # Determine if we should continue to postflop
    # Continue if the correct action was not fold (hand should see a flop)
    show_flop = (request.form['preflop_correct'] != 'fold')

    return render_template('partials/feedback_play.html',
                          feedback=feedback, streak=streak,
                          show_flop=show_flop, form=request.form)


@app.route('/api/play/postflop', methods=['POST'])
def play_show_postflop():
    """Show the postflop decision (board revealed)."""
    streak = int(request.form.get('streak', 0))

    # Reconstruct scenario data from hidden fields
    hand = json.loads(request.form['hand'])
    board = json.loads(request.form['board'])
    seats = json.loads(request.form['seats'])
    dealer_seat = int(request.form['dealer_seat'])
    pot = request.form.get('pot', '10')

    scenario = {
        'hand': hand,
        'hand_key': request.form['hand_key'],
        'board': board,
        'seats': seats,
        'dealer_seat': dealer_seat,
        'pot': pot,
        'postflop_position': request.form['postflop_position'],
        'postflop_situation': request.form['postflop_situation'],
        'texture': request.form['texture'],
        'texture_label': request.form['texture_label'],
        'bucket': request.form['bucket'],
        'bucket_label': request.form['bucket_label'],
        'strategy': json.loads(request.form['strategy']),
        'correct_actions': json.loads(request.form['correct_actions']),
        'postflop_actions': json.loads(request.form['postflop_actions']),
        'postflop_action_labels': json.loads(request.form['postflop_action_labels']),
        'range_breakdown': json.loads(request.form.get('range_breakdown', '{}')),
    }

    return render_template('partials/scenario_play_postflop.html',
                          scenario=scenario, streak=streak)


@app.route('/api/play/postflop_answer', methods=['POST'])
def play_postflop_answer():
    """Evaluate postflop action in play mode."""
    user_action = request.form['action']
    streak = int(request.form.get('streak', 0))

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

    return render_template('partials/feedback_play_postflop.html',
                          feedback=feedback, streak=streak)


@app.route('/api/play/next', methods=['POST'])
def play_next():
    streak = int(request.form.get('streak', 0))
    scenario = generate_play_scenario()
    return render_template('partials/scenario_play_preflop.html',
                          scenario=scenario, streak=streak)
