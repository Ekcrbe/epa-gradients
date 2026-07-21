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


def _survival_p_range(global_sorted, settings) -> tuple[float, float]:
    """The [p_start, p_cap] global-percentile window the survival ratio sweeps."""
    m = settings["metrics"]
    n_glob = len(global_sorted)
    p_cap = min(1.0 - max(m["survival_min_global_frac"], m["survival_min_global_teams"] / n_glob),
                m["survival_p_end_cap"])
    return m["survival_p_start"], p_cap


def _survival_R(region_sorted, global_sorted, p_tail) -> np.ndarray:
    """R(x) = (1 - F_region(x)) / (1 - F_global(x)) at the given percentile grid."""
    x = np.quantile(global_sorted, p_tail)
    sg = 1.0 - _ecdf_right(global_sorted, x)
    sr = 1.0 - _ecdf_right(region_sorted, x)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(sg > 0, sr / sg, np.nan)


def survival_tail(region_sorted, global_sorted, settings) -> dict:
    """R(x) = (1 - F_region(x)) / (1 - F_global(x)) over most of the distribution.

    x sweeps global percentiles [survival_p_start, p_cap], where p_cap is
    survival_p_end_cap (default 0.99, to avoid the /0 at the very top) backed
    off further if the season's global n is too thin to trust that far.
    mean_R -- the plain mean of R over that same grid -- is the region's
    headline "average difficulty" summary stat (also used to sort All Regions).
    """
    p_start, p_cap = _survival_p_range(global_sorted, settings)
    if p_cap <= p_start:
        return {"x": [], "R": [], "p": [], "mean_R": None}
    p_tail = np.linspace(p_start, p_cap, settings["metrics"]["survival_points"])
    R = _survival_R(region_sorted, global_sorted, p_tail)
    mean_R = float(np.nanmean(R)) if np.any(~np.isnan(R)) else None
    return {"x": np.quantile(global_sorted, p_tail), "R": R, "p": p_tail, "mean_R": mean_R}


def survival_tail_coarse(region_sorted, global_sorted, settings, n_points) -> np.ndarray | None:
    """A low-resolution R(x) sparkline for the small-multiples mini chart."""
    p_start, p_cap = _survival_p_range(global_sorted, settings)
    if p_cap <= p_start:
        return None
    return _survival_R(region_sorted, global_sorted, np.linspace(p_start, p_cap, n_points))


def _mean_excess(sorted_vals: np.ndarray, x: np.ndarray) -> np.ndarray:
    """e(x) = E[X - x | X > x], the mean excess (mean residual life) function.

    How far above x the teams that beat x actually sit. Vectorized over x with a
    suffix sum; NaN where nothing in the sample exceeds x.
    """
    n = len(sorted_vals)
    suffix = np.concatenate([np.cumsum(sorted_vals[::-1])[::-1], [0.0]])
    i = np.searchsorted(sorted_vals, x, side="right")
    cnt = n - i
    with np.errstate(divide="ignore", invalid="ignore"):
        mean_above = np.where(cnt > 0, suffix[i] / np.maximum(cnt, 1), np.nan)
    return mean_above - x


def _slope_ratio(region_sorted, global_sorted, p_tail) -> np.ndarray:
    """S(x) = e_region(x) / e_global(x) at the given global-percentile grid.

    Above 1, the teams that beat x are further ahead of x locally than they are
    worldwide -- a steeper climb from x. Below 1 they are bunched closer to x.
    This is orthogonal to the survival ratio, which counts those teams without
    regard to how far above x they sit.
    """
    x = np.quantile(global_sorted, p_tail)
    er = _mean_excess(region_sorted, x)
    eg = _mean_excess(global_sorted, x)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(eg > 0, er / eg, np.nan)


def slope_tail(region_sorted, global_sorted, settings) -> dict:
    """Mean slope ratio over the same window mean_R uses, in both forms.

    ``mean_slope`` averages S(x) alone. ``mean_slope_wt`` averages S(x)*R(x),
    which by the identity  integral_x^inf (1-F) = (1-F(x)) * e(x)  is the ratio
    of the areas under the two survival curves to the right of x -- i.e. total
    excess strength above x per team, counting both how many teams beat x and
    by how much. Averaging happens after the product, so mean_slope_wt is not
    mean_slope * mean_R.
    """
    p_start, p_cap = _survival_p_range(global_sorted, settings)
    if p_cap <= p_start:
        return {"mean_slope": None, "mean_slope_wt": None}
    p_tail = np.linspace(p_start, p_cap, settings["metrics"]["survival_points"])
    s = _slope_ratio(region_sorted, global_sorted, p_tail)
    wt = s * _survival_R(region_sorted, global_sorted, p_tail)
    return {
        "mean_slope": float(np.nanmean(s)) if np.any(~np.isnan(s)) else None,
        "mean_slope_wt": float(np.nanmean(wt)) if np.any(~np.isnan(wt)) else None,
    }


def slope_tail_coarse(region_sorted, global_sorted, settings, n_points) -> np.ndarray | None:
    """A low-resolution S(x) sparkline for the heatmap / small-multiples grid."""
    p_start, p_cap = _survival_p_range(global_sorted, settings)
    if p_cap <= p_start:
        return None
    return _slope_ratio(region_sorted, global_sorted, np.linspace(p_start, p_cap, n_points))


def _gate_crossover(p_fine, d, settings):
    """Primary crossover, reported only for genuinely mixed, non-bottom-decile flips."""
    crossings = find_crossings(p_fine, d)
    tau = settings["metrics"]["crossover_min_side"]
    is_mixed = d.min() <= -tau and d.max() >= tau
    cx = primary_crossing(crossings) if is_mixed else None
    if cx is not None and cx < settings["metrics"]["crossover_min_p"]:
        cx = None
    return cx, crossings


def compute_region(region_vals, global_sorted, p_fine, p_coarse, p_band, settings, rng) -> dict:
    """Per region-scope stats on the local (regional-percentile) axis.

    Only the region's quantile function ``q_local`` (999 knots) and the bootstrap
    band (a cheaper 199-knot grid) are stored; the hero / survival / comparison
    curves are reconstructed client-side from q_local + the global q_fine. The
    worldwide-percentile axis was dropped from the UI, so it is not computed here
    (the ``displacement`` / crossings helpers remain for possible re-use).
    """
    rs = np.sort(np.asarray(region_vals, dtype=np.float64))
    top = p_fine > 0.9

    # D_local(q) = F_global(Q_region(q)) - q  (positive = locally harder).
    q_local = np.quantile(rs, p_fine)
    d_local = _ecdf_right(global_sorted, q_local) - p_fine
    d_local_coarse = _ecdf_right(global_sorted, np.quantile(rs, p_coarse)) - p_coarse
    crossover_local, _ = _gate_crossover(p_fine, d_local, settings)
    lo_l, hi_l = bootstrap.band_local(rs, global_sorted, p_band, settings, rng)

    return {
        "n": int(len(rs)),
        "q_local": q_local,
        "band_local_lo": lo_l,
        "band_local_hi": hi_l,
        "crossover_local": crossover_local,
        "mean_D_local": float(d_local.mean()),
        "top_heaviness_local": float(d_local[top].mean()),
        "D_local_coarse": d_local_coarse,
        "R_coarse": survival_tail_coarse(rs, global_sorted, settings, len(p_coarse)),
        "mean_R": survival_tail(rs, global_sorted, settings)["mean_R"],
        "slope_coarse": slope_tail_coarse(rs, global_sorted, settings, len(p_coarse)),
        **slope_tail(rs, global_sorted, settings),
    }


def build(strength: pd.DataFrame, settings: dict) -> dict:
    m = settings["metrics"]
    n_fine, n_band, n_coarse = m["fine_grid"], m["band_grid"], m["coarse_bins"]
    p_fine = (np.arange(1, n_fine + 1)) / (n_fine + 1)
    p_band = (np.arange(1, n_band + 1)) / (n_band + 1)
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
            # q_fine (999 knots) is stored for the client to reconstruct F_global.
            q_fine = np.quantile(global_sorted, p_fine)
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
                    rvals, global_sorted, p_fine, p_coarse, p_band, settings, rng
                )

    return {
        "p_fine": p_fine,
        "p_band": p_band,
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
    n_bands = sum(1 for v in out["results"].values() for r in v.values() if r["band_local_lo"] is not None)
    n_scopes = len(out["base_scopes"]) * len(out["modes"])
    print(f"  metrics: {len(out['region_ids'])} regions x {n_scopes} scopes "
          f"({len(out['modes'])} modes) -> {n_cells:,} region-scope cells, {n_bands:,} bands")
    return out


if __name__ == "__main__":
    run(config.load_settings())
