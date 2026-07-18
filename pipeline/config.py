"""Shared configuration and filesystem layout for the pipeline."""
from __future__ import annotations

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "settings.toml"

# Directory layout ---------------------------------------------------------
DATA = ROOT / "data"
RAW = DATA / "raw"                 # committed, offline-rebuildable caches
RAW_DOWNLOADS = RAW / "_downloads"  # gitignored full source downloads
INTERIM = DATA / "interim"         # gitignored regenerable intermediates
REVIEW = DATA / "review"           # committed human-review artifacts
DOCS = ROOT / "docs"
DOCS_DATA = DOCS / "data"


def load_settings(path: Path = CONFIG_PATH) -> dict:
    with open(path, "rb") as fh:
        return tomllib.load(fh)


def ensure_dirs() -> None:
    for d in (RAW, RAW_DOWNLOADS, INTERIM, REVIEW, DOCS_DATA):
        d.mkdir(parents=True, exist_ok=True)


def snapshot_years(settings: dict) -> list[int]:
    """Snapshot seasons we produce difficulty curves for (inclusive range)."""
    m = settings["model"]
    return list(range(m["snapshot_start"], m["snapshot_end"] + 1))


def valid_seasons_before(year: int, settings: dict, count: int | None = None) -> list[int]:
    """Calendar window S-4..S-1 with skipped (canceled) seasons removed.

    Returns the seasons in ascending order. ``count`` defaults to the number of
    WMA weights configured (4).
    """
    m = settings["model"]
    skip = set(m["skip_years"])
    if count is None:
        count = len(m["wma_weights"])
    window = [year - k for k in range(count, 0, -1)]  # e.g. [S-4, S-3, S-2, S-1]
    return [y for y in window if y not in skip]
