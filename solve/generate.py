"""Orchestrator: run equity → CFR → export JSON."""

import json
import os
import time

from engine.abstraction import BUCKETS
from engine.postflop import TEXTURES, OOP_STRATEGY, IP_VS_CHECK, FACING_BET
from solve.equity import compute_bucket_probs, compute_equity_matrix
from solve.cfr import CFRSolver


DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
OUTPUT_PATH = os.path.join(DATA_DIR, 'strategies.json')


def main():
    t_start = time.time()
    print("=" * 60)
    print("LiveGTO Solver — Pre-computation Pipeline")
    print("=" * 60)

    # Phase 1: Monte Carlo equity
    print("\n[Phase 1] Monte Carlo Equity Engine")
    print("-" * 40)
    bucket_probs = compute_bucket_probs(n_samples=50_000)
    equity_matrix = compute_equity_matrix(n_matchups_per_texture=30_000)

    # Phase 2: CFR+ Solver
    print("\n[Phase 2] CFR+ Solver")
    print("-" * 40)

    n_iterations = 10_000
    all_strategies = {
        'OOP': {},
        'IP': {},
        'FACING_BET': {},
    }

    for tex in TEXTURES:
        print(f"\n  Solving {tex}...")
        t0 = time.time()

        solver = CFRSolver(
            equity_matrix=equity_matrix[tex],
            bucket_probs=bucket_probs[tex],
        )
        solver.train(n_iterations=n_iterations)

        oop_first, ip_vs_check, facing_bet = solver.get_strategies()

        all_strategies['OOP'][tex] = {}
        all_strategies['IP'][tex] = {}
        all_strategies['FACING_BET'][tex] = {}

        for bkt in BUCKETS:
            all_strategies['OOP'][tex][bkt] = oop_first.get(bkt, {})
            all_strategies['IP'][tex][bkt] = ip_vs_check.get(bkt, {})
            all_strategies['FACING_BET'][tex][bkt] = facing_bet.get(bkt, {})

        elapsed = time.time() - t0
        print(f"    {tex} solved in {elapsed:.1f}s ({len(solver.info_sets)} info sets)")

    # Phase 3: Export
    print("\n[Phase 3] Export")
    print("-" * 40)

    output = {
        'version': '1.0',
        'n_iterations': n_iterations,
        'buckets': BUCKETS,
        'textures': TEXTURES,
        'bucket_probs': bucket_probs,
        'equity_matrix': equity_matrix,
        'strategies': all_strategies,
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT_PATH, 'w') as f:
        json.dump(output, f, indent=2)

    file_size = os.path.getsize(OUTPUT_PATH)
    print(f"  Written to {OUTPUT_PATH}")
    print(f"  File size: {file_size:,} bytes ({file_size / 1024:.1f} KB)")

    # Phase 4: Compare to old hand-tuned strategies
    print("\n[Phase 4] Strategy Comparison (old hand-tuned vs CFR-solved)")
    print("-" * 40)

    biggest_changes = []

    for tex in TEXTURES:
        for bkt in BUCKETS:
            # OOP comparison
            old_key = ('OOP', tex, bkt)
            old_strat = OOP_STRATEGY.get(old_key, {})
            new_strat = all_strategies['OOP'][tex].get(bkt, {})
            diff = _strategy_diff(old_strat, new_strat)
            if diff > 0.15:
                biggest_changes.append(('OOP', tex, bkt, diff, old_strat, new_strat))

            # IP comparison
            old_key = ('IP', tex, bkt)
            old_strat = IP_VS_CHECK.get(old_key, {})
            new_strat = all_strategies['IP'][tex].get(bkt, {})
            diff = _strategy_diff(old_strat, new_strat)
            if diff > 0.15:
                biggest_changes.append(('IP', tex, bkt, diff, old_strat, new_strat))

            # FACING_BET comparison
            old_key = (tex, bkt)
            old_strat = FACING_BET.get(old_key, {})
            new_strat = all_strategies['FACING_BET'][tex].get(bkt, {})
            diff = _strategy_diff(old_strat, new_strat)
            if diff > 0.15:
                biggest_changes.append(('FACING', tex, bkt, diff, old_strat, new_strat))

    biggest_changes.sort(key=lambda x: -x[3])

    if biggest_changes:
        print(f"  {len(biggest_changes)} strategies changed significantly (>15% diff):")
        for ctx, tex, bkt, diff, old, new in biggest_changes[:20]:
            print(f"\n    {ctx}/{tex}/{bkt} (diff={diff:.0%}):")
            print(f"      OLD: {_fmt_strat(old)}")
            print(f"      NEW: {_fmt_strat(new)}")
    else:
        print("  All strategies within 15% of hand-tuned values")

    total_time = time.time() - t_start
    print(f"\n{'=' * 60}")
    print(f"Total time: {total_time:.1f}s ({total_time / 60:.1f} min)")
    print(f"{'=' * 60}")


def _strategy_diff(old, new):
    """Total absolute difference between two strategy dicts."""
    all_actions = set(list(old.keys()) + list(new.keys()))
    return sum(abs(old.get(a, 0) - new.get(a, 0)) for a in all_actions) / 2


def _fmt_strat(strat):
    """Format strategy dict for printing."""
    parts = []
    for action in ['check', 'bet_s', 'bet_m', 'bet_l', 'fold', 'call', 'raise']:
        if action in strat and strat[action] > 0.005:
            parts.append(f"{action}={strat[action]:.0%}")
    return ' '.join(parts)


if __name__ == '__main__':
    main()
