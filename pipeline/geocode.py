"""US location centroid lookups, offline after the first fetch.

The Blue Alliance's own ``lat``/``lng`` team fields are no longer populated
(TBA appears to have dropped its geocoding step -- every team we checked
returns ``null`` for both, even ones with a full city/state/postal_code on
file). ``tba.py`` falls back to two tiers here, in order:

  1. ``zip_centroid``      -- resolve the team's postal_code (most teams).
  2. ``ca_city_centroid``  -- resolve the team's city name against California
                              Census places, for teams TBA has no postal_code
                              for at all (a city is still reliably present).

Source: US Census Bureau 2023 Gazetteer ZCTA / Places files (public domain).

Output (committed, offline-rebuildable):
    data/raw/zcta_centroids.csv       zip,lat,lng for every US ZCTA
    data/raw/ca_place_centroids.csv   name,lat,lng for every California place
"""
from __future__ import annotations

import csv
import io
import re
import zipfile

import requests

from . import config

GAZETTEER_ZCTA_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "2023_Gazetteer/2023_Gaz_zcta_national.zip"
)
GAZETTEER_PLACE_URL = (
    "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/"
    "2023_Gazetteer/2023_Gaz_place_national.zip"
)
CACHE_PATH = config.RAW / "zcta_centroids.csv"
CA_PLACE_CACHE_PATH = config.RAW / "ca_place_centroids.csv"
CA_GEOID_PREFIX = "06"  # California state FIPS code

# A handful of well-known California locations that don't have their own
# Census "place" entry: unincorporated LA neighborhoods (mapped to the city
# they're part of, close enough for a north/south California split) and one
# common short name for an oddly-named incorporated city.
CITY_ALIASES = {
    "winnetka": "los angeles",
    "north hollywood": "los angeles",
    "carmel": "carmel-by-the-sea",
}

_centroids: dict[str, tuple[float, float]] | None = None
_ca_places: dict[str, list[tuple[str, float, float]]] | None = None


def _download_gazetteer(url: str) -> list[dict]:
    print(f"  [geocode] downloading {url} ...")
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    name = next(n for n in zf.namelist() if n.lower().endswith(".txt"))
    text = zf.read(name).decode("latin-1")
    return [{k.strip(): v.strip() for k, v in row.items()}
            for row in csv.DictReader(io.StringIO(text), delimiter="\t")]


def _download() -> dict[str, tuple[float, float]]:
    return {row["GEOID"]: (float(row["INTPTLAT"]), float(row["INTPTLONG"]))
            for row in _download_gazetteer(GAZETTEER_ZCTA_URL)}


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


def _norm_place(name: str) -> str:
    # Census place names carry a legal/statistical suffix ("Palo Alto city",
    # "Mountain View CDP") that TBA's plain city names don't.
    return re.sub(r"\s+(city|town|CDP|village|municipality)\b", "", name, flags=re.I).strip().lower()


def _download_ca_places() -> dict[str, list[tuple[str, float, float]]]:
    out: dict[str, list[tuple[str, float, float]]] = {}
    for row in _download_gazetteer(GAZETTEER_PLACE_URL):
        if not row["GEOID"].startswith(CA_GEOID_PREFIX):
            continue
        out.setdefault(_norm_place(row["NAME"]), []).append(
            (row["NAME"], float(row["INTPTLAT"]), float(row["INTPTLONG"]))
        )
    return out


def _write_ca_place_cache(places: dict[str, list[tuple[str, float, float]]]) -> None:
    config.RAW.mkdir(parents=True, exist_ok=True)
    with CA_PLACE_CACHE_PATH.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["name", "lat", "lng"])
        for key in sorted(places):
            for name, lat, lng in places[key]:
                w.writerow([name, lat, lng])


def _read_ca_place_cache() -> dict[str, list[tuple[str, float, float]]]:
    out: dict[str, list[tuple[str, float, float]]] = {}
    with CA_PLACE_CACHE_PATH.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            out.setdefault(_norm_place(row["name"]), []).append(
                (row["name"], float(row["lat"]), float(row["lng"]))
            )
    return out


def _load_ca_places() -> dict[str, list[tuple[str, float, float]]]:
    global _ca_places
    if _ca_places is None:
        if not CA_PLACE_CACHE_PATH.exists():
            places = _download_ca_places()
            _write_ca_place_cache(places)
            _ca_places = places
        else:
            _ca_places = _read_ca_place_cache()
    return _ca_places


def ca_city_centroid(city: str | None) -> tuple[float, float] | None:
    """(lat, lng) for a California city name, or None if unknown/ambiguous.

    Falls back through CITY_ALIASES for a few well-known unincorporated LA
    neighborhoods and common short names that have no Census place entry of
    their own. When a name matches more than one place (e.g. a same-named
    CDP and incorporated city), prefers the incorporated "city" -- if that
    doesn't narrow it to exactly one match, gives up rather than guess.
    """
    if not city:
        return None
    key = _norm_place(city)
    key = CITY_ALIASES.get(key, key)
    matches = _load_ca_places().get(key, [])
    if len(matches) == 1:
        return matches[0][1], matches[0][2]
    if len(matches) > 1:
        incorporated = [m for m in matches if m[0].lower().endswith("city")]
        if len(incorporated) == 1:
            return incorporated[0][1], incorporated[0][2]
    return None
