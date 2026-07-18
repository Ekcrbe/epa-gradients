"""Per-team strength for each postseason snapshot.

For postseason year Y, a region's team set is the teams that competed in Y (the
most recent season of the WMA window) — this represents the region's *current*
depth rather than counting long-defunct teams. Each such team gets two strength
values:

  * ``strength_wma``    — linear-recency weighted moving average (weights
                          4:3:2:1 over [Y-3, Y-2, Y-1, Y], canceled seasons
                          dropped and weights renormalized). Smooths a living
                          team's rating over its recent form.
  * ``strength_single`` — the team's unitless EPA in year Y alone (no smoothing).

Output (gitignored, regenerable):
    data/interim/team_strength.parquet
        columns: snapshot_year, team, strength_wma, strength_single,
                 n_seasons_used, region
"""
from __future__ import annotations

import pandas as pd

from . import config, regions


def compute(df: pd.DataFrame, team_region: pd.DataFrame, settings: dict) -> pd.DataFrame:
    weights = settings["model"]["wma_weights"]
    n_off = len(weights)

    parts: list[pd.DataFrame] = []
    for Y in config.snapshot_years(settings):
        window = config.wma_window(Y, settings, count=n_off)
        if Y not in window:  # Y is never a skipped year, but guard anyway
            continue
        # Weight by recency offset from the anchor year Y (Y -> weights[0]).
        wmap = {Y - off: weights[off] for off in range(n_off)}
        wmap = {y: wmap[y] for y in window}

        sub = df.loc[df["year"].isin(window), ["team", "year", "unitless_epa"]].copy()
        sub["w"] = sub["year"].map(wmap).astype("float64")
        sub["wx"] = sub["w"] * sub["unitless_epa"]
        agg = sub.groupby("team", sort=False).agg(
            num=("wx", "sum"), den=("w", "sum"), n_seasons_used=("year", "nunique")
        )
        agg["strength_wma"] = agg["num"] / agg["den"]

        # Restrict to teams that competed in the anchor year Y, and attach their
        # single-year EPA. The inner join drops teams absent from year Y.
        anchor = (
            df.loc[df["year"] == Y, ["team", "unitless_epa"]]
            .rename(columns={"unitless_epa": "strength_single"})
            .set_index("team")
        )
        agg = agg.join(anchor, how="inner")
        agg["snapshot_year"] = Y

        reg = regions.region_for_year(team_region, Y, settings)
        agg["region"] = agg.index.map(reg).astype("object")
        parts.append(agg.reset_index()[
            ["snapshot_year", "team", "strength_wma", "strength_single", "n_seasons_used", "region"]
        ])

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
        f"  strength: {len(out):,} team-snapshots over {out.snapshot_year.nunique()} postseasons "
        f"({out.snapshot_year.min()}-{out.snapshot_year.max()}); "
        f"{mapped.sum():,} region-assigned, {(~mapped).sum():,} baseline-only"
    )
    return out


if __name__ == "__main__":
    run(config.load_settings())
