"""Acquire raw EPA data and cache it locally so APIs are hit only once.

Outputs (committed, offline-rebuildable):
    data/raw/csv_team_years.parquet   trimmed <=2023 history from the pinned CSV
    data/raw/api_2024.json            flattened mirror-API pulls (2024 is taken
    data/raw/api_2025.json            from the API because the pinned CSV's 2024
    data/raw/api_2026.json            EPAs were still mid-season / incomplete)

The full ~21 MB source CSV is streamed to data/raw/_downloads/ (gitignored).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import pandas as pd
import requests

from . import config

CSV_COLUMNS = ["year", "team", "offseason", "name", "country", "state", "district", "unitless_epa"]
USER_AGENT = "epa-gradients-build/0.1 (+https://github.com/Ekcrbe/epa-gradients)"


# --- historical CSV (<= 2024) ---------------------------------------------
def download_csv(settings: dict, refresh: bool = False) -> Path:
    """Download the pinned v3/team_years.csv (full) into the gitignored cache."""
    commit = settings["data"]["csv_commit"]
    url = settings["data"]["csv_url"].format(commit=commit)
    dest = config.RAW_DOWNLOADS / f"team_years_v3_{commit[:8]}.csv"
    if dest.exists() and not refresh:
        print(f"  [csv] using cached download {dest.name} ({dest.stat().st_size/1e6:.1f} MB)")
        return dest
    print(f"  [csv] downloading {url}")
    with requests.get(url, stream=True, timeout=120, headers={"User-Agent": USER_AGENT}) as r:
        r.raise_for_status()
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
    print(f"  [csv] saved {dest.name} ({dest.stat().st_size/1e6:.1f} MB)")
    return dest


def trim_csv(settings: dict, full_csv: Path) -> Path:
    """Trim the full CSV to needed columns/years/teams and cache as parquet.

    Offseason/demo teams (offseason='t', letter-suffixed team ids like '254B')
    are dropped here since they are not part of the competitive universe.
    """
    lo = settings["data"]["csv_min_year"]
    hi = settings["data"]["csv_max_year"]
    df = pd.read_csv(
        full_csv,
        usecols=CSV_COLUMNS,
        na_values=["NULL", ""],
        low_memory=False,
        dtype={
            "offseason": "string", "team": "string", "name": "string",
            "country": "string", "state": "string", "district": "string",
        },
    )
    df = df[(df["year"] >= lo) & (df["year"] <= hi)]
    df = df[df["offseason"] == "f"].copy()
    df["team"] = pd.to_numeric(df["team"], errors="coerce").astype("Int64")
    df = df[df["team"].notna()].copy()
    df["team"] = df["team"].astype("int64")
    df["unitless_epa"] = pd.to_numeric(df["unitless_epa"], errors="coerce")
    df = df.drop(columns=["offseason"])
    out = config.RAW / "csv_team_years.parquet"
    df.to_parquet(out, index=False)
    print(f"  [csv] trimmed to {lo}-{hi}, official teams: {len(df):,} rows -> {out.name}")
    return out


# --- live API (2025, 2026) -------------------------------------------------
def _flatten(rec: dict) -> dict:
    epa = rec.get("epa") or {}
    return {
        "year": rec.get("year"),
        "team": rec.get("team"),
        "name": rec.get("name"),
        "country": rec.get("country"),
        "state": rec.get("state"),
        "district": rec.get("district"),
        "unitless_epa": epa.get("unitless"),
    }


def fetch_api_year(settings: dict, year: int, refresh: bool = False) -> Path:
    """Paginate the mirror team_years endpoint for one year; cache flattened."""
    out = config.RAW / f"api_{year}.json"
    if out.exists() and not refresh:
        n = len(json.loads(out.read_text()))
        print(f"  [api] using cached {out.name} ({n:,} rows)")
        return out

    base = settings["data"]["api_base"].rstrip("/")
    page = settings["data"]["api_page_size"]
    records: list[dict] = []
    offset = 0
    sess = requests.Session()
    sess.headers.update({"User-Agent": USER_AGENT})
    while True:
        url = f"{base}/team_years"
        params = {"year": year, "limit": page, "offset": offset}
        batch = None
        for attempt in range(1, 5):
            try:
                r = sess.get(url, params=params, timeout=90)
                r.raise_for_status()
                batch = r.json()
                break
            except requests.RequestException as exc:
                if attempt == 4:
                    raise
                wait = 2 ** attempt
                print(f"  [api] {year} offset {offset}: {type(exc).__name__}, retry {attempt}/3 in {wait}s")
                time.sleep(wait)
        if not batch:
            break
        records.extend(_flatten(rec) for rec in batch)
        offset += len(batch)
        if len(batch) < page:
            break
        time.sleep(0.2)  # be polite to the mirror
    out.write_text(json.dumps(records))
    print(f"  [api] {year}: fetched {len(records):,} rows -> {out.name}")
    return out


def run(settings: dict, refresh: bool = False) -> dict[str, Path]:
    config.ensure_dirs()
    print("[acquire]")
    full = download_csv(settings, refresh=refresh)
    csv_parquet = trim_csv(settings, full)
    api_paths = {y: fetch_api_year(settings, y, refresh=refresh) for y in settings["data"]["api_years"]}
    return {"csv": csv_parquet, **{f"api_{y}": p for y, p in api_paths.items()}}


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Acquire and cache raw EPA data.")
    ap.add_argument("--refresh", action="store_true", help="re-download / re-fetch, ignoring caches")
    args = ap.parse_args()
    run(config.load_settings(), refresh=args.refresh)
