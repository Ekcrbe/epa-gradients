"""Serialize computed metrics into static JSON artifacts under docs/data/.

Artifacts:
    manifest.json        grids, scopes, region index, per-scope global baselines
    summary.json         compact per region-scope (n, scalars, coarse D) for the
                         heatmap / small-multiples / sorting
    regions/<id>.json    full detail (fine D, bootstrap band, survival, crossings)
                         for the hero view, lazy-loaded per region
"""
from __future__ import annotations

import json
import math
import shutil
from datetime import datetime, timezone

from . import config, regions as regions_mod


def _r(x, nd):
    if x is None:
        return None
    xf = float(x)
    if math.isnan(xf) or math.isinf(xf):
        return None
    return round(xf, nd)


def _rlist(a, nd):
    if a is None:
        return None
    return [_r(v, nd) for v in a]


def _scope_key(scope) -> str:
    return str(scope)


def run(out: dict, settings: dict) -> None:
    print("[emit]")
    docs_data = config.DOCS_DATA
    regions_dir = docs_data / "regions"
    if regions_dir.exists():
        shutil.rmtree(regions_dir)
    regions_dir.mkdir(parents=True, exist_ok=True)

    meta_path = config.INTERIM / "region_meta.json"
    region_meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    p_fine = out["p_fine"]
    p_band = out["p_band"]
    p_coarse = out["p_coarse"]
    results = out["results"]
    globals_by_scope = out["globals"]

    def name_type(rid):
        if rid in region_meta:
            return region_meta[rid]["name"], region_meta[rid]["type"]
        n, t = regions_mod.region_name(rid)
        return n, t

    # --- summary.json + per-region files ---
    summary_regions: dict[str, dict] = {}
    region_index: list[dict] = []

    for rid in out["region_ids"]:
        by_scope = results[rid]
        if not by_scope:
            continue
        name, rtype = name_type(rid)
        # Scope keys are "<base>:<mode>"; collect the distinct postseason years.
        bases = {s.split(":", 1)[0] for s in by_scope}
        years_present = sorted(int(b) for b in bases if b != "pooled")
        latest = years_present[-1] if years_present else None

        # Per-region detail file.
        detail_scopes = {}
        summary_scopes = {}
        for scope, res in by_scope.items():
            k = _scope_key(scope)
            # Detail is intentionally slim: the region's quantile knots (q_local,
            # 999) + the bootstrap band (band_grid, 199) + scalars. The hero,
            # survival, and comparison curves are reconstructed client-side from
            # q_local and the scope's global q_fine, so no per-curve arrays are
            # stored.
            detail_scopes[k] = {
                "n": res["n"],
                "q_local": _rlist(res["q_local"], 1),
                "band_local_lo": _rlist(res["band_local_lo"], 4),
                "band_local_hi": _rlist(res["band_local_hi"], 4),
                "crossover_local": _r(res["crossover_local"], 4),
                "mean_D_local": _r(res["mean_D_local"], 4),
                "top_heaviness_local": _r(res["top_heaviness_local"], 4),
                "mean_R": _r(res["mean_R"], 4),
            }
            # Summary drives the All Regions views (heatmap / small-multiples /
            # sorting). mean_survival_R -- the region's mean right-tail survival
            # ratio (1st-99th global percentile) -- is the site's headline
            # "average difficulty" stat and the default sort key.
            summary_scopes[k] = {
                "n": res["n"],
                "mean_D": _r(res["mean_D_local"], 4),
                "crossover": _r(res["crossover_local"], 4),
                "top_heaviness": _r(res["top_heaviness_local"], 4),
                "D_coarse": _rlist(res["D_local_coarse"], 4),
                "R_coarse": _rlist(res["R_coarse"], 3),
                "mean_survival_R": _r(res["mean_R"], 4),
            }

        (regions_dir / f"{rid}.json").write_text(json.dumps({
            "id": rid, "name": name, "type": rtype, "years": years_present, "scopes": detail_scopes,
        }, ensure_ascii=False), encoding="utf-8")

        summary_regions[rid] = {"scopes": summary_scopes}
        region_index.append({
            "id": rid, "name": name, "type": rtype,
            "years": years_present,
            "n_latest": (by_scope.get(f"{latest}:wma") or {}).get("n") if latest else None,
            "n_pooled": (by_scope.get("pooled:wma") or {}).get("n"),
        })

    region_index.sort(key=lambda r: (-(r["n_latest"] or 0), r["name"]))

    (docs_data / "summary.json").write_text(
        json.dumps({"regions": summary_regions}, ensure_ascii=False), encoding="utf-8"
    )

    # --- manifest.json ---
    manifest = {
        "build": {
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "csv_commit": settings["data"]["csv_commit"],
            "api_years": settings["data"]["api_years"],
        },
        "model": {
            "snapshot_years": config.snapshot_years(settings),
            "modes": out["modes"],
            "pooled": True,
            "wma_weights": settings["model"]["wma_weights"],
            "skip_years": settings["model"]["skip_years"],
            "min_band_n": settings["metrics"]["min_band_n"],
        },
        "regions_config": {
            # South Carolina has no snapshot for these years under "st_sc" --
            # it competed as part of Peachtree ("pch") instead (see regions.py).
            "sc_gap_region": "st_sc",
            "sc_gap_years": settings["regions"]["sc_pch_years"],
            "sc_gap_redirect": "pch",
        },
        "grid": {
            "p_fine": _rlist(p_fine, 5),
            "p_band": _rlist(p_band, 5),
            "p_coarse": _rlist(p_coarse, 4),
        },
        # Bounds the client uses to reconstruct the survival curve's EPA range.
        "survival": {
            "p_start": settings["metrics"]["survival_p_start"],
            "p_end_cap": settings["metrics"]["survival_p_end_cap"],
            "min_global_frac": settings["metrics"]["survival_min_global_frac"],
            "min_global_teams": settings["metrics"]["survival_min_global_teams"],
        },
        "scopes": list(globals_by_scope.keys()),
        "globals": {
            _scope_key(s): {"n": g["n"], "q_fine": _rlist(g["q_fine"], 1)}
            for s, g in globals_by_scope.items()
        },
        "regions": region_index,
    }
    (docs_data / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    n_files = len(list(regions_dir.glob("*.json")))
    total_mb = sum(f.stat().st_size for f in docs_data.rglob("*.json")) / 1e6
    print(f"  wrote manifest.json, summary.json, {n_files} region files "
          f"({len(region_index)} regions) -> {total_mb:.1f} MB total")


def main(settings: dict) -> None:
    from . import metrics
    out = metrics.run(settings)
    run(out, settings)


if __name__ == "__main__":
    main(config.load_settings())
