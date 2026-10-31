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
files are skipped, and the runouts are sampled from a stream seeded per flop (family `seed` and
the flop), so a resumed build writes the same turns and rivers as an uninterrupted one. Edit
`library/families.toml` to add flops or families, then rebuild and commit `public/library/`.
(The library shipped in Oct 2026 was built with the older per-family stream across several
resumes, so its runouts differ from what a fresh build samples; the records themselves are exact.)

**Flop decisions.** Each flop also gets its own four decisions (checked to, facing a 33% and a 75%
c-bet, c-bet check-raised) against every profile, on a slim three-street tree (`flop_spot` in
`library.rs`): one GTO solve, then one node-locked solve per profile and decision, 8–25 minutes per
flop. `ps library … --flop-only` adds them to the files of an existing library and skips the files
that have them, so it resumes too. Afterwards run `node scripts/prune-library.mjs` (drops the
check-raise records where GTO never raises the c-bet, and the Level 2 puzzles the exploit guard
rejects: see `scripts/lib/exploit-guard.mjs`) and `ps library … --index-only`.

**Memory.** The flop tree in `library.rs` is deliberately coarse (about 1 GB compressed). A richer tree
(two c-bet sizes, turn and river raises) needs 2–4 GB. `PS_MEM_GB` (default 1.6) is the most a
single solve may allocate per tree copy; a spot that would need more is skipped with a message
instead of taking the machine down.
