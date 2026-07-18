"""Consolidate cached CSV (<=2024) + API (2025-26) into one tidy long table.

Output (gitignored, regenerable):
    data/interim/team_years.parquet   one row per (team, year)
        columns: year, team, name, country, state, district, unitless_epa
"""
from __future__ import annotations

import json

import pandas as pd

from . import config

LONG_COLUMNS = ["year", "team", "name", "country", "state", "district", "unitless_epa"]


def _load_api(settings: dict) -> pd.DataFrame:
    frames = []
    for y in settings["data"]["api_years"]:
        path = config.RAW / f"api_{y}.json"
        frames.append(pd.DataFrame(json.load(open(path))))
    return pd.concat(frames, ignore_index=True)


def run(settings: dict) -> pd.DataFrame:
    print("[normalize]")
    csv = pd.read_parquet(config.RAW / "csv_team_years.parquet")
    api = _load_api(settings)

    df = pd.concat([csv[LONG_COLUMNS], api[LONG_COLUMNS]], ignore_index=True)

    # Type hygiene.
    df["year"] = df["year"].astype("int64")
    df["team"] = df["team"].astype("int64")
    df["unitless_epa"] = pd.to_numeric(df["unitless_epa"], errors="coerce")
    for col in ("name", "country", "state", "district"):
        df[col] = df[col].astype("string")
        # Treat empty strings as missing.
        df.loc[df[col].str.len() == 0, col] = pd.NA

    before = len(df)
    df = df.dropna(subset=["unitless_epa"])
    df = df.drop_duplicates(subset=["team", "year"], keep="last")
    df = df.sort_values(["team", "year"]).reset_index(drop=True)

    out = config.INTERIM / "team_years.parquet"
    df.to_parquet(out, index=False)
    print(
        f"  {before:,} source rows -> {len(df):,} clean rows "
        f"({df.year.min()}-{df.year.max()}, {df.team.nunique():,} teams) -> {out.name}"
    )
    return df


def load(settings: dict | None = None) -> pd.DataFrame:
    return pd.read_parquet(config.INTERIM / "team_years.parquet")


if __name__ == "__main__":
    run(config.load_settings())
