"""Distributional metrics per (region, scope): D(p), crossings, survival, bands.

Scopes are each snapshot season (2009..2027) plus a single 'pooled' scope that
pools every team-season. For each scope the global baseline is the ECDF over all
teams' strengths; each region is compared against it.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import bootstrap, config

POOLED = "pooled"
# Strength modes: 4-year weighted moving average vs. the anchor season alone.
MODES = {"wma": "strength_wma", "single": "strength_single"}


def _ecdf_right(sorted_vals: np.ndarray, x: np.ndarray) -> np.ndarray:
    """P(X <= x) for each x, from a pre-sorted sample."""
    return np.searchsorted(sorted_vals, x, side="right") / len(sorted_vals)


def displacement(region_sorted: np.ndarray, q_grid: np.ndarray, p_grid: np.ndarray) -> np.ndarray:
    """D(p) = p - F_region(Q_global(p))."""
    return p_grid - _ecdf_right(region_sorted, q_grid)


def find_crossings(p: np.ndarray, d: np.ndarray) -> list[dict]:
    """Zero crossings of D(p) with linear interpolation and direction."""
    out: list[dict] = []
    for i in range(len(d) - 1):
        a, b = d[i], d[i + 1]
        if a == 0.0:
            out.append({"p": float(p[i]), "dir": "zero"})
        elif a * b < 0:
            t = a / (a - b)
            pc = float(p[i] + t * (p[i + 1] - p[i]))
            out.append({"p": pc, "dir": "easier_to_harder" if a < 0 else "harder_to_easier"})
    return out


def primary_crossing(crossings: list[dict]) -> float | None:
    """The skill percentile where the region flips easier -> harder, if any."""
    eh = [c["p"] for c in crossings if c["dir"] == "easier_to_harder"]
    if eh:
        return eh[0]
    return crossings[0]["p"] if crossings else None


def survival_tail(region_sorted, global_sorted, settings) -> dict:
    """R(x) = (1 - F_region(x)) / (1 - F_global(x)) over the trustworthy top tail."""
    n_glob = len(global_sorted)
    frac = settings["metrics"]["survival_min_global_frac"]
    min_teams = settings["metrics"]["survival_min_global_teams"]
    p_cap = 1.0 - max(frac, min_teams / n_glob)
    if p_cap <= 0.5:
        return {"x": [], "R": [], "p": []}
    p_tail = np.linspace(0.5, p_cap, 60)
    x = np.quantile(global_sorted, p_tail)
    sg = 1.0 - _ecdf_right(global_sorted, x)
    sr = 1.0 - _ecdf_right(region_sorted, x)
    with np.errstate(divide="ignore", invalid="ignore"):
        R = np.where(sg > 0, sr / sg, np.nan)
    return {"x": x, "R": R, "p": p_tail}


def _gate_crossover(p_fine, d, settings):
    """Primary crossover, reported only for genuinely mixed, non-bottom-decile flips."""
    crossings = find_crossings(p_fine, d)
    tau = settings["metrics"]["crossover_min_side"]
    is_mixed = d.min() <= -tau and d.max() >= tau
    cx = primary_crossing(crossings) if is_mixed else None
    if cx is not None and cx < settings["metrics"]["crossover_min_p"]:
        cx = None
    return cx, crossings


def compute_region(region_vals, global_sorted, q_fine, q_coarse, p_fine, p_coarse, settings, rng) -> dict:
    rs = np.sort(np.asarray(region_vals, dtype=np.float64))
    top = p_fine > 0.9

    # Global-percentile axis: D(p) = p - F_region(Q_global(p)).
    d_fine = displacement(rs, q_fine, p_fine)
    d_coarse = displacement(rs, q_coarse, p_coarse)
    crossover, crossings = _gate_crossover(p_fine, d_fine, settings)
    lo, hi = bootstrap.band(rs, q_fine, p_fine, settings, rng)

    # Local-percentile axis: D_local(q) = F_global(Q_region(q)) - q. Same sign
    # convention (positive = locally harder); a hero-only alternate view.
    q_local = np.quantile(rs, p_fine)
    d_local = _ecdf_right(global_sorted, q_local) - p_fine
    crossover_local, _ = _gate_crossover(p_fine, d_local, settings)
    lo_l, hi_l = bootstrap.band_local(rs, global_sorted, p_fine, settings, rng)

    return {
        "n": int(len(rs)),
        "D_fine": d_fine,
        "D_coarse": d_coarse,
        "band_lo": lo,
        "band_hi": hi,
        "crossover": crossover,
        "crossings": crossings,
        "mean_D": float(d_fine.mean()),
        "top_heaviness": float(d_fine[top].mean()),
        "D_local": d_local,
        "band_local_lo": lo_l,
        "band_local_hi": hi_l,
        "crossover_local": crossover_local,
        "mean_D_local": float(d_local.mean()),
        "top_heaviness_local": float(d_local[top].mean()),
        "q_local": q_local,
        "survival": survival_tail(rs, global_sorted, settings),
    }


def build(strength: pd.DataFrame, settings: dict) -> dict:
    m = settings["metrics"]
    n_fine, n_coarse = m["fine_grid"], m["coarse_bins"]
    p_fine = (np.arange(1, n_fine + 1)) / (n_fine + 1)
    p_coarse = (np.arange(n_coarse) + 0.5) / n_coarse
    rng = np.random.default_rng(m["bootstrap_seed"])

    base_scopes: list = config.snapshot_years(settings) + [POOLED]
    region_ids = sorted(strength["region"].dropna().unique())

    results: dict[str, dict] = {rid: {} for rid in region_ids}
    globals_by_scope: dict = {}

    for mode, col in MODES.items():
        for base in base_scopes:
            sub = strength if base == POOLED else strength[strength["snapshot_year"] == base]
            gvals = sub[col].to_numpy(dtype=np.float64)
            gvals = gvals[~np.isnan(gvals)]
            if len(gvals) == 0:
                continue
            key = f"{base}:{mode}"
            global_sorted = np.sort(gvals)
            q_fine = np.quantile(global_sorted, p_fine)
            q_coarse = np.quantile(global_sorted, p_coarse)
            globals_by_scope[key] = {"n": int(len(global_sorted)), "q_fine": q_fine}

            by_region = {rid: g[col].to_numpy(dtype=np.float64)
                         for rid, g in sub.dropna(subset=["region"]).groupby("region")}
            for rid in region_ids:
                rvals = by_region.get(rid)
                if rvals is None:
                    continue
                rvals = rvals[~np.isnan(rvals)]
                if len(rvals) == 0:
                    continue
                results[rid][key] = compute_region(
                    rvals, global_sorted, q_fine, q_coarse, p_fine, p_coarse, settings, rng
                )

    return {
        "p_fine": p_fine,
        "p_coarse": p_coarse,
        "base_scopes": base_scopes,
        "modes": list(MODES),
        "region_ids": region_ids,
        "results": results,
        "globals": globals_by_scope,
    }


def run(settings: dict) -> dict:
    from . import strength
    print("[metrics]")
    ts = strength.load(settings)
    out = build(ts, settings)
    n_cells = sum(len(v) for v in out["results"].values())
    n_bands = sum(1 for v in out["results"].values() for r in v.values() if r["band_lo"] is not None)
    n_scopes = len(out["base_scopes"]) * len(out["modes"])
    print(f"  metrics: {len(out['region_ids'])} regions x {n_scopes} scopes "
          f"({len(out['modes'])} modes) -> {n_cells:,} region-scope cells, {n_bands:,} bands")
    return out


if __name__ == "__main__":
    run(config.load_settings())
