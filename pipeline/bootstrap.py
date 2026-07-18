"""Bootstrap confidence band for the displacement curve D(p).

The region's teams are resampled with replacement against a *fixed* global CDF
(the region is the small, noisy sample). The band is the [ci_low, ci_high]
percentile envelope of D(p) across bootstrap replicates.
"""
from __future__ import annotations

import numpy as np


def band(
    region_vals: np.ndarray,
    q_global_fine: np.ndarray,
    p_fine: np.ndarray,
    settings: dict,
    rng: np.random.Generator,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    n = len(region_vals)
    B = settings["metrics"]["bootstrap_B"]
    if B <= 0 or n < settings["metrics"]["min_band_n"]:
        return None, None

    rs = np.asarray(region_vals, dtype=np.float64)

    # M[i, j] = 1 if region team i's strength <= global quantile j.
    M = (rs[:, None] <= q_global_fine[None, :]).astype(np.float64)
    # Multinomial counts = resampling n teams with replacement, B times.
    counts = rng.multinomial(n, np.full(n, 1.0 / n), size=B).astype(np.float64)
    f_boot = (counts @ M) / n                       # B x N region CDF at global quantiles
    d_boot = p_fine[None, :] - f_boot               # B x N displacement replicates

    lo = np.percentile(d_boot, settings["metrics"]["ci_low"], axis=0)
    hi = np.percentile(d_boot, settings["metrics"]["ci_high"], axis=0)
    return lo, hi
