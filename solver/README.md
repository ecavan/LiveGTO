# solver/ — the engine behind LiveGTO

Rust workspace on [postflop-solver](https://github.com/b-inary/postflop-solver) (Discounted CFR with
node locking, AGPL-3.0). It answers the same question for every study spot:

> What does GTO do here, what's the best exploit of *this* villain, and what's the one action I
> should take with each hand?

See [../docs/DESIGN.md](../docs/DESIGN.md) for the method and [../docs/THEORY.md](../docs/THEORY.md) for
the conventions.

```sh
cargo test --release           # hand evaluator, profiles, game-theory invariants, textbook toy games
cargo run --release -p ps-cli -- spot spots/river_bluffcatch.toml --profile profiles/station.toml --hands
cargo run --release -p ps-cli -- library library/families.toml --out ../public/library
```

| Crate | What it does |
|---|---|
| `ps-core` | Cards, an exact 3–7 card evaluator, and live-player hand classes (monster … air) |
| `ps-solve` | `Spot` (TOML), `Profile` (villain leaks as edits to GTO), `analyze` (GTO vs node-locked exploit, one-action answers), `library` (the app's puzzle library) |
| `ps-cli` | The `ps` command |

**Library build time.** Each flop is one coarse flop solve, then turn and river analyses for 5
profiles. That takes a few minutes per flop on a laptop, and the build is resumable: finished flop
files are skipped. Edit `library/families.toml` to add flops or families, then rebuild and commit
`public/library/`.

**Memory.** The flop tree in `library.rs` is deliberately coarse (about 1 GB compressed). A richer tree
(two c-bet sizes, turn and river raises) needs 2–4 GB.
