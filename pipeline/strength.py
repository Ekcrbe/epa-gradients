"""Per-team strength for each snapshot season via a linear-recency WMA.

A team's strength entering snapshot season S is the weighted moving average of
its unitless EPA over the calendar window S-4..S-1, with the canceled 2020/2021
seasons dropped and the remaining weights (4:3:2:1 by calendar offset)
renormalized. A team needs at least ``min_window_seasons`` valid in-window
seasons to be scored for S.

Output (gitignored, regenerable):
    data/interim/team_strength.parquet
        columns: snapshot_year, team, strength, n_seasons_used, region
"""
from __future__ import annotations

import pandas as pd

from . import config, regions


def compute(df: pd.DataFrame, team_region: pd.DataFrame, settings: dict) -> pd.DataFrame:
    weights = settings["model"]["wma_weights"]
    min_seasons = settings["model"]["min_window_seasons"]
    n_off = len(weights)

    parts: list[pd.DataFrame] = []
    for S in config.snapshot_years(settings):
        window = config.valid_seasons_before(S, settings, count=n_off)
        if not window:
            continue
        # Base weight by calendar offset k = S - year (k=1 -> weights[0]).
        wmap = {S - k: weights[k - 1] for k in range(1, n_off + 1)}
        wmap = {y: wmap[y] for y in window}

        sub = df.loc[df["year"].isin(window), ["team", "year", "unitless_epa"]].copy()
        sub["w"] = sub["year"].map(wmap).astype("float64")
        sub["wx"] = sub["w"] * sub["unitless_epa"]
        agg = sub.groupby("team", sort=False).agg(
            num=("wx", "sum"), den=("w", "sum"), n_seasons_used=("year", "nunique")
        )
        agg = agg[agg["n_seasons_used"] >= min_seasons]
        agg["strength"] = agg["num"] / agg["den"]
        agg["snapshot_year"] = S

        reg = regions.region_for_year(team_region, S, settings)
        agg["region"] = agg.index.map(reg).astype("object")
        parts.append(agg.reset_index()[["snapshot_year", "team", "strength", "n_seasons_used", "region"]])

    out = pd.concat(parts, ignore_index=True)
    out["region"] = out["region"].astype("string")
    return out


def load(settings: dict | None = None) -> pd.DataFrame:
    return pd.read_parquet(config.INTERIM / "team_strength.parquet")


def run(settings: dict) -> pd.DataFrame:
    from . import normalize
    print("[strength]")
    df = normalize.load(settings)
    team_region = pd.read_parquet(config.INTERIM / "team_region.parquet")
    out = compute(df, team_region, settings)
    out.to_parquet(config.INTERIM / "team_strength.parquet", index=False)
    mapped = out["region"].notna()
    print(
        f"  strength: {len(out):,} team-snapshots over {out.snapshot_year.nunique()} seasons; "
        f"{mapped.sum():,} region-assigned, {(~mapped).sum():,} baseline-only (unmapped/pending)"
    )
    return out


if __name__ == "__main__":
    run(config.load_settings())
