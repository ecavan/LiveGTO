# Calibration against real hands

Real hand histories (the [PHH dataset](https://github.com/uoftcprg/phh-dataset), MIT) are used to
check and calibrate LiveGTO's bots, charts and solver. The findings are in
[docs/CALIBRATION.md](../docs/CALIBRATION.md). This folder holds the code; the raw hands are not
in the repo.

## Pipeline

```sh
# 0. hands: the 25NL–100NL HandHQ folders and the Pluribus logs from the PHH dataset
#    (sparse git checkout of data/handhq/*_{25,50,100}NLH_OBFU and data/pluribus; ~5 GB of text)

# 1. read them (Rust, verified against pokerkit: analysis/crosscheck.py)
cd solver && cargo build --release -p ps-phh && cd ..
solver/target/release/ps-phh <handhq folders…> --out out/hh
solver/target/release/ps-phh <pluribus folder> --out out/plur --decisions

# 2. who the real players are, and what each type does
python3 -I analysis/population.py out/hh/players.tsv --json out/pop.json --types out/typed.parquet
python3 -I analysis/targets.py out/pop.json out/plur/players.tsv > out/targets.json
python3 -I -c "import sys,json; sys.path.insert(0,'analysis'); import showdown; json.dump(showdown.targets('out/hh/showdowns.tsv','out/typed.parquet', VENUES), open('out/sd_targets.json','w'))"

# 3. fit: preflop numbers, the postflop baseline (Pluribus), the villain profiles
python3 -I analysis/fit_preflop.py init out/targets.json > out/pre0.json
python3 -I analysis/fit_preflop_loop.py out/targets.json out/pre0.json out/fitpre 3 60000   # → src/engine/ring/preflop.json
python3 -I analysis/baseline.py out/plur/decisions.tsv Pluribus --json out/base_plur.json
python3 -I analysis/baseline.py out/plur/decisions.tsv all --json out/base_all.json
python3 -I analysis/fit_base.py out/base_plur.json out/base_all.json > out/base.json        # → BASE_* in src/engine/hu/bots.js
python3 -I analysis/fit_postflop_loop.py out/targets.json out/sd_targets.json out/fitpost 6 40000
python3 -I analysis/profiles_fit.py write out/fitpost/knobs.json solver/profiles && node scripts/export-profiles.mjs

# 4. checks
npx vite-node analysis/dump-charts.mjs > out/charts.json
python3 -I analysis/pluribus.py out/plur/decisions.tsv out/charts.json     # preflop charts vs Pluribus
python3 -I analysis/solver_check.py out/plur/decisions.tsv public/library   # solver vs Pluribus
```

## Files

| File | What it does |
|---|---|
| `../solver/crates/ps-phh` | Reads PHH files; per-player HUD counters, showdown hands with their line and hand class, every decision |
| `crosscheck.py` | Replays the same hands in pokerkit and compares pot and amount to call at every decision |
| `hud.py` | HUD ratios from the counters (VPIP, PFR, 3-bet, c-bet, fold to bet, WTSD, …) |
| `population.py` | Types every player with enough hands (nit, reg, station, whale, maniac, …) and pools stats by type |
| `showdown.py` | What each type actually had at showdown, by how the river went |
| `targets.py` | Which real players each archetype should play like |
| `sim-phh.mjs` | Bot tables written as PHH, so the bots go through the same stats code |
| `fit_preflop.py`, `fit_preflop_loop.py` | Fit the ring archetypes' preflop numbers |
| `baseline.py`, `fit_base.py` | Pluribus's play by hand class and role → the bots' postflop baseline |
| `profiles_fit.py`, `fit_postflop_loop.py` | Fit the villain profiles' calibration rules |
| `pluribus.py`, `solver_check.py`, `dump-charts.mjs` | The checks against Pluribus |
