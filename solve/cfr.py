"""CFR+ solver for abstracted postflop poker game tree."""

from collections import defaultdict
import numpy as np
from engine.abstraction import BUCKETS


# -- Action constants --
CHECK = 'check'
BET_S = 'bet_s'   # 33% pot
BET_M = 'bet_m'   # 66% pot
BET_L = 'bet_l'   # 100% pot
FOLD = 'fold'
CALL = 'call'
RAISE = 'raise'

# Bet sizes as fraction of pot
BET_SIZES = {BET_S: 0.33, BET_M: 0.66, BET_L: 1.0}
RAISE_MULT = 2.5  # raise = 2.5x the bet

# Players
OOP = 0  # out of position (acts first)
IP = 1   # in position

N_BUCKETS = len(BUCKETS)


class InfoSet:
    """One information set: (player, bucket, action_history).

    Stores cumulative regrets and strategy sums for CFR+.
    """

    def __init__(self, actions):
        self.n_actions = len(actions)
        self.actions = actions
        self.cumulative_regret = np.zeros(self.n_actions)
        self.strategy_sum = np.zeros(self.n_actions)

    def get_strategy(self):
        """Regret-matching: normalize positive regrets into a strategy."""
        positive = np.maximum(self.cumulative_regret, 0)
        total = positive.sum()
        if total > 0:
            return positive / total
        else:
            return np.ones(self.n_actions) / self.n_actions

    def get_average_strategy(self):
        """Average strategy over all iterations (the Nash equilibrium output)."""
        total = self.strategy_sum.sum()
        if total > 0:
            avg = self.strategy_sum / total
            # Clean up tiny values
            avg[avg < 0.005] = 0
            total2 = avg.sum()
            if total2 > 0:
                return avg / total2
            return np.ones(self.n_actions) / self.n_actions
        return np.ones(self.n_actions) / self.n_actions


class CFRSolver:
    """CFR+ solver for a single texture.

    Game tree:
        OOP acts: check / bet_s / bet_m / bet_l
        - If OOP checks: IP acts: check / bet_s / bet_m / bet_l
            - If IP checks: showdown
            - If IP bets: OOP faces bet: fold / call / raise
                - fold: IP wins
                - call: showdown
                - raise: IP faces raise: fold / call
                    - fold: OOP wins
                    - call: showdown
        - If OOP bets: IP faces bet: fold / call / raise
            - fold: OOP wins
            - call: showdown
            - raise: OOP faces raise: fold / call
                - fold: IP wins
                - call: showdown
    """

    def __init__(self, equity_matrix, bucket_probs):
        """
        Args:
            equity_matrix: {hero_bkt: {villain_bkt: equity}}
            bucket_probs: {bucket: probability}
        """
        self.equity = equity_matrix  # [hero_bkt][villain_bkt] = P(hero wins)
        self.bucket_probs = bucket_probs  # P(each bucket)
        self.info_sets = {}  # key -> InfoSet

    def _get_info_set(self, player, bucket_idx, history, actions):
        """Get or create an info set."""
        key = (player, bucket_idx, history)
        if key not in self.info_sets:
            self.info_sets[key] = InfoSet(actions)
        return self.info_sets[key]

    def _showdown_value(self, hero_bkt_idx, villain_bkt_idx, pot, hero_invested):
        """Expected value for hero at showdown."""
        hero_bkt = BUCKETS[hero_bkt_idx]
        vill_bkt = BUCKETS[villain_bkt_idx]
        eq = self.equity[hero_bkt][vill_bkt]
        return pot * eq - hero_invested

    def _cfr(self, history, opp_bucket_idx, hero_bucket_idx,
             player, pot, oop_invested, ip_invested,
             reach_opp, iteration):
        """Recursive CFR+ traversal.

        We traverse for one player at a time (external sampling style).
        The traversing player's strategy is used to compute counterfactual values.

        Args:
            history: tuple of actions taken so far
            opp_bucket_idx: opponent's bucket index (known for traversal)
            hero_bucket_idx: hero's bucket index
            player: whose turn it is (OOP=0, IP=1)
            pot: current pot size
            oop_invested: how much OOP has put in
            ip_invested: how much IP has put in
            reach_opp: opponent's reach probability
            iteration: current iteration number

        Returns:
            Expected value for the traversing player (OOP)
        """
        # Determine available actions based on history
        actions = self._get_actions(history)

        if actions is None:
            # Terminal: showdown
            return self._showdown_value(
                hero_bucket_idx=0,  # placeholder
                villain_bkt_idx=0,
                pot=pot,
                hero_invested=oop_invested
            )

        # Determine which player is acting
        acting_player = self._acting_player(history)
        if acting_player == OOP:
            acting_bkt_idx = hero_bucket_idx if player == OOP else opp_bucket_idx
        else:
            acting_bkt_idx = hero_bucket_idx if player == IP else opp_bucket_idx

        is_traversing = (acting_player == player)

        info_set = self._get_info_set(acting_player, acting_bkt_idx, history, actions)
        strategy = info_set.get_strategy()

        action_values = np.zeros(len(actions))
        node_value = 0.0

        for i, action in enumerate(actions):
            new_history = history + (action,)
            new_pot, new_oop_inv, new_ip_inv, terminal_value = \
                self._apply_action(action, history, pot, oop_invested, ip_invested, acting_player)

            if terminal_value is not None:
                # Terminal: fold
                if acting_player == OOP:
                    # OOP folded → IP wins. Value for OOP = -oop_invested
                    if action == FOLD:
                        child_val = -oop_invested if player == OOP else -ip_invested
                    else:
                        child_val = terminal_value  # won't reach here
                elif acting_player == IP:
                    if action == FOLD:
                        child_val = new_pot - oop_invested if player == OOP else -ip_invested
                    else:
                        child_val = terminal_value

                # Actually let me redo this more cleanly
                child_val = self._terminal_fold_value(
                    action, acting_player, player, pot, oop_invested, ip_invested
                )
            elif self._is_showdown(new_history):
                # Showdown
                if player == OOP:
                    child_val = self._showdown_value(
                        hero_bucket_idx, opp_bucket_idx,
                        new_pot, new_oop_inv
                    )
                else:
                    child_val = self._showdown_value(
                        hero_bucket_idx, opp_bucket_idx,
                        new_pot, new_ip_inv
                    )
            else:
                # Recurse
                if is_traversing:
                    child_val = self._cfr(
                        new_history, opp_bucket_idx, hero_bucket_idx,
                        player, new_pot, new_oop_inv, new_ip_inv,
                        reach_opp * strategy[i] if not is_traversing else reach_opp,
                        iteration
                    )
                else:
                    child_val = self._cfr(
                        new_history, opp_bucket_idx, hero_bucket_idx,
                        player, new_pot, new_oop_inv, new_ip_inv,
                        reach_opp * strategy[i],
                        iteration
                    )

            action_values[i] = child_val
            node_value += strategy[i] * child_val

        # Update regrets for traversing player only
        if is_traversing:
            for i in range(len(actions)):
                regret = action_values[i] - node_value
                # CFR+: floor regrets at 0
                info_set.cumulative_regret[i] = max(
                    info_set.cumulative_regret[i] + regret, 0
                )
        else:
            # Accumulate strategy sum for averaging
            info_set.strategy_sum += reach_opp * strategy

        return node_value

    def _terminal_fold_value(self, action, acting_player, traversing_player,
                             pot, oop_invested, ip_invested):
        """Value when someone folds."""
        assert action == FOLD
        # The folder loses what they've invested
        # The other player wins the pot
        if acting_player == OOP:
            # OOP folds, IP wins the pot
            if traversing_player == OOP:
                return -oop_invested
            else:
                return pot - ip_invested
        else:
            # IP folds, OOP wins the pot
            if traversing_player == OOP:
                return pot - oop_invested
            else:
                return -ip_invested

    def _acting_player(self, history):
        """Who acts next given the history."""
        if len(history) == 0:
            return OOP  # OOP acts first

        last = history[-1]

        if len(history) == 1:
            # OOP acted, now IP's turn
            return IP

        if len(history) == 2:
            # OOP acted, IP acted
            first, second = history
            if first == CHECK:
                # OOP checked, IP acted
                if second in (BET_S, BET_M, BET_L):
                    return OOP  # OOP faces bet
                # IP checked → showdown (handled elsewhere)
            else:
                # OOP bet, IP responded
                if second == RAISE:
                    return OOP  # OOP faces raise
                # fold/call → terminal

        if len(history) == 3:
            # Three actions deep
            first, second, third = history
            if first == CHECK and second in (BET_S, BET_M, BET_L):
                # OOP checked, IP bet, OOP responded
                if third == RAISE:
                    return IP  # IP faces raise
            elif first in (BET_S, BET_M, BET_L) and second == RAISE:
                # OOP bet, IP raised, OOP responded — terminal
                pass

        # Default (shouldn't reach here for valid histories)
        return OOP

    def _get_actions(self, history):
        """Return available actions, or None if terminal/showdown."""
        if self._is_showdown(history):
            return None

        n = len(history)

        if n == 0:
            # OOP acts first
            return [CHECK, BET_S, BET_M, BET_L]

        if n == 1:
            first = history[0]
            if first == CHECK:
                # IP acts after check
                return [CHECK, BET_S, BET_M, BET_L]
            else:
                # IP faces OOP bet
                return [FOLD, CALL, RAISE]

        if n == 2:
            first, second = history
            if first == CHECK and second in (BET_S, BET_M, BET_L):
                # OOP faces IP bet after check-bet
                return [FOLD, CALL, RAISE]
            if first in (BET_S, BET_M, BET_L) and second == RAISE:
                # OOP faces raise after bet-raise
                return [FOLD, CALL]

        if n == 3:
            first, second, third = history
            if first == CHECK and second in (BET_S, BET_M, BET_L) and third == RAISE:
                # IP faces raise after check-bet-raise
                return [FOLD, CALL]

        return None  # Terminal

    def _is_showdown(self, history):
        """Check if history reaches showdown."""
        n = len(history)
        if n < 2:
            return False

        if n == 2:
            first, second = history
            if first == CHECK and second == CHECK:
                return True
            if first in (BET_S, BET_M, BET_L) and second == CALL:
                return True
            return False

        if n == 3:
            first, second, third = history
            if first == CHECK and second in (BET_S, BET_M, BET_L) and third == CALL:
                return True
            if first in (BET_S, BET_M, BET_L) and second == RAISE and third == CALL:
                return True
            return False

        if n == 4:
            first, second, third, fourth = history
            if (first == CHECK and second in (BET_S, BET_M, BET_L)
                    and third == RAISE and fourth == CALL):
                return True
            return False

        return False

    def _apply_action(self, action, history, pot, oop_invested, ip_invested, acting_player):
        """Apply action, return (new_pot, new_oop_inv, new_ip_inv, terminal_value).

        terminal_value is not None only for fold actions.
        """
        if action == FOLD:
            return pot, oop_invested, ip_invested, 0.0  # terminal marker

        if action == CHECK:
            return pot, oop_invested, ip_invested, None

        if action == CALL:
            # Match the last bet/raise
            if acting_player == OOP:
                call_amount = ip_invested - oop_invested
                new_oop = oop_invested + call_amount
                return pot + call_amount, new_oop, ip_invested, None
            else:
                call_amount = oop_invested - ip_invested
                new_ip = ip_invested + call_amount
                return pot + call_amount, oop_invested, new_ip, None

        if action in (BET_S, BET_M, BET_L):
            bet_frac = BET_SIZES[action]
            bet_amount = pot * bet_frac
            if acting_player == OOP:
                new_oop = oop_invested + bet_amount
                return pot + bet_amount, new_oop, ip_invested, None
            else:
                new_ip = ip_invested + bet_amount
                return pot + bet_amount, oop_invested, new_ip, None

        if action == RAISE:
            # Find the last bet amount
            last_bet_action = None
            for h in reversed(history):
                if h in (BET_S, BET_M, BET_L):
                    last_bet_action = h
                    break

            if last_bet_action:
                original_bet = pot * BET_SIZES[last_bet_action]
                # Hmm, pot has changed since the bet. Use the raise multiplier on the bet size.
                raise_amount = original_bet * RAISE_MULT
            else:
                raise_amount = pot  # fallback

            if acting_player == OOP:
                # OOP needs to match IP's bet first, then raise on top
                call_amount = max(ip_invested - oop_invested, 0)
                total = call_amount + raise_amount
                new_oop = oop_invested + total
                return pot + total, new_oop, ip_invested, None
            else:
                call_amount = max(oop_invested - ip_invested, 0)
                total = call_amount + raise_amount
                new_ip = ip_invested + total
                return pot + total, oop_invested, new_ip, None

        return pot, oop_invested, ip_invested, None

    def train(self, n_iterations=100_000):
        """Run CFR+ for n_iterations."""
        bucket_prob_array = np.array([self.bucket_probs.get(b, 0) for b in BUCKETS])
        # Normalize
        total = bucket_prob_array.sum()
        if total > 0:
            bucket_prob_array /= total

        initial_pot = 1.0  # normalized pot

        for t in range(n_iterations):
            # For each pair of bucket assignments, traverse
            for opp_idx in range(N_BUCKETS):
                if bucket_prob_array[opp_idx] < 1e-6:
                    continue
                for hero_idx in range(N_BUCKETS):
                    if bucket_prob_array[hero_idx] < 1e-6:
                        continue

                    reach = bucket_prob_array[opp_idx]

                    # Traverse for OOP
                    self._cfr(
                        history=(),
                        opp_bucket_idx=opp_idx,
                        hero_bucket_idx=hero_idx,
                        player=OOP,
                        pot=initial_pot,
                        oop_invested=0.5,  # blinds
                        ip_invested=0.5,
                        reach_opp=reach,
                        iteration=t
                    )

                    # Traverse for IP
                    self._cfr(
                        history=(),
                        opp_bucket_idx=hero_idx,  # swap roles
                        hero_bucket_idx=opp_idx,
                        player=IP,
                        pot=initial_pot,
                        oop_invested=0.5,
                        ip_invested=0.5,
                        reach_opp=bucket_prob_array[hero_idx],
                        iteration=t
                    )

    def get_strategies(self):
        """Extract converged strategies organized by position and bucket.

        Returns:
            oop_first: {bucket: {action: prob}} — OOP acting first
            ip_vs_check: {bucket: {action: prob}} — IP after OOP checks
            facing_bet: {bucket: {action: prob}} — facing a bet (averaged across contexts)
        """
        oop_first = {}
        ip_vs_check = {}

        # Collect all facing-bet info sets, then average properly
        # Key: bucket -> list of strategy dicts
        fb_collected = defaultdict(list)

        for (player, bucket_idx, history), info_set in self.info_sets.items():
            bucket = BUCKETS[bucket_idx]
            avg = info_set.get_average_strategy()
            strat = {}
            for i, a in enumerate(info_set.actions):
                if avg[i] > 0:
                    strat[a] = round(float(avg[i]), 3)

            if not strat:
                continue

            # Normalize to sum to 1
            total = sum(strat.values())
            if total > 0:
                strat = {a: round(v / total, 3) for a, v in strat.items()}

            if player == OOP and history == ():
                oop_first[bucket] = strat

            elif player == IP and history == (CHECK,):
                ip_vs_check[bucket] = strat

            elif player == OOP and len(history) == 2:
                first, second = history
                if first == CHECK and second in (BET_S, BET_M, BET_L):
                    fb_collected[bucket].append(strat)

            elif player == IP and len(history) == 1:
                first = history[0]
                if first in (BET_S, BET_M, BET_L):
                    fb_collected[bucket].append(strat)

        # Average all facing-bet strategies per bucket, then normalize
        facing_bet = {}
        for bucket in BUCKETS:
            strats = fb_collected.get(bucket, [])
            if not strats:
                continue
            merged = defaultdict(float)
            for s in strats:
                for a, p in s.items():
                    merged[a] += p
            n = len(strats)
            averaged = {a: round(v / n, 3) for a, v in merged.items()}
            # Re-normalize to sum to 1
            total = sum(averaged.values())
            if total > 0:
                facing_bet[bucket] = {a: round(v / total, 3) for a, v in averaged.items()}

        return oop_first, ip_vs_check, facing_bet
