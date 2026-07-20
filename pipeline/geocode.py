"""US ZIP (ZCTA) centroid lookup.

The Blue Alliance's own ``lat``/``lng`` team fields are no longer populated
(TBA appears to have dropped its geocoding step -- every team we checked
returns ``null`` for both, even ones with a full city/state/postal_code on
file). ``tba.py`` falls back to resolving a US team's ZIP code to a
lat/lng centroid via this module instead.

Source: US Census Bureau 2023 Gazetteer ZCTA file (public domain).

Output (committed, offline-rebuildable):
    data/raw/zcta_centroids.csv   zip,lat,lng for every US ZCTA
"""
from __future__ import annotations

import csv
import io
import zipfile

import requests

from . import config

GAZETTEER_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "2023_Gazetteer/2023_Gaz_zcta_national.zip"
)
CACHE_PATH = config.RAW / "zcta_centroids.csv"

_centroids: dict[str, tuple[float, float]] | None = None


def _download() -> dict[str, tuple[float, float]]:
    print(f"  [geocode] downloading {GAZETTEER_URL} ...")
    r = requests.get(GAZETTEER_URL, timeout=60)
    r.raise_for_status()
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    name = next(n for n in zf.namelist() if n.lower().endswith(".txt"))
    text = zf.read(name).decode("latin-1")
    out: dict[str, tuple[float, float]] = {}
    for row in csv.DictReader(io.StringIO(text), delimiter="\t"):
        row = {k.strip(): v.strip() for k, v in row.items()}
        out[row["GEOID"]] = (float(row["INTPTLAT"]), float(row["INTPTLONG"]))
    return out


def _write_cache(centroids: dict[str, tuple[float, float]]) -> None:
    config.RAW.mkdir(parents=True, exist_ok=True)
    with CACHE_PATH.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["zip", "lat", "lng"])
        for z in sorted(centroids):
            lat, lng = centroids[z]
            w.writerow([z, lat, lng])


def _read_cache() -> dict[str, tuple[float, float]]:
    out: dict[str, tuple[float, float]] = {}
    with CACHE_PATH.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            out[row["zip"]] = (float(row["lat"]), float(row["lng"]))
    return out


def _load() -> dict[str, tuple[float, float]]:
    global _centroids
    if _centroids is None:
        if not CACHE_PATH.exists():
            centroids = _download()
            _write_cache(centroids)
            _centroids = centroids
        else:
            _centroids = _read_cache()
    return _centroids


def zip_centroid(zip_code: str | None) -> tuple[float, float] | None:
    """(lat, lng) for a 5-digit US ZIP/ZCTA, or None if unknown/unmapped."""
    if not zip_code:
        return None
    z5 = str(zip_code).strip()[:5]
    if len(z5) != 5 or not z5.isdigit():
        return None
    return _load().get(z5)
