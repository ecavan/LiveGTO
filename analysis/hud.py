"""HUD stats from ps-phh counters (players.tsv), with Polars.

`stats(df, by)` sums the counters over each group and returns the usual ratios (in %), and
the number of opportunities behind each one, so small samples are easy to spot.
"""
import polars as pl

# name: (numerator, denominator)
STATS = {
    'VPIP': ('vpip', 'vpip_opp'),
    'PFR': ('pfr', 'vpip_opp'),
    'Limp': ('limp', 'limp_opp'),
    'OpenLimp': ('olimp', 'olimp_opp'),
    'RFI_UTG': ('rfi_lj', 'rfi_opp_lj'),  # 6-max UTG is 3 seats before the button
    'RFI_HJ': ('rfi_hj', 'rfi_opp_hj'),
    'RFI_CO': ('rfi_co', 'rfi_opp_co'),
    'RFI_BTN': ('rfi_btn', 'rfi_opp_btn'),
    'RFI_SB': ('rfi_sb', 'rfi_opp_sb'),
    'OLimp_UTG': ('olimp_lj', 'rfi_opp_lj'),
    'OLimp_HJ': ('olimp_hj', 'rfi_opp_hj'),
    'OLimp_CO': ('olimp_co', 'rfi_opp_co'),
    'OLimp_BTN': ('olimp_btn', 'rfi_opp_btn'),
    'OLimp_SB': ('olimp_sb', 'rfi_opp_sb'),
    'IsoBehind': ('behind_iso', 'behind_opp'),
    'LimpBehind': ('behind_limp', 'behind_opp'),
    '3Bet': ('vo_raise', 'vo_opp'),
    'ColdCall': ('vo_call', 'vo_opp'),
    'FoldVsOpen': ('vo_fold', 'vo_opp'),
    'BB3Bet': ('vo_bb_raise', 'vo_bb_opp'),
    'BBFold': ('vo_bb_fold', 'vo_bb_opp'),
    'LimpFoldVsRaise': ('vi_fold', 'vi_opp'),
    'LimpCallVsRaise': ('vi_call', 'vi_opp'),
    'LimpReraise': ('vi_raise', 'vi_opp'),
    'IsoVsLimp(BB)': ('bb_limped_raise', 'bb_limped_opp'),
    'FoldTo3Bet': ('v3_fold', 'v3_opp'),
    'Call3Bet': ('v3_call', 'v3_opp'),
    '4Bet': ('v3_raise', 'v3_opp'),
    'CBetFlop': ('cb_f', 'cb_opp_f'),
    'CBetFlopHU': ('cb_hu_f', 'cb_hu_opp_f'),
    'CBetTurn': ('cb_t', 'cb_opp_t'),
    'CBetRiver': ('cb_r', 'cb_opp_r'),
    'FoldToCBetFlop': ('vcb_fold_f', 'vcb_opp_f'),
    'FoldToCBetTurn': ('vcb_fold_t', 'vcb_opp_t'),
    'FoldToCBetRiver': ('vcb_fold_r', 'vcb_opp_r'),
    'RaiseCBetFlop': ('vcb_raise_f', 'vcb_opp_f'),
    'DonkFlop': ('donk_f', 'donk_opp_f'),
    'DonkTurn': ('donk_t', 'donk_opp_t'),
    'CheckRaiseFlop': ('xr_f', 'xr_opp_f'),
    'CheckRaiseTurn': ('xr_t', 'xr_opp_t'),
    'ProbeTurn': ('xd_bet_t', 'xd_opp_t'),
    'ProbeRiver': ('xd_bet_r', 'xd_opp_r'),
    'FoldToBetFlop': ('fbet_fold_f', 'fbet_opp_f'),
    'FoldToBetTurn': ('fbet_fold_t', 'fbet_opp_t'),
    'FoldToBetRiver': ('fbet_fold_r', 'fbet_opp_r'),
    'WTSD': ('wtsd', 'saw_flop'),
    'W$SD': ('wsd', 'wsd_known'),
    'BetSmall': ('size_small', None),
    'BetOverpot': ('size_over', None),
}


def load(path):
    df = pl.read_csv(path, separator='\t', quote_char=None, infer_schema_length=0)
    num = [c for c in df.columns if c not in ('venue', 'player', 'table')]
    return df.with_columns([pl.col(c).cast(pl.Int64) for c in num])


def with_totals(df):
    """Adds per-street totals used by aggression stats."""
    s = ['f', 't', 'r']
    return df.with_columns(
        aggr=pl.sum_horizontal([pl.col(f'bet_{x}') + pl.col(f'raise_{x}') for x in s]),
        calls=pl.sum_horizontal([pl.col(f'call_{x}') for x in s]),
        folds=pl.sum_horizontal([pl.col(f'fold_{x}') for x in s]),
        checks=pl.sum_horizontal([pl.col(f'check_{x}') for x in s]),
        bets=pl.sum_horizontal([pl.col(f'bet_{x}') for x in s]),
    )


def stats(df, by):
    """Summed counters → ratios (%) per group in `by` (a column name or list)."""
    df = with_totals(df)
    num = [c for c in df.columns if c not in ('venue', 'player', 'table') and c not in ([by] if isinstance(by, str) else by)]
    g = df.group_by(by).agg([pl.col(c).sum() for c in num])
    exprs = []
    for name, (a, b) in STATS.items():
        den = pl.col(b) if b else pl.col('bets')
        exprs.append(pl.when(den > 0).then(100 * pl.col(a) / den).otherwise(None).round(1).alias(name))
    exprs += [
        pl.when(pl.col('calls') > 0).then(pl.col('aggr') / pl.col('calls')).otherwise(None).round(2).alias('AF'),
        pl.when((pl.col('aggr') + pl.col('calls') + pl.col('folds') + pl.col('checks')) > 0)
        .then(100 * pl.col('aggr') / (pl.col('aggr') + pl.col('calls') + pl.col('folds') + pl.col('checks'))).otherwise(None).round(1).alias('AFq'),
        pl.when(pl.col('bets') > 0).then(pl.col('size_sum_pct') / pl.col('bets')).otherwise(None).round(0).alias('AvgBetPct'),
        pl.col('hands'),
    ]
    return g.select([by] if isinstance(by, str) else by).hstack(g.select(exprs))


def per_player(df, min_hands=0):
    """Ratios per player row (no grouping), keeping the counters for weighting."""
    df = with_totals(df).filter(pl.col('vpip_opp') >= min_hands)
    out = {}
    for name, (a, b) in STATS.items():
        if b:
            out[name] = pl.when(pl.col(b) > 0).then(100 * pl.col(a) / pl.col(b)).otherwise(None)
    out['AF'] = pl.when(pl.col('calls') > 0).then(pl.col('aggr') / pl.col('calls')).otherwise(None)
    out['AFq'] = pl.when((pl.col('aggr') + pl.col('calls') + pl.col('folds') + pl.col('checks')) > 0).then(
        100 * pl.col('aggr') / (pl.col('aggr') + pl.col('calls') + pl.col('folds') + pl.col('checks'))).otherwise(None)
    return df.with_columns([v.alias(k) for k, v in out.items()])
