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
    """Postseason years we produce difficulty curves for (canceled years excluded)."""
    m = settings["model"]
    skip = set(m["skip_years"])
    return [y for y in range(m["snapshot_start"], m["snapshot_end"] + 1) if y not in skip]


def wma_window(year: int, settings: dict, count: int | None = None) -> list[int]:
    """WMA window for postseason ``year``: [Y-3, Y-2, Y-1, Y] minus canceled seasons.

    Returns seasons ascending; the last (``year`` itself, the anchor / most recent
    season) carries the largest recency weight. ``count`` defaults to the number
    of configured WMA weights (4).
    """
    m = settings["model"]
    skip = set(m["skip_years"])
    if count is None:
        count = len(m["wma_weights"])
    window = [year - off for off in range(count - 1, -1, -1)]  # [Y-3, ..., Y-1, Y]
    return [y for y in window if y not in skip]
