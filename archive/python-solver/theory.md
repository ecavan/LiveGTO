# LiveGTO: Theory & Mathematics of the CFR+ Poker Solver

## Table of Contents

1. [Introduction: What is GTO Poker?](#1-introduction-what-is-gto-poker)
2. [Game Abstraction](#2-game-abstraction)
3. [Equity Computation](#3-equity-computation)
4. [The CFR+ Algorithm](#4-the-cfr-algorithm)
5. [Implementation Details](#5-implementation-details)
6. [Strategic Insights from the Solver](#6-strategic-insights-from-the-solver)

---

## 1. Introduction: What is GTO Poker?

### 1.1 The Fundamental Problem

Poker is an **imperfect information game** -- players make decisions under uncertainty about their opponents' hidden cards. Unlike chess or Go, where both players see the entire board, a poker player must reason about a *distribution* of possible hands the opponent could hold. This makes poker one of the most mathematically rich games in existence.

**Game Theory Optimal (GTO)** play is a strategy that cannot be exploited. More precisely, a GTO strategy is a **Nash Equilibrium**: a profile of strategies (one per player) where no player can unilaterally improve their expected value by deviating. If you play GTO, your long-run expected value is guaranteed to be non-negative regardless of what your opponent does.

### 1.2 Why Solve for Nash Equilibrium?

The motivation for computing Nash equilibria in poker is threefold:

1. **Unexploitability**: A Nash equilibrium strategy guarantees you cannot lose in expectation against any opponent strategy. If your opponent deviates from equilibrium, they can only hurt themselves.

2. **Baseline for exploitation**: Understanding GTO play gives you a foundation. Once you know what *balanced* play looks like, you can identify how opponents deviate and adjust accordingly.

3. **Mixed strategy insights**: GTO solutions are typically *mixed strategies* -- randomizing between actions with specific frequencies. These frequencies reveal deep structural truths about how hand strength, board texture, and position interact.

### 1.3 The Scale Challenge

Full No-Limit Hold'em has approximately $10^{164}$ game states -- far beyond what any computer can solve exactly. The approach in LiveGTO is to **abstract** the game into a tractable form: reducing the infinite space of possible hands, boards, and bet sizes into a finite (and small) number of **information sets**, then solving the abstracted game using Counterfactual Regret Minimization (CFR+).

---

## 2. Game Abstraction

### 2.1 The Abstraction Pipeline

The full poker game tree is reduced along three dimensions:

| Dimension | Full Game | LiveGTO Abstraction |
|-----------|-----------|---------------------|
| **Hand space** | 1,326 preflop combos, each with unique postflop equity | **9 hand buckets** based on hand strength + draw potential |
| **Board space** | ~22,100 distinct flops | **5 board textures** based on suits, connectivity, and rank distribution |
| **Action space** | Continuous bet sizing [0, all-in] | **3 bet sizes** (33%, 66%, 100% pot) + check/fold/call/raise |

This reduces a game with billions of information sets to one with on the order of a few hundred per texture, making CFR+ convergence feasible in 10,000 iterations.

### 2.2 Hand Buckets (9 Categories)

Hands are classified into 9 **strength buckets**, ordered from strongest to weakest. Crucially, the classification is **texture-aware** -- the same physical hand (e.g., pocket Kings) maps to different buckets depending on the board.

| Bucket | Label | Examples |
|--------|-------|----------|
| `premium` | Full house+, nut flush, top set on dry | Quads, full house, A-high flush, top set on rainbow board |
| `nut` | Set, non-nut flush, top two, combo draw | K-high flush, middle set on dry, flush draw + OESD |
| `strong` | Overpair QQ+, TPTK, straight, low flush | QQ+ on low board, AK on K-high flop, nut straight |
| `good` | Overpair TT-JJ, TP good kicker, trips on wet | JJ on 9-high board, KQ on K-high flop |
| `medium` | Low overpair, TP weak kicker, mid pair | 88 on 7-high board, K4 on K-high flop, middle pair |
| `draw` | Flush draw, OESD | Four to a flush, open-ended straight draw |
| `weak_made` | Bottom pair, underpair | Third pair, pocket 5s on a KQ9 board |
| `weak_draw` | Gutshot, backdoor draw | Inside straight draw, three to a flush |
| `air` | Nothing | No pair, no draw, no overcards |

**Texture-dependent classification** is the key innovation. Consider a set of pocket Tens on a `T-7-2` rainbow board:

- On `low_dry`: This is `premium` (top set, dry board, no draws threatening)
- On `wet` (e.g., `T-9-8` two-tone): This is `nut` (top set but straights and flushes are possible)
- On `monotone` (e.g., `T-7-2` all spades): This is `nut` (vulnerable to flush draws)

The classification logic lives in `engine/abstraction.py` and uses the `treys` poker hand evaluator for the raw hand rank, then applies texture-aware adjustments via sub-classifiers for each hand category (flush, straight, trips, two pair, pair, unmade).

### 2.3 Board Textures (5 Categories)

Board textures are classified in `engine/postflop.py` based on three properties of the flop cards: **suit distribution**, **rank pairing**, and **connectivity/height**.

| Texture | Definition | Strategic Implication |
|---------|------------|----------------------|
| `monotone` | 3+ cards of the same suit | Flush possible on flop; flush draws dominate action |
| `paired` | Board contains a pair | Full houses and trips possible; hand reading changes |
| `wet` | Two-tone (2 of same suit) + connected (max gap <= 2) | Many draws available; aggressive play rewarded |
| `high_dry` | Rainbow, 2+ broadway cards (T+), not connected | Fewer draws; value hands dominate; more checking |
| `low_dry` | Rainbow, unconnected, mostly low cards | Very few draws; positional advantage amplified |

The classification function applies these tests in priority order: monotone check first (3+ same suit), then paired check (any rank appearing 2+), then wetness (two-tone AND connected), and finally high vs. low dry based on how many cards are Ten or above.

### 2.4 Position-Based Strategy Tables

The game tree is structured around **two positions**:

- **OOP (Out of Position)**: Acts first on every street. This is a fundamental disadvantage because OOP must commit to an action without seeing what IP does.
- **IP (In Position)**: Acts second, with the informational advantage of seeing OOP's action before deciding.

The solver produces three strategy tables per texture:

1. **OOP First Action**: What should OOP do when acting first? (`check`, `bet_s`, `bet_m`, `bet_l`)
2. **IP vs Check**: After OOP checks, what should IP do? (`check`, `bet_s`, `bet_m`, `bet_l`)
3. **Facing Bet**: When facing a bet (either player), what to do? (`fold`, `call`, `raise`)

---

## 3. Equity Computation

### 3.1 Overview

Before the CFR+ solver can compute strategies, it needs to know how each hand bucket performs against every other bucket. This is captured in the **equity matrix** -- a 9x9 matrix (per texture) where entry $(i, j)$ is the probability that bucket $i$ wins against bucket $j$ at showdown.

Formally:

$$E_{ij}^{(t)} = P(\text{bucket } i \text{ wins} \mid \text{hero has bucket } i, \text{ villain has bucket } j, \text{ texture } = t)$$

We also need the **bucket probability distribution** per texture:

$$p_b^{(t)} = P(\text{hand is in bucket } b \mid \text{ board has texture } t)$$

### 3.2 Monte Carlo Bucket Probability Estimation

The function `compute_bucket_probs()` estimates $p_b^{(t)}$ by dealing random hands.

**Algorithm:**

```
For n_samples = 50,000 iterations:
    1. Shuffle a full 52-card deck
    2. Deal 2 hole cards and 3 board cards
    3. Classify the board texture: t = classify_texture(board)
    4. Classify the hand into a bucket: b = classify_hand(hand, board, t)
    5. Increment count[t][b]

For each texture t:
    p_b^(t) = count[t][b] / sum_over_b(count[t][b])
```

This is straightforward Monte Carlo sampling. With 50,000 samples, textures that appear frequently (like `low_dry` and `high_dry`, which cover the majority of rainbow unconnected boards) get very precise estimates. Rarer textures like `wet` get fewer samples but still sufficient for convergence.

**Observed bucket distributions from the solver output:**

| Texture | Most Common Bucket | Distribution Highlights |
|---------|-------------------|------------------------|
| `monotone` | `weak_draw` (33.5%) | High draw frequency (22.4% `draw`), zero `air` (overcards count as draws) |
| `paired` | `weak_made` (45.2%) | Massive `strong` component (25.6% -- trips/two pair), zero `good`/`medium`/`air` |
| `wet` | `weak_draw` (36.1%) | Broad distribution, 10% `air`, meaningful draw + made hand presence |
| `high_dry` | `weak_draw` (29.1%) | Large `air` component (27.7%), very low `premium` (0.25%) |
| `low_dry` | `weak_draw` (35.1%) | Similar to high_dry but slightly more `weak_made`, 21.4% `air` |

Notable: on `monotone` boards, **no hands are classified as `air`** because any two cards have at least backdoor flush potential or overcards that map to `weak_draw`. On `paired` boards, `good`, `medium`, and `air` buckets have zero probability -- the pairing dramatically reshapes the hand strength distribution.

### 3.3 Equity Matrix Construction

The equity matrix is the most computationally expensive part of the pipeline. The function `compute_equity_matrix()` uses **multiprocessing** -- one worker per texture, running in parallel.

**Per-texture worker algorithm** (`_equity_worker`):

```
For up to max_attempts (30 * n_matchups):
    1. Shuffle a fresh deck
    2. Draw 9 cards: board[3] + hand1[2] + hand2[2] + turn_river[2]
    3. If classify_texture(board) != target_texture: skip (rejection sampling)
    4. Classify both hands into buckets: b1, b2
    5. Evaluate both hands on the full 5-card board using treys
    6. Record win/loss/tie in wins[b1][b2] and wins[b2][b1]

    # Board reuse optimization:
    7. Draw 4 more cards for hand3[2] + hand4[2]
    8. Evaluate and record all cross-matchups: (h1,h3), (h1,h4), (h2,h3), (h2,h4)

Equity[b_i][b_j] = wins[b_i][b_j] / totals[b_i][b_j]
```

**Key design decisions:**

1. **Rejection sampling for texture matching**: The worker generates random boards and discards those that do not match the target texture. This is necessary because we need equity *conditional on* a specific texture. For rare textures (e.g., `wet` boards where suits and connectivity must align), many boards are rejected, hence the 30x oversampling multiplier.

2. **Board reuse**: When a matching board is found, the worker draws two additional hands and computes all pairwise matchups (6 total per board). This drastically increases sample efficiency -- instead of finding a new matching board for every data point, we extract 6 data points per board.

3. **Ordinal fallback heuristic**: For bucket pairs with no observed matchups (can happen for very rare buckets like `premium` vs `premium`), the code falls back to an ordinal heuristic: if hero's bucket index is lower (stronger), equity defaults to 0.75; if higher (weaker), 0.25; if equal, 0.50. This is visible in the `air` bucket rows of the output where `air` vs every bucket shows 0.25 or 0.75 equity on textures where `air` has zero probability.

4. **30,000 matchups per texture**: With board reuse generating ~6 matchups per matching board, this means roughly 5,000 board draws per texture, providing robust statistical estimates for the majority of bucket pairs.

### 3.4 Sample Equity Matrices

From the solver output, here are selected equity values that illustrate the structure:

**High Dry texture:**

| Hero \\ Villain | premium | nut | strong | medium | draw | air |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **premium** | 0.500 | 1.000 | 0.750 | 1.000 | 0.714 | 0.976 |
| **nut** | 0.000 | 0.500 | 0.708 | 0.892 | 0.663 | 0.944 |
| **strong** | 0.250 | 0.292 | 0.500 | 0.799 | 0.677 | 0.960 |
| **medium** | 0.000 | 0.108 | 0.201 | 0.500 | 0.604 | 0.947 |
| **draw** | 0.286 | 0.337 | 0.323 | 0.396 | 0.500 | 0.804 |
| **air** | 0.024 | 0.056 | 0.040 | 0.053 | 0.196 | 0.500 |

Key observations:
- The matrix is **not symmetric**: $E_{ij} + E_{ji} = 1$ (zero-sum property, ties excluded). If premium beats nut 100% of the time, nut beats premium 0%.
- **Draws have surprisingly high equity** against made hands: `draw` vs `medium` = 0.396 (draws win nearly 40% of the time at showdown because they complete on the turn/river).
- **Air is nearly dead**: `air` vs `medium` = 0.053 -- only 5.3% equity, reflecting that high-card hands almost never win at showdown against any pair.

---

## 4. The CFR+ Algorithm

### 4.1 Background: Extensive-Form Games

Poker is modeled as an **extensive-form game** -- a game tree where:
- Each node represents a decision point or chance event
- Each edge represents an action
- **Information sets** group nodes that are indistinguishable to the acting player (e.g., all nodes where OOP holds `medium` bucket and no actions have been taken yet)

An **information set** $I$ for player $i$ consists of all game tree nodes where:
1. It is player $i$'s turn to act
2. Player $i$ has the same observable information (their cards, the board, the action history)

The strategy at an information set $\sigma_I(a)$ gives the probability of choosing action $a$ at $I$.

### 4.2 Counterfactual Value

The central quantity in CFR is the **counterfactual value** -- the expected payoff for player $i$ at information set $I$, assuming player $i$ plays to reach $I$ (with probability 1) but all other players play according to their strategies.

Formally, let $z$ be a terminal node (game outcome) and $u_i(z)$ the payoff. Let $\pi_{-i}^\sigma(h)$ be the reach probability of node $h$ under strategy profile $\sigma$ due to all players *other than* $i$ and chance. Then the counterfactual value is:

$$v_i(I) = \sum_{h \in I} \sum_{z \in Z(h)} \pi_{-i}^\sigma(h) \cdot \pi^\sigma(h, z) \cdot u_i(z)$$

where $Z(h)$ is the set of terminal nodes reachable from $h$, and $\pi^\sigma(h, z)$ is the probability of reaching $z$ from $h$ under $\sigma$.

The **counterfactual value for a specific action** $a$ at $I$ is:

$$v_i(I, a) = \sum_{h \in I} \sum_{z \in Z(h, a)} \pi_{-i}^\sigma(h) \cdot \pi^\sigma(ha, z) \cdot u_i(z)$$

### 4.3 Regret and Regret Matching

The **instantaneous counterfactual regret** for not choosing action $a$ at information set $I$ on iteration $t$ is:

$$r^t(I, a) = v_i^t(I, a) - v_i^t(I)$$

This measures "how much better would action $a$ have been compared to my current mixed strategy at $I$?"

If $r^t(I, a) > 0$, action $a$ was better than the current strategy -- we "regret" not playing it more. If $r^t(I, a) < 0$, we're glad we didn't play it more.

The **cumulative regret** after $T$ iterations is:

$$R^T(I, a) = \sum_{t=1}^{T} r^t(I, a)$$

**Regret matching** converts cumulative regrets into a strategy:

$$\sigma^{T+1}(I, a) = \begin{cases} \frac{R^{T,+}(I, a)}{\sum_{a'} R^{T,+}(I, a')} & \text{if } \sum_{a'} R^{T,+}(I, a') > 0 \\ \frac{1}{|A(I)|} & \text{otherwise} \end{cases}$$

where $R^{T,+}(I, a) = \max(R^T(I, a), 0)$ denotes the positive part of the cumulative regret.

In code, this is the `get_strategy()` method:

```python
def get_strategy(self):
    positive = np.maximum(self.cumulative_regret, 0)
    total = positive.sum()
    if total > 0:
        return positive / total
    else:
        return np.ones(self.n_actions) / self.n_actions
```

When no action has positive cumulative regret, the strategy defaults to **uniform random** (equal probability on all actions).

### 4.4 The "+" in CFR+ (Regret Clamping)

Standard CFR accumulates regrets that can go deeply negative. CFR+ (introduced by Tammelin, 2014) makes one critical modification: **cumulative regrets are clamped to zero on every iteration**.

In standard CFR:

$$R^{T}(I, a) = R^{T-1}(I, a) + r^t(I, a)$$

In CFR+:

$$R^{T}(I, a) = \max\left(R^{T-1}(I, a) + r^t(I, a),\ 0\right)$$

This is implemented directly in the code:

```python
# CFR+: floor regrets at 0
info_set.cumulative_regret[i] = max(
    info_set.cumulative_regret[i] + regret, 0
)
```

**Why does this help?** In standard CFR, an action that was very bad early on accumulates deep negative regret. Even if the action becomes good later (as the opponent's strategy changes), it takes many iterations for the cumulative regret to climb back to zero and start influencing the strategy. CFR+ eliminates this "debt": once an action's cumulative regret would go negative, it is reset to zero, allowing the strategy to adapt faster.

The practical impact is dramatic: **CFR+ converges roughly 10x faster than vanilla CFR** in poker games. Where vanilla CFR might need 100,000+ iterations, CFR+ achieves similar convergence in 10,000.

### 4.5 Convergence to Nash Equilibrium

The key theoretical result is that the **average strategy** over all iterations converges to a Nash equilibrium.

The average strategy is computed using cumulative strategy weights:

$$\bar{\sigma}^T(I, a) = \frac{\sum_{t=1}^{T} \pi_i^t(I) \cdot \sigma^t(I, a)}{\sum_{t=1}^{T} \pi_i^t(I)}$$

where $\pi_i^t(I)$ is player $i$'s reach probability to $I$ on iteration $t$.

In the code, this weighting is done by multiplying by the opponent's reach probability:

```python
# Accumulate strategy sum for averaging
info_set.strategy_sum += reach_opp * strategy
```

And the average strategy is extracted by normalizing:

```python
def get_average_strategy(self):
    total = self.strategy_sum.sum()
    if total > 0:
        avg = self.strategy_sum / total
        avg[avg < 0.005] = 0  # clean up tiny values
        total2 = avg.sum()
        if total2 > 0:
            return avg / total2
    return np.ones(self.n_actions) / self.n_actions
```

Note the cleanup step: values below 0.5% are zeroed out. This is a practical consideration -- tiny probabilities (e.g., betting 0.3% of the time) are artifacts of the averaging process and not strategically meaningful.

**Convergence guarantee (Zinkevich et al., 2007):**

For a two-player zero-sum game, if both players use regret matching, the average strategy profile $\bar{\sigma}^T$ is an $\varepsilon$-Nash equilibrium where:

$$\varepsilon = O\left(\frac{\Delta \cdot |I| \cdot \sqrt{|A|}}{T}\right)$$

Here:
- $\Delta$ is the range of payoffs (pot size)
- $|I|$ is the number of information sets
- $|A|$ is the maximum number of actions at any information set
- $T$ is the number of iterations

So exploitability decreases as $O(1/T)$ -- after 10,000 iterations with our small abstraction (~100-200 info sets per texture, at most 4 actions), the strategies should be very close to equilibrium.

### 4.6 What Is Being Minimized

The quantity being minimized is **exploitability** (also called the Nash distance or saddle-point gap):

$$\text{exploit}(\sigma) = \max_{\sigma_1'} u_1(\sigma_1', \sigma_2) + \max_{\sigma_2'} u_2(\sigma_1, \sigma_2')$$

This measures the sum of what each player could gain by deviating to a best response. At a Nash equilibrium, exploitability is zero -- neither player can improve by changing strategy.

Equivalently, we can express this in terms of **average overall regret**:

$$\bar{R}_i^T = \frac{1}{T} \max_{\sigma_i^*} \sum_{t=1}^{T} \left[ u_i(\sigma_i^*, \sigma_{-i}^t) - u_i(\sigma_i^t, \sigma_{-i}^t) \right]$$

The average overall regret for each player converges to zero at rate $O(1/\sqrt{T})$ for vanilla CFR and empirically faster for CFR+.

---

## 5. Implementation Details

### 5.1 Information Set Structure

Each information set is keyed by a tuple:

```python
key = (player, bucket_idx, history)
```

where:
- `player` is `OOP` (0) or `IP` (1)
- `bucket_idx` is an integer 0-8 indexing into the `BUCKETS` list
- `history` is a tuple of actions taken so far (e.g., `()`, `('check',)`, `('check', 'bet_s')`)

The `InfoSet` object stores two numpy arrays:
- `cumulative_regret[n_actions]` -- CFR+ cumulative regrets (clamped to zero)
- `strategy_sum[n_actions]` -- weighted cumulative strategy for average computation

### 5.2 Game Tree Structure

The solver models a **single street** of postflop play (e.g., the flop) with the following tree:

```
Root: OOP acts
├── check
│   └── IP acts
│       ├── check → SHOWDOWN
│       ├── bet_s/bet_m/bet_l
│       │   └── OOP faces bet
│       │       ├── fold → IP WINS
│       │       ├── call → SHOWDOWN
│       │       └── raise
│       │           └── IP faces raise
│       │               ├── fold → OOP WINS
│       │               └── call → SHOWDOWN
├── bet_s/bet_m/bet_l
│   └── IP faces bet
│       ├── fold → OOP WINS
│       ├── call → SHOWDOWN
│       └── raise
│           └── OOP faces raise
│               ├── fold → IP WINS
│               └── call → SHOWDOWN
```

Maximum depth: 4 actions. This gives a tree with:
- **Root**: 4 actions for OOP (check, bet_s, bet_m, bet_l)
- **After check**: 4 actions for IP
- **After bet**: 3 actions for IP (fold, call, raise)
- **After check-bet**: 3 actions for OOP (fold, call, raise)
- **After bet-raise or check-bet-raise**: 2 actions (fold, call)

### 5.3 Bet Sizing Model

Three discrete bet sizes as fractions of the current pot:

| Action | Size | Purpose |
|--------|------|---------|
| `bet_s` | 33% pot | Thin value / blocking bet / cheap bluff |
| `bet_m` | 66% pot | Standard value bet / semi-bluff |
| `bet_l` | 100% pot (pot-sized) | Polarized bet (strong value or bluff) |

Raises are computed as 2.5x the original bet size:

$$\text{raise\_amount} = 2.5 \times \text{original\_bet}$$

For example, if IP bets 33% pot (bet_s = 0.33 units into a 1.0 unit pot), a raise would be $2.5 \times 0.33 = 0.825$ additional units. The raiser first calls the bet (0.33), then adds the raise (0.825), for a total commitment of 1.155 units.

### 5.4 Showdown Value Calculation

At showdown, the expected value for the hero is:

$$\text{EV}_{\text{hero}} = \text{pot} \times E[\text{hero\_bucket}][\text{villain\_bucket}] - \text{hero\_invested}$$

where:
- `pot` is the total chips in the pot at showdown
- $E[h][v]$ is the equity of hero's bucket vs villain's bucket (from the equity matrix)
- `hero_invested` is how much the hero has put into the pot

This maps equity (a probability from 0 to 1) into chip-denominated expected value. If the hero has 60% equity in a 10-unit pot and invested 3 units, their EV is $10 \times 0.6 - 3 = +3.0$ units.

### 5.5 Training Loop

The main training loop iterates over all pairs of bucket assignments:

```python
for t in range(n_iterations):          # 10,000 iterations
    for opp_idx in range(N_BUCKETS):   # 9 buckets
        for hero_idx in range(N_BUCKETS):  # 9 buckets
            # Skip impossible bucket assignments
            if bucket_prob[opp_idx] < 1e-6: continue
            if bucket_prob[hero_idx] < 1e-6: continue

            # Traverse for OOP as hero
            _cfr(hero=OOP, hero_bucket=hero_idx, opp_bucket=opp_idx)

            # Traverse for IP as hero
            _cfr(hero=IP, hero_bucket=opp_idx, opp_bucket=hero_idx)
```

Each iteration traverses the game tree twice (once for each player) for every possible pair of bucket assignments. This ensures that regrets are updated symmetrically and all information sets are visited proportionally to their relevance (weighted by bucket probabilities).

The initial pot is normalized to 1.0, with each player having invested 0.5 (representing the blinds). This means all strategic outputs are in terms of pot-relative values.

### 5.6 Orchestration Pipeline

The full pipeline in `solve/generate.py` runs in four phases:

1. **Phase 1 -- Monte Carlo Equity**: Compute bucket probabilities (50K samples) and equity matrices (30K matchups/texture) using multiprocessing
2. **Phase 2 -- CFR+ Solving**: For each of the 5 textures, instantiate a `CFRSolver` with that texture's equity matrix and bucket probabilities, run 10,000 CFR+ iterations, and extract converged strategies
3. **Phase 3 -- Export**: Save all strategies, equity matrices, and bucket probabilities to `data/strategies.json`
4. **Phase 4 -- Comparison**: Compare CFR-solved strategies against hand-tuned heuristic baselines, reporting any strategies that differ by more than 15%

---

## 6. Strategic Insights from the Solver

### 6.1 The Solver's Verdict: GTO vs Hand-Tuned Heuristics

The solver output reveals some dramatic differences from the hand-tuned heuristic strategies. While the heuristics were designed by human intuition (and are reasonable approximations), the solver found several cases where the optimal strategy is qualitatively different.

### 6.2 OOP Strategy: The Checking Epidemic

The most striking result is how much more the solver checks compared to hand-tuned heuristics, especially with medium-strength hands.

**OOP First Action -- Solver Results:**

| Texture | premium | nut | strong | good | medium | draw | weak_made | weak_draw | air |
|---------|---------|-----|--------|------|--------|------|-----------|-----------|-----|
| **monotone** | bet_l 100% | check 89% | bet_s 100% | check 97% | check 100% | check 100% | check 100% | check 100% | -- |
| **paired** | bet_l 100% | bet_s 100% | check 97% | -- | -- | check 100% | check 100% | check 100% | -- |
| **wet** | -- | bet_s 99% | bet_l 100% | bet_s 100% | bet_s 100% | check 100% | check 100% | check 100% | check 100% |
| **high_dry** | bet_l 100% | bet_s 99% | bet_s 100% | check 99% | check 100% | check 100% | check 100% | check 100% | check 100% |
| **low_dry** | bet_l 100% | bet_l 100% | bet_s 100% | check 76% | check 100% | check 100% | check 100% | check 100% | check 100% |

**Key insight: OOP plays an extremely polarized strategy.** Whereas the hand-tuned heuristics had OOP betting with many hand categories at various frequencies, the solver converged to a near-binary approach:

- **Bet large (100% pot) with the absolute nuts**: Premium hands always bet pot or more. On `low_dry`, even nut hands bet pot-sized.
- **Bet small (33% pot) with strong/nut hands**: On most textures, nut and strong hands use small bets. This is the solver discovering that small bets extract the most value from weak calling ranges.
- **Check everything else**: Good, medium, draw, weak_made, weak_draw, and air almost always check. This is dramatically different from the heuristics, which had these hands betting 20-40% of the time.

**Why does OOP check so much?** Being out of position is a severe disadvantage. When OOP bets and faces a raise, they are in a terrible spot -- they've committed chips without information. By checking, OOP:
1. Avoids being raised off medium-strength hands
2. Gives draws a chance to improve cheaply
3. Traps opponents into betting (where OOP can then call or raise with information)
4. Keeps the pot small when their hand cannot withstand aggression

### 6.3 IP Strategy: Exploiting Positional Advantage

IP's strategy after OOP checks mirrors OOP's polarization but from a position of strength:

**IP vs Check -- Solver Results:**

| Texture | premium | nut | strong | good | medium-air |
|---------|---------|-----|--------|------|-----------|
| **monotone** | bet_l 100% | check 100% | check 89% | check 100% | check 100% |
| **paired** | bet_l 100% | bet_s 59% / check 41% | check 100% | -- | check 100% |
| **wet** | -- | bet_s 100% | bet_l 100% | bet_s 98% | check 100% |
| **high_dry** | bet_l 100% | bet_s 98% | check 99% | check 100% | check 100% |
| **low_dry** | bet_l 99% | bet_l 100% | check 100% | check 100% | check 100% |

**Surprising result: IP also checks back a lot.** The common heuristic is that IP should "take advantage of position" by betting frequently. But the solver reveals that after OOP checks, IP often checks back with medium-strength hands.

The reasoning: when OOP checks, their range is capped (they've already shown weakness by not betting). IP's medium-strength hands can comfortably check back for showdown value. Betting would only accomplish two things: (1) getting called by better hands and (2) getting folds from worse hands -- the classic "worst of both worlds" scenario.

### 6.4 Texture-Dependent Betting Patterns

The solver reveals that **board texture dramatically changes optimal strategy**.

**Wet boards produce the most action:**
- On `wet` textures, nut hands bet small (99%), strong hands bet large (100%), and good/medium hands also bet small (98-100%).
- This is the only texture where medium hands bet instead of check.
- The presence of draws means hands need protection, and even medium hands have enough equity to profitably bet.

**Monotone boards suppress betting:**
- On `monotone` textures, even nut hands (non-nut flushes, sets) check 89% of the time.
- Only premiums (nut flush, full house) bet.
- The logic: on a monotone board, if villain has a flush or draw, they are continuing regardless. If they do not have a flush component, they are folding to any bet. So betting medium-strength hands accomplishes nothing.

**Dry boards favor small bets:**
- On `high_dry` and `low_dry`, the solver strongly prefers 33% pot bets over larger sizings.
- On `low_dry`, nut hands deviate by using pot-sized bets -- likely because on very dry, low boards, the nut advantage is so pronounced that the solver can extract maximum value with large bets.

### 6.5 Facing Bet Strategies: The Calling Station Emerges

The facing-bet strategies contain perhaps the most counter-intuitive results:

**Facing Bet -- Solver Results (selected):**

| Texture | premium | nut | strong | good | medium | draw | weak_made | weak_draw | air |
|---------|---------|-----|--------|------|--------|------|-----------|-----------|-----|
| **monotone** | raise 100% | call 100% | raise 69% | call 99% | call 100% | call 100% | call 100% | fold 100% | -- |
| **wet** | -- | raise 97% | raise 98% | raise 82% | call 66% / raise 33% | call 100% | call 100% | call 67% | fold 100% |
| **high_dry** | raise 100% | raise 79% | raise 87% | call 99% | call 100% | call 100% | call 100% | fold 67% | fold 100% |
| **low_dry** | raise 96% | raise 100% | raise 86% | call 99% | call 100% | call 99% | call 100% | fold 66% | fold 76% |

**Key observations:**

1. **Premiums and nuts always raise.** This is expected -- maximum value extraction.

2. **Strong hands raise aggressively.** This is a major departure from the hand-tuned heuristics, which had strong hands mostly calling (75-85% call). The solver found that strong hands should raise 69-98% of the time depending on texture. This makes sense in a polarized environment: if the bettor either has the nuts or air, raising with strong hands punishes the bluffs while building the pot against the value range.

3. **Good through draw hands almost always call.** The solver has these hands calling at 95-100% frequency. The heuristics were more fold-heavy (folding 10-30% with good hands, 25-55% with medium hands). The solver says: keep calling.

4. **Weak_made hands call far more than expected.** On most textures, weak_made hands call 99-100% of the time. The heuristic had them folding 45-70% of the time. The solver is exploiting the polarized betting ranges -- if the opponent bets only nuts or air, even bottom pair is a profitable call.

5. **Weak_draw is the key folding threshold.** The solver consistently folds weak_draw at 66-100% frequency. This is the break point in the calling range -- gutshots and backdoor draws do not have enough equity to profitably continue.

6. **Air folds or calls depending on texture.** On `low_dry`, air calls 23.6% of the time -- likely a bluff-catching frequency designed to keep the opponent honest. On `high_dry`, air folds 100%.

### 6.6 The Averaging Approach for Facing-Bet Strategies

The solver produces separate facing-bet strategies for different bet sizes being faced (facing bet_s vs bet_m vs bet_l) and for different positions (OOP facing IP's bet after checking vs IP facing OOP's lead). The final output **averages** these:

```python
# Average all facing-bet strategies per bucket, then normalize
for bucket in BUCKETS:
    strats = fb_collected.get(bucket, [])
    merged = defaultdict(float)
    for s in strats:
        for a, p in s.items():
            merged[a] += p
    n = len(strats)
    averaged = {a: round(v / n, 3) for a, v in merged.items()}
```

This averaging is a deliberate simplification. In a full solver, the response to a 33% pot bet would differ from the response to a 100% pot bet (you need better pot odds to call a larger bet). By averaging, we get a single robust "facing bet" strategy that works as a reasonable default across bet sizes.

### 6.7 Comparison: Solver vs Hand-Tuned Heuristics

The comparison phase in `generate.py` flags any strategy that differs by more than 15% (measured as half the total absolute difference in action probabilities). Based on the output data, the biggest shifts are:

| Context | Hand-Tuned | Solver | Nature of Change |
|---------|-----------|--------|-----------------|
| OOP/high_dry/good | check 35%, bet_s 25%, bet_m 40% | check 99%, bet_s 1% | **Massively more passive** |
| OOP/monotone/draw | check 45%, bet_s 25%, bet_m 30% | check 100% | **Eliminated semi-bluffs** |
| OOP/low_dry/air | check 60%, bet_s 10%, bet_l 30% | check 100% | **Eliminated bluffs** |
| IP/high_dry/strong | check 15%, bet_m 60%, bet_l 25% | check 99% | **From heavy betting to checking** |
| FACING/wet/strong | call 75%, raise 25% | raise 98% | **From calling to raising** |
| FACING/high_dry/weak_made | fold 55%, call 45% | call 100% | **Stopped folding** |
| FACING/low_dry/medium | call 60%, fold 40% | call 100% | **Stopped folding** |

The overarching theme: **the solver plays tighter (fewer bets) but wider (fewer folds)**. It has discovered that in the abstracted game:
- Betting with medium hands out of position is a losing proposition
- Folding to a bet with any reasonable made hand is exploitable
- Raising with strong hands when facing a bet is far more profitable than flat calling

### 6.8 Theoretical Implications

These solver outputs illuminate several deep principles of GTO play:

1. **Polarization principle**: GTO strategies naturally polarize -- betting ranges consist of very strong hands (for value) and very weak hands (as bluffs), while medium-strength hands prefer to check/call. This arises automatically from the regret minimization process.

2. **Position amplifies passivity**: OOP's checking frequency is much higher than IP's because OOP cannot close the action. Every bet by OOP opens the door to a raise, creating negative expected value for marginal hands.

3. **Board texture gates action**: On monotone and dry boards, the lack of draws means fewer hands can profitably bet. The solver correctly identifies that these static boards favor pot control.

4. **Calling is underrated**: Human players tend to fold too much with marginal hands. The solver demonstrates that against polarized betting ranges, even bottom pair is a profitable call. The key threshold is whether your hand beats the bluff portion of the opponent's range.

5. **Small bet sizes dominate**: The solver overwhelmingly prefers 33% pot bets over 66% or 100% pot bets for value hands (except absolute premiums). Small bets keep the opponent's calling range wide and extract more total value across the distribution of opponent hands.

---

## Appendix A: Mathematical Notation Reference

| Symbol | Meaning |
|--------|---------|
| $I$ | Information set |
| $A(I)$ | Available actions at information set $I$ |
| $\sigma_I(a)$ | Probability of choosing action $a$ at info set $I$ |
| $v_i(I)$ | Counterfactual value for player $i$ at info set $I$ |
| $v_i(I, a)$ | Counterfactual value of action $a$ at $I$ |
| $r^t(I, a)$ | Instantaneous counterfactual regret at iteration $t$ |
| $R^T(I, a)$ | Cumulative regret after $T$ iterations |
| $R^{T,+}(I, a)$ | $\max(R^T(I, a), 0)$ -- positive part of cumulative regret |
| $\pi_i^\sigma(h)$ | Player $i$'s reach probability to node $h$ under $\sigma$ |
| $\pi_{-i}^\sigma(h)$ | All players except $i$'s reach probability to $h$ |
| $E_{ij}^{(t)}$ | Equity of bucket $i$ vs bucket $j$ on texture $t$ |
| $p_b^{(t)}$ | Probability of bucket $b$ given texture $t$ |
| $\varepsilon$ | Exploitability (distance from Nash equilibrium) |

## Appendix B: References

1. **Zinkevich, M., Johanson, M., Bowling, M., & Piccione, C.** (2007). "Regret Minimization in Games with Incomplete Information." *Advances in Neural Information Processing Systems (NeurIPS)*.

2. **Tammelin, O.** (2014). "Solving Large Imperfect Information Games Using CFR+." *arXiv:1407.5042*.

3. **Neller, T. W., & Lanctot, M.** (2013). "An Introduction to Counterfactual Regret Minimization." *Gettysburg College Technical Report*.

4. **Brown, N., & Sandholm, T.** (2019). "Superhuman AI for multiplayer poker." *Science, 365*(6456), 885-890.
