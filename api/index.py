import os
import json
from flask import Flask, render_template, request

app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), '..', 'templates'),
)

from engine.scenarios import generate_preflop, generate_postflop
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
