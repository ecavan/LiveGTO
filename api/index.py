import os
import json
from flask import Flask, render_template, request

app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), '..', 'templates'),
)

import random as _random
from engine.scenarios import (
    generate_preflop, generate_postflop, generate_play_scenario,
    compute_street_data,
)
from engine.evaluator import evaluate_preflop, evaluate_postflop
from engine.simulate import (
    generate_sim_hand, villain_preflop_act, villain_postflop_act,
    resolve_showdown, get_hero_gto_action, compute_deviation,
    compute_session_review, apply_bet_amount, OPEN_RAISE, THREE_BET,
)


# Bet sizing labels for chip display
_BET_LABELS = {
    'bet_s': '33%',
    'bet_m': '66%',
    'bet_l': '100%',
    'raise': 'Raise',
    'call': 'Call',
}


def _build_bets(seats, user_action, facing_bet=False):
    """Build bet chip dict for poker table display based on user's action."""
    bets = {}
    hero_idx = next((i for i, s in enumerate(seats) if s.get('is_hero')), 0)
    villain_idx = next(
        (i for i, s in enumerate(seats) if s.get('is_active') and not s.get('is_hero')),
        None
    )

    # Show villain's bet if facing a bet
    if facing_bet and villain_idx is not None:
        bet_size = _random.choice([3, 4, 5, 6, 7])
        bets[villain_idx] = f'{bet_size} BB'

    # Show hero's bet/raise/call
    if user_action in ('bet_s', 'bet_m', 'bet_l', 'raise', 'call'):
        label = _BET_LABELS.get(user_action, user_action)
        bets[hero_idx] = label

    return bets if bets else None


@app.route('/')
def home():
    return render_template('home.html')


# --- PREFLOP ---

@app.route('/preflop')
def preflop():
    fp = request.args.get('position', None)
    scenario = generate_preflop(position=fp)
    return render_template('preflop.html', scenario=scenario, streak=0, filter_position=fp)


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

    fp = request.form.get('filter_position', None)
    return render_template('partials/scenario_preflop.html',
                          scenario=full_scenario, feedback=feedback, streak=streak,
                          filter_position=fp)


@app.route('/api/preflop/next', methods=['POST'])
def preflop_next():
    streak = int(request.form.get('streak', 0))
    fp = request.form.get('filter_position', None)
    scenario = generate_preflop(position=fp)
    return render_template('partials/scenario_preflop.html',
                          scenario=scenario, streak=streak, filter_position=fp)


# --- POSTFLOP ---

@app.route('/postflop')
def postflop():
    fp = request.args.get('position', None)
    ft = request.args.get('texture', None)
    scenario = generate_postflop(position=fp, texture=ft)
    return render_template('postflop.html', scenario=scenario, streak=0,
                          filter_position=fp, filter_texture=ft)


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
    seats = json.loads(request.form.get('seats', '[]'))
    is_facing_bet = request.form.get('facing_bet', '') == 'True'
    full_scenario = {
        **scenario,
        'hand': json.loads(request.form.get('hand', '[]')),
        'board': json.loads(request.form.get('board', '[]')),
        'seats': seats,
        'dealer_seat': int(request.form.get('dealer_seat', 0)),
        'pot': request.form.get('pot', '10'),
        'situation': request.form.get('situation', ''),
        'facing_bet': is_facing_bet,
        'actions': [],
        'bets': _build_bets(seats, user_action, facing_bet=is_facing_bet),
    }

    fp = request.form.get('filter_position', None)
    ft = request.form.get('filter_texture', None)
    return render_template('partials/scenario_postflop.html',
                          scenario=full_scenario, feedback=feedback, streak=streak,
                          filter_position=fp, filter_texture=ft)


@app.route('/api/postflop/next', methods=['POST'])
def postflop_next():
    streak = int(request.form.get('streak', 0))
    fp = request.form.get('filter_position', None)
    ft = request.form.get('filter_texture', None)
    scenario = generate_postflop(position=fp, texture=ft)
    return render_template('partials/scenario_postflop.html',
                          scenario=scenario, streak=streak,
                          filter_position=fp, filter_texture=ft)


# --- PLAY MODE ---

@app.route('/play')
def play():
    fp = request.args.get('position', None)
    scenario = generate_play_scenario(position=fp)
    return render_template('play.html', scenario=scenario, streak=0, filter_position=fp)


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

    fp = request.form.get('filter_position', None)
    return render_template('partials/scenario_play_preflop.html',
                          scenario=full_scenario, feedback=feedback,
                          show_flop=show_flop, streak=streak, filter_position=fp)


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

    fp = request.form.get('filter_position', None)
    return render_template('partials/scenario_play_postflop.html',
                          scenario=scenario, streak=streak,
                          board_visible=board_visible, board_full=board_full,
                          street='flop', filter_position=fp)


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
    seats = json.loads(request.form.get('seats', '[]'))
    is_facing_bet = request.form.get('facing_bet', '') == 'True'

    full_scenario = {
        'hand': json.loads(request.form.get('hand', '[]')),
        'hand_key': request.form['hand_key'],
        'position': request.form.get('position', ''),
        'postflop_position': request.form['postflop_position'],
        'seats': seats,
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
        'bets': _build_bets(seats, user_action, facing_bet=is_facing_bet),
    }

    fp = request.form.get('filter_position', None)
    return render_template('partials/scenario_play_postflop.html',
                          scenario=full_scenario, feedback=feedback, streak=streak,
                          board_visible=board_visible, board_full=board_full,
                          street=street, has_next_street=has_next_street,
                          filter_position=fp)


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

    fp = request.form.get('filter_position', None)
    return render_template('partials/scenario_play_postflop.html',
                          scenario=scenario, streak=streak,
                          board_visible=board_visible, board_full=board_full,
                          street=next_street, filter_position=fp)


@app.route('/api/play/next', methods=['POST'])
def play_next():
    streak = int(request.form.get('streak', 0))
    fp = request.form.get('filter_position', None)
    scenario = generate_play_scenario(position=fp)
    return render_template('partials/scenario_play_preflop.html',
                          scenario=scenario, streak=streak, filter_position=fp)


# --- SIMULATE MODE ---

def _sim_available_actions(sim_state):
    """Determine available actions for hero based on current state."""
    if sim_state['street'] == 'preflop':
        villain_acted = sim_state.get('villain_last_action')
        if villain_acted == 'raise':
            return ['raise', 'call', 'fold']  # facing raise
        elif villain_acted == 'call' or villain_acted is None:
            return ['raise', 'fold']  # open action
        return ['raise', 'call', 'fold']
    else:
        # Postflop
        villain_acted = sim_state.get('villain_last_action')
        if villain_acted and villain_acted not in ('check',):
            # Facing a bet/raise
            return ['fold', 'call', 'raise']
        else:
            return ['check', 'bet_s', 'bet_m', 'bet_l']


def _advance_street(sim_state):
    """Advance to the next street, reset street-level tracking."""
    current = sim_state['street']
    if current == 'preflop':
        sim_state['street'] = 'flop'
        sim_state['board_visible'] = 3
    elif current == 'flop':
        sim_state['street'] = 'turn'
        sim_state['board_visible'] = 4
    elif current == 'turn':
        sim_state['street'] = 'river'
        sim_state['board_visible'] = 5

    sim_state['street_bet'] = 0.0
    sim_state['hero_street_invested'] = 0.0
    sim_state['villain_street_invested'] = 0.0
    sim_state['villain_last_action'] = None

    # Postflop: OOP acts first (BB in heads-up)
    # In HU: SB = BTN = IP, BB = OOP
    if sim_state['hero_is_sb']:
        # Hero is SB/BTN = IP, villain is BB = OOP → villain acts first
        sim_state['street_to_act'] = 'villain'
    else:
        # Hero is BB = OOP → hero acts first
        sim_state['street_to_act'] = 'hero'

    return sim_state


def _end_hand(sim_state, winner, fold=False):
    """Finalize hand, update stacks, log result."""
    sim_state['hand_over'] = True
    sim_state['winner'] = winner

    if winner == 'hero':
        win_amount = sim_state['pot'] - sim_state['hero_total_invested']
        sim_state['hero_stack'] += sim_state['pot']
    elif winner == 'villain':
        win_amount = -sim_state['hero_total_invested']
        sim_state['villain_stack'] += sim_state['pot']
    else:
        # Split
        half = sim_state['pot'] / 2
        win_amount = half - sim_state['hero_total_invested']
        sim_state['hero_stack'] += half
        sim_state['villain_stack'] += half

    sim_state['sim_phase'] = 'hand_over' if fold else 'showdown'

    # Log this hand
    sim_state['session_log'].append({
        'hand_num': sim_state['hand_number'],
        'hero_hand_key': sim_state['hero_hand_key'],
        'result_bb': round(win_amount, 1),
        'actions': sim_state['current_hand_actions'],
    })

    return sim_state


def _run_villain_turn(sim_state):
    """Process villain's action when it's their turn."""
    street = sim_state['street']
    facing_bet = sim_state['hero_street_invested'] > sim_state['villain_street_invested']

    if street == 'preflop':
        v_action = villain_preflop_act(
            sim_state['villain_hand_key'],
            sim_state['villain_position'],
            facing_raise=facing_bet,
        )
    else:
        board_vis = sim_state['board_strs'][:sim_state['board_visible']]
        v_pos = 'OOP' if not sim_state['hero_is_sb'] else 'IP'  # Villain is opposite of hero
        # Actually: hero_is_sb means hero=IP, villain=OOP
        if sim_state['hero_is_sb']:
            v_pos = 'OOP'
        else:
            v_pos = 'IP'
        v_action = villain_postflop_act(
            sim_state['villain_hand_strs'], board_vis,
            v_pos, facing_bet=facing_bet,
        )

    # Apply villain's action
    if v_action == 'fold':
        return _end_hand(sim_state, 'hero', fold=True)
    elif v_action == 'call':
        call_amount = sim_state['hero_street_invested'] - sim_state['villain_street_invested']
        call_amount = min(call_amount, sim_state['villain_stack'])
        sim_state['villain_stack'] -= call_amount
        sim_state['villain_total_invested'] += call_amount
        sim_state['villain_street_invested'] += call_amount
        sim_state['pot'] += call_amount
        sim_state['villain_last_action'] = 'call'

        # After a call, check if we need to advance street or showdown
        if street == 'preflop' and sim_state['hero_street_invested'] > 0:
            # Both have acted preflop, advance to flop
            sim_state = _advance_street(sim_state)
            return _process_new_street(sim_state)
        elif sim_state['street'] == 'river':
            # Showdown
            winner = resolve_showdown(
                sim_state['hero_hand_strs'], sim_state['villain_hand_strs'],
                sim_state['board_strs']
            )
            return _end_hand(sim_state, winner)
        else:
            sim_state = _advance_street(sim_state)
            return _process_new_street(sim_state)

    elif v_action == 'check':
        sim_state['villain_last_action'] = 'check'
        sim_state['street_to_act'] = 'hero'
        if street != 'preflop':
            sim_state['sim_phase'] = 'postflop_decision'
        return sim_state

    else:
        # Bet/raise
        if street == 'preflop':
            bet_amount = OPEN_RAISE if not facing_bet else THREE_BET
        else:
            bet_amount = apply_bet_amount(sim_state['pot'], v_action)

        additional = bet_amount - sim_state['villain_street_invested']
        additional = min(additional, sim_state['villain_stack'])
        sim_state['villain_stack'] -= additional
        sim_state['villain_total_invested'] += additional
        sim_state['villain_street_invested'] += additional
        sim_state['pot'] += additional
        sim_state['street_bet'] = sim_state['villain_street_invested']
        sim_state['villain_last_action'] = v_action if 'bet' in v_action else 'raise'
        sim_state['street_to_act'] = 'hero'
        if street == 'preflop':
            sim_state['sim_phase'] = 'preflop_decision'
        else:
            sim_state['sim_phase'] = 'postflop_decision'
        return sim_state


def _process_new_street(sim_state):
    """Process a new street — check if villain or hero acts first."""
    if sim_state['street_to_act'] == 'villain':
        return _run_villain_turn(sim_state)
    else:
        sim_state['sim_phase'] = 'postflop_decision'
        return sim_state


@app.route('/simulate')
def simulate():
    sim_state = generate_sim_hand(100.0, 100.0, 1, hero_is_sb=True)

    # If villain is first to act preflop (hero is BB), run villain's action
    if sim_state['street_to_act'] == 'villain':
        sim_state = _run_villain_turn(sim_state)

    available_actions = _sim_available_actions(sim_state)
    return render_template('simulate.html', sim_state=sim_state,
                          available_actions=available_actions)


@app.route('/api/sim/action', methods=['POST'])
def sim_action():
    """Process hero's action in simulate mode."""
    sim_state = json.loads(request.form['sim_state'])
    hero_action = request.form['action']
    street = sim_state['street']

    # Track GTO deviation
    facing_bet = sim_state.get('villain_last_action') in ('raise', 'bet_s', 'bet_m', 'bet_l')
    board_vis = sim_state['board_strs'][:sim_state['board_visible']] if sim_state['board_visible'] > 0 else None
    gto_action = get_hero_gto_action(
        sim_state['hero_hand_key'], sim_state['hero_position'],
        street, hand_strs=sim_state['hero_hand_strs'],
        board_strs=board_vis, facing_bet=facing_bet,
    )
    dev = compute_deviation(hero_action, gto_action)
    sim_state['current_hand_actions'].append({
        'street': street,
        'action': hero_action,
        'gto_action': gto_action,
        'deviation': dev,
    })

    # Apply hero's action
    if hero_action == 'fold':
        sim_state = _end_hand(sim_state, 'villain', fold=True)
    elif hero_action == 'call':
        call_amount = sim_state['villain_street_invested'] - sim_state['hero_street_invested']
        call_amount = min(call_amount, sim_state['hero_stack'])
        sim_state['hero_stack'] -= call_amount
        sim_state['hero_total_invested'] += call_amount
        sim_state['hero_street_invested'] += call_amount
        sim_state['pot'] += call_amount

        # After call, advance street or showdown
        if sim_state['street'] == 'river':
            winner = resolve_showdown(
                sim_state['hero_hand_strs'], sim_state['villain_hand_strs'],
                sim_state['board_strs']
            )
            sim_state = _end_hand(sim_state, winner)
        elif street == 'preflop':
            sim_state = _advance_street(sim_state)
            sim_state = _process_new_street(sim_state)
        else:
            sim_state = _advance_street(sim_state)
            sim_state = _process_new_street(sim_state)

    elif hero_action == 'check':
        sim_state['villain_last_action'] = None
        # After hero checks
        if sim_state['hero_is_sb'] and street != 'preflop':
            # Hero is IP, checked back → advance street or showdown
            if sim_state['street'] == 'river':
                winner = resolve_showdown(
                    sim_state['hero_hand_strs'], sim_state['villain_hand_strs'],
                    sim_state['board_strs']
                )
                sim_state = _end_hand(sim_state, winner)
            else:
                sim_state = _advance_street(sim_state)
                sim_state = _process_new_street(sim_state)
        else:
            # Hero is OOP, checked → villain acts
            sim_state['street_to_act'] = 'villain'
            sim_state = _run_villain_turn(sim_state)

    else:
        # Hero bets/raises
        if street == 'preflop':
            bet_amount = OPEN_RAISE if not facing_bet else THREE_BET
        else:
            bet_amount = apply_bet_amount(sim_state['pot'], hero_action)

        additional = bet_amount - sim_state['hero_street_invested']
        additional = min(additional, sim_state['hero_stack'])
        sim_state['hero_stack'] -= additional
        sim_state['hero_total_invested'] += additional
        sim_state['hero_street_invested'] += additional
        sim_state['pot'] += additional
        sim_state['street_bet'] = sim_state['hero_street_invested']

        # Villain responds
        sim_state['street_to_act'] = 'villain'
        sim_state = _run_villain_turn(sim_state)

    available_actions = _sim_available_actions(sim_state) if not sim_state.get('hand_over') else []
    return render_template('partials/sim_hand.html', sim_state=sim_state,
                          available_actions=available_actions)


@app.route('/api/sim/next_hand', methods=['POST'])
def sim_next_hand():
    """Deal next hand, alternate positions."""
    sim_state = json.loads(request.form['sim_state'])

    hero_stack = sim_state['hero_stack']
    villain_stack = sim_state['villain_stack']
    hand_number = sim_state['hand_number'] + 1
    hero_is_sb = not sim_state['hero_is_sb']  # Alternate
    session_log = sim_state['session_log']

    new_state = generate_sim_hand(hero_stack, villain_stack, hand_number, hero_is_sb)
    new_state['session_log'] = session_log

    # If villain acts first preflop, run their action
    if new_state['street_to_act'] == 'villain':
        new_state = _run_villain_turn(new_state)

    available_actions = _sim_available_actions(new_state) if not new_state.get('hand_over') else []
    return render_template('partials/sim_hand.html', sim_state=new_state,
                          available_actions=available_actions)


@app.route('/api/sim/quit', methods=['POST'])
def sim_quit():
    """End session and show review."""
    sim_state = json.loads(request.form['sim_state'])
    review = compute_session_review(sim_state['session_log'])
    return render_template('partials/sim_review.html', review=review)
