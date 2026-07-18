"""One-off: geo-assign the defunct pre-2012 PA teams to fma vs st_pa.

Statbotics is state-level only, so we pull city/ZIP from The Blue Alliance and
calibrate the FMA <-> non-district boundary empirically from present-day PA
teams (whose real district membership Statbotics already records). Each defunct
team is then assigned by the ZIP-3 cluster it falls in.

Outputs data/review/pa_geo_proposed.csv for human approval. It does NOT write
config/pa_overrides.csv (that happens only after sign-off).
"""
from __future__ import annotations

import json
import time

import pandas as pd
import requests

from pipeline import config

TBA = "https://www.thebluealliance.com/api/v3"
CACHE = config.INTERIM / "tba_pa.json"


def _key() -> str:
    p = config.ROOT / "config" / "tba_key.txt"
    return p.read_text(encoding="utf-8").strip()


def fetch_teams(team_nums: list[int]) -> dict[str, dict]:
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    headers = {"X-TBA-Auth-Key": _key()}
    sess = requests.Session()
    for t in team_nums:
        k = str(t)
        if k in cache:
            continue
        r = sess.get(f"{TBA}/team/frc{t}", headers=headers, timeout=30)
        r.raise_for_status()
        d = r.json()
        cache[k] = {"city": d.get("city"), "postal_code": d.get("postal_code"),
                    "state_prov": d.get("state_prov"), "nickname": d.get("nickname")}
        time.sleep(0.05)
    CACHE.write_text(json.dumps(cache))
    return cache


def zip3(pc) -> str | None:
    if not pc:
        return None
    digits = "".join(ch for ch in str(pc) if ch.isdigit())
    return digits[:3] if len(digits) >= 3 else None


def main() -> None:
    tr = pd.read_parquet(config.INTERIM / "team_region.parquet")
    pa = tr[(tr["state"] == "PA")].copy()
    present = pa[pa["base_region"].isin(["fma", "st_pa"])]
    defunct = pa[pa["base_region"].isna() & ~pa["is_sc"]]
    print(f"PA teams: {len(present)} present-day ({(present.base_region=='fma').sum()} fma / "
          f"{(present.base_region=='st_pa').sum()} st_pa), {len(defunct)} defunct to assign")

    tba = fetch_teams(sorted(pa["team"].tolist()))

    # Calibrate: ZIP-3 -> present-day fma/st_pa counts.
    cal: dict[str, dict[str, int]] = {}
    for _, r in present.iterrows():
        z = zip3(tba.get(str(r.team), {}).get("postal_code"))
        if not z:
            continue
        cal.setdefault(z, {"fma": 0, "st_pa": 0})[r.base_region] += 1
    print("\nZIP-3 calibration (present-day PA teams):")
    for z in sorted(cal):
        c = cal[z]
        lab = "fma" if c["fma"] >= c["st_pa"] else "st_pa"
        print(f"  {z}xx -> fma {c['fma']:2d} / st_pa {c['st_pa']:2d}  => {lab}")

    seen = {z: ("fma" if c["fma"] >= c["st_pa"] else "st_pa") for z, c in cal.items()}

    def classify(z: str | None) -> tuple[str, str]:
        if z is None:
            return "st_pa", "no ZIP -> default st_pa"
        if z in seen:
            c = cal[z]
            return seen[z], f"ZIP {z}xx cluster (fma {c['fma']}/st_pa {c['st_pa']})"
        # Fallback: nearest calibrated ZIP-3 numerically.
        nearest = min(seen, key=lambda s: abs(int(s) - int(z)))
        return seen[nearest], f"ZIP {z}xx -> nearest calibrated {nearest}xx ({seen[nearest]})"

    rows = []
    for _, r in defunct.sort_values("team").iterrows():
        info = tba.get(str(r.team), {})
        z = zip3(info.get("postal_code"))
        region, basis = classify(z)
        rows.append({"team": r.team, "name": r["name"], "city": info.get("city"),
                     "postal": info.get("postal_code"), "region": region, "basis": basis})
    out = pd.DataFrame(rows)
    dest = config.REVIEW / "pa_geo_proposed.csv"
    out.to_csv(dest, index=False)
    print(f"\nProposed assignment ({(out.region=='fma').sum()} fma / {(out.region=='st_pa').sum()} st_pa) -> {dest.name}:")
    print(out[["team", "name", "city", "postal", "region", "basis"]].to_string(index=False))


if __name__ == "__main__":
    main()
