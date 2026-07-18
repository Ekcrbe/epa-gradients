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


def compute_region(region_vals, global_sorted, q_fine, q_coarse, p_fine, p_coarse, settings, rng) -> dict:
    rs = np.sort(np.asarray(region_vals, dtype=np.float64))
    d_fine = displacement(rs, q_fine, p_fine)
    d_coarse = displacement(rs, q_coarse, p_coarse)
    crossings = find_crossings(p_fine, d_fine)
    # Only a genuinely mixed region (meaningfully easier AND harder) has a
    # crossover; near-monotone regions report None (see crossover_min_side).
    tau = settings["metrics"]["crossover_min_side"]
    is_mixed = d_fine.min() <= -tau and d_fine.max() >= tau
    crossover = primary_crossing(crossings) if is_mixed else None
    lo, hi = bootstrap.band(rs, q_fine, p_fine, settings, rng)
    top = p_fine > 0.9
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
        "survival": survival_tail(rs, global_sorted, settings),
    }


def build(strength: pd.DataFrame, settings: dict) -> dict:
    m = settings["metrics"]
    n_fine, n_coarse = m["fine_grid"], m["coarse_bins"]
    p_fine = (np.arange(1, n_fine + 1)) / (n_fine + 1)
    p_coarse = (np.arange(n_coarse) + 0.5) / n_coarse
    rng = np.random.default_rng(m["bootstrap_seed"])

    scopes: list = config.snapshot_years(settings) + [POOLED]
    region_ids = sorted(strength["region"].dropna().unique())

    results: dict[str, dict] = {rid: {} for rid in region_ids}
    globals_by_scope: dict = {}

    for scope in scopes:
        if scope == POOLED:
            gvals = strength["strength"].to_numpy(dtype=np.float64)
            sub = strength
        else:
            sub = strength[strength["snapshot_year"] == scope]
            gvals = sub["strength"].to_numpy(dtype=np.float64)
        if len(gvals) == 0:
            continue
        global_sorted = np.sort(gvals)
        q_fine = np.quantile(global_sorted, p_fine)
        q_coarse = np.quantile(global_sorted, p_coarse)
        globals_by_scope[scope] = {"n": int(len(global_sorted)), "q_fine": q_fine}

        by_region = {rid: g["strength"].to_numpy(dtype=np.float64)
                     for rid, g in sub.dropna(subset=["region"]).groupby("region")}
        for rid in region_ids:
            rvals = by_region.get(rid)
            if rvals is None or len(rvals) == 0:
                continue
            results[rid][scope] = compute_region(
                rvals, global_sorted, q_fine, q_coarse, p_fine, p_coarse, settings, rng
            )

    return {
        "p_fine": p_fine,
        "p_coarse": p_coarse,
        "scopes": scopes,
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
    print(f"  metrics: {len(out['region_ids'])} regions x {len(out['scopes'])} scopes "
          f"-> {n_cells:,} region-scope cells, {n_bands:,} with bootstrap bands")
    return out


if __name__ == "__main__":
    run(config.load_settings())
