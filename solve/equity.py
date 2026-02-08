"""Monte Carlo equity engine — bucket distributions + equity matrix."""

import random
import time
from collections import Counter, defaultdict
from multiprocessing import Pool, cpu_count

from treys import Card, Deck, Evaluator

from engine.abstraction import classify_hand, BUCKETS
from engine.postflop import classify_texture, TEXTURES


def _make_evaluator():
    """Each worker process needs its own Evaluator instance."""
    return Evaluator()


def compute_bucket_probs(n_samples=50_000):
    """Compute P(bucket | texture) by dealing random hands.

    Returns:
        dict: {texture: {bucket: probability}}
    """
    print(f"  Computing bucket distributions ({n_samples:,} samples)...")
    t0 = time.time()

    counts = {tex: Counter() for tex in TEXTURES}
    tex_totals = Counter()

    for _ in range(n_samples):
        deck = Deck()
        hand = deck.draw(2)
        board = deck.draw(3)
        tex = classify_texture(board)
        bkt = classify_hand(hand, board, tex)
        counts[tex][bkt] += 1
        tex_totals[tex] += 1

    probs = {}
    for tex in TEXTURES:
        total = tex_totals[tex]
        if total == 0:
            probs[tex] = {b: 1.0 / len(BUCKETS) for b in BUCKETS}
        else:
            probs[tex] = {b: counts[tex][b] / total for b in BUCKETS}

    elapsed = time.time() - t0
    print(f"  Done in {elapsed:.1f}s")

    for tex in TEXTURES:
        dist = probs[tex]
        total_pct = sum(dist.values())
        print(f"    {tex:12s}: ", end="")
        for b in BUCKETS:
            if dist[b] > 0.005:
                print(f"{b}={dist[b]:.1%} ", end="")
        print(f"  (sum={total_pct:.3f})")

    return probs


def _equity_worker(args):
    """Worker: compute equity matchups for one texture.

    Strategy: deal random 10-card chunks from a deck. First 3 are the board.
    If board matches target texture, use cards 4-5 as hand1, 6-7 as hand2,
    8-9 as turn+river. This avoids multiple Deck() instantiations per sample.
    For each matching board, run multiple hand pairs to maximize data.
    """
    texture, n_matchups, seed = args
    random.seed(seed)
    evaluator = _make_evaluator()

    ALL_CARDS = list(range(52))  # treys uses 0-51? No, treys uses special ints

    wins = defaultdict(lambda: defaultdict(float))
    totals = defaultdict(lambda: defaultdict(int))

    matchups_done = 0
    max_attempts = n_matchups * 30

    for _ in range(max_attempts):
        if matchups_done >= n_matchups:
            break

        deck = Deck()
        # Draw board + 2 hands + turn/river = 9 cards
        cards = deck.draw(9)
        board = cards[:3]
        tex = classify_texture(board)

        if tex != texture:
            continue

        hand1 = cards[3:5]
        hand2 = cards[5:7]
        turn_river = cards[7:9]
        full_board = board + turn_river

        bkt1 = classify_hand(hand1, board, tex)
        bkt2 = classify_hand(hand2, board, tex)

        score1 = evaluator.evaluate(full_board, hand1)
        score2 = evaluator.evaluate(full_board, hand2)

        if score1 < score2:
            wins[bkt1][bkt2] += 1.0
        elif score1 > score2:
            wins[bkt2][bkt1] += 1.0
        else:
            wins[bkt1][bkt2] += 0.5
            wins[bkt2][bkt1] += 0.5

        totals[bkt1][bkt2] += 1
        totals[bkt2][bkt1] += 1
        matchups_done += 1

        # Reuse this board for extra matchups with different hands
        # Draw more hands from remaining deck for same board
        remaining = deck.draw(4)
        if len(remaining) >= 4:
            hand3 = remaining[:2]
            hand4 = remaining[2:4]

            bkt3 = classify_hand(hand3, board, tex)
            bkt4 = classify_hand(hand4, board, tex)

            score3 = evaluator.evaluate(full_board, hand3)
            score4 = evaluator.evaluate(full_board, hand4)

            if score3 < score4:
                wins[bkt3][bkt4] += 1.0
            elif score3 > score4:
                wins[bkt4][bkt3] += 1.0
            else:
                wins[bkt3][bkt4] += 0.5
                wins[bkt4][bkt3] += 0.5

            totals[bkt3][bkt4] += 1
            totals[bkt4][bkt3] += 1
            matchups_done += 1

            # Cross matchups for more data
            for ha, hb, ba, bb in [(hand1, hand3, bkt1, bkt3),
                                    (hand1, hand4, bkt1, bkt4),
                                    (hand2, hand3, bkt2, bkt3),
                                    (hand2, hand4, bkt2, bkt4)]:
                sa = evaluator.evaluate(full_board, ha)
                sb = evaluator.evaluate(full_board, hb)
                if sa < sb:
                    wins[ba][bb] += 1.0
                elif sa > sb:
                    wins[bb][ba] += 1.0
                else:
                    wins[ba][bb] += 0.5
                    wins[bb][ba] += 0.5
                totals[ba][bb] += 1
                totals[bb][ba] += 1
                matchups_done += 1

    # Convert defaultdicts to regular dicts for pickling
    return texture, {k: dict(v) for k, v in wins.items()}, \
           {k: dict(v) for k, v in totals.items()}, matchups_done


def compute_equity_matrix(n_matchups_per_texture=30_000):
    """Compute equity_matrix[texture][hero_bucket][villain_bucket].

    Uses multiprocessing to parallelize across textures.

    Returns:
        dict: {texture: {hero_bkt: {villain_bkt: equity}}}
    """
    n_workers = min(cpu_count(), len(TEXTURES))
    print(f"  Computing equity matrix ({n_matchups_per_texture:,} matchups/texture, {n_workers} workers)...")
    t0 = time.time()

    tasks = [
        (tex, n_matchups_per_texture, random.randint(0, 2**31))
        for tex in TEXTURES
    ]

    with Pool(n_workers) as pool:
        results = pool.map(_equity_worker, tasks)

    equity_matrix = {}
    for texture, wins_dict, totals_dict, n_done in results:
        matrix = {}
        for hero_bkt in BUCKETS:
            matrix[hero_bkt] = {}
            for vill_bkt in BUCKETS:
                w = wins_dict.get(hero_bkt, {}).get(vill_bkt, 0)
                t = totals_dict.get(hero_bkt, {}).get(vill_bkt, 0)
                if t > 0:
                    matrix[hero_bkt][vill_bkt] = w / t
                else:
                    # No data — use ordinal heuristic
                    hero_idx = BUCKETS.index(hero_bkt)
                    vill_idx = BUCKETS.index(vill_bkt)
                    if hero_idx < vill_idx:
                        matrix[hero_bkt][vill_bkt] = 0.75
                    elif hero_idx > vill_idx:
                        matrix[hero_bkt][vill_bkt] = 0.25
                    else:
                        matrix[hero_bkt][vill_bkt] = 0.50
        equity_matrix[texture] = matrix
        print(f"    {texture:12s}: {n_done:,} matchups computed")

    elapsed = time.time() - t0
    print(f"  Done in {elapsed:.1f}s")

    # Print sample equity matrix
    sample_tex = 'high_dry'
    print(f"\n  Sample equity (hero vs villain on {sample_tex}):")
    print(f"  {'':12s}", end="")
    for vb in BUCKETS:
        print(f" {vb[:6]:>6s}", end="")
    print()
    for hb in BUCKETS:
        print(f"  {hb:12s}", end="")
        for vb in BUCKETS:
            eq = equity_matrix[sample_tex][hb][vb]
            print(f" {eq:6.1%}", end="")
        print()

    return equity_matrix


if __name__ == "__main__":
    print("=== Bucket Distributions ===")
    probs = compute_bucket_probs()
    print("\n=== Equity Matrix ===")
    matrix = compute_equity_matrix(n_matchups_per_texture=20_000)
