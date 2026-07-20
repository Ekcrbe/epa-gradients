"""Fetch team lat/lng from The Blue Alliance, used to split the California
district into northern and southern regions (see regions.py).

Output (committed, offline-rebuildable):
    data/raw/tba_ca_locations.json   {team_number: {lat, lng}} cache

Requires config/tba_key.txt (gitignored, never committed) holding the
X-TBA-Auth-Key. Only teams missing from the cache are fetched, so re-runs
after the first are network-free.
"""
from __future__ import annotations

import json
import time

import requests

from . import config

API_BASE = "https://www.thebluealliance.com/api/v3"
USER_AGENT = "epa-gradients-build/0.1 (+https://github.com/Ekcrbe/epa-gradients)"
KEY_PATH = config.ROOT / "config" / "tba_key.txt"
CACHE_PATH = config.RAW / "tba_ca_locations.json"


def _load_key() -> str:
    if not KEY_PATH.exists():
        raise FileNotFoundError(
            f"Missing {KEY_PATH}: create it with your TBA API key (X-TBA-Auth-Key "
            "header value). It is gitignored and must never be committed."
        )
    key = KEY_PATH.read_text(encoding="utf-8").strip()
    if not key:
        raise ValueError(f"{KEY_PATH} is empty.")
    return key


def _load_cache() -> dict[int, dict]:
    if CACHE_PATH.exists():
        raw = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        return {int(k): v for k, v in raw.items()}
    return {}


def _save_cache(cache: dict[int, dict]) -> None:
    config.RAW.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(
        json.dumps({str(k): cache[k] for k in sorted(cache)}, indent=1) + "\n", encoding="utf-8"
    )


def _fetch_one(sess: requests.Session, team: int) -> dict:
    url = f"{API_BASE}/team/frc{team}"
    for attempt in range(1, 4):
        try:
            r = sess.get(url, timeout=30)
            if r.status_code == 404:
                return {"lat": None, "lng": None}
            r.raise_for_status()
            rec = r.json()
            return {"lat": rec.get("lat"), "lng": rec.get("lng")}
        except requests.RequestException as exc:
            if attempt == 3:
                print(f"  [tba] team {team}: {type(exc).__name__}, giving up")
                return {"lat": None, "lng": None}
            time.sleep(2 ** attempt)
    return {"lat": None, "lng": None}  # pragma: no cover


def fetch_team_locations(team_numbers: list[int], refresh: bool = False) -> dict[int, dict]:
    """team_number -> {"lat": float|None, "lng": float|None}, cached to disk.

    Teams TBA has no coordinates for (or that 404) get lat/lng None; callers
    treat that as "location unknown" rather than retrying forever.
    """
    cache = {} if refresh else _load_cache()
    missing = sorted(set(team_numbers) - set(cache))
    if missing:
        key = _load_key()
        sess = requests.Session()
        sess.headers.update({"User-Agent": USER_AGENT, "X-TBA-Auth-Key": key})
        print(f"  [tba] fetching {len(missing)} team location(s)...")
        for i, team in enumerate(missing, 1):
            cache[team] = _fetch_one(sess, team)
            if i % 50 == 0:
                print(f"  [tba] {i}/{len(missing)}...")
            time.sleep(0.1)  # be polite to the API
        _save_cache(cache)
    return {t: cache[t] for t in team_numbers if t in cache}
