// Reconstruct the displacement and survival curves client-side from the stored
// quantile knots (q_local for a region, q_fine for the season's world), so both
// render at the full ~1/10-percentile knot resolution without storing per-curve
// arrays. F(x) is read by inverse-interpolating a quantile function.
import { interp1d } from "./interp.js";

// D_local(q) = F_global(Q_region(q)) - q, evaluated at every q_local knot.
// Positive = the region is locally harder (deeper) at that regional percentile.
export function localDisplacementCurve(qLocal, qFine, pFine) {
  const D = new Array(qLocal.length);
  for (let i = 0; i < qLocal.length; i++) D[i] = interp1d(qFine, pFine, qLocal[i]) - pFine[i];
  return D;
}

// The worldwide-percentile range R is trustworthy over: capped below 1 so the
// denominator never hits zero, and backed off further when the season's global
// n makes the far tail too thin. Mirrors pipeline/metrics.py _survival_p_range,
// which is also the grid the stored R_coarse sparklines are sampled on.
export function survivalPRange(cfg, globalN) {
  return [cfg.p_start, Math.min(1 - Math.max(cfg.min_global_frac, cfg.min_global_teams / globalN), cfg.p_end_cap)];
}

// Right-tail survival ratio R(x) = (1 - F_region(x)) / (1 - F_global(x)) sampled
// uniformly in EPA (so the sparse upper tail gets as much x-resolution as the
// dense middle) across the trustworthy range [Q_global(p_start), Q_global(p_cap)].
// e(x) = E[X - x | X > x], the mean excess: how far above x the teams that beat
// x actually sit. Read off a quantile function's knots, whose mean above x is
// exactly E[X | X > x]. Returns null where no knot exceeds x.
function meanExcessFn(q) {
  const n = q.length;
  const suffix = new Float64Array(n + 1);
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + q[i];
  return (x) => {
    // First knot strictly greater than x.
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (q[mid] <= x) lo = mid + 1; else hi = mid; }
    const cnt = n - lo;
    return cnt > 0 ? suffix[lo] / cnt - x : null;
  };
}

// Slope of difficulty S(x) = e_region(x) / e_global(x), sampled like the
// survival curve. Above 1, the teams that beat x are further ahead of x locally
// than worldwide -- a steeper climb. With `weighted`, multiplies by R(x), which
// by  integral_x^inf (1-F) = (1-F(x))*e(x)  gives the ratio of the areas under
// the two survival curves right of x (total excess strength above x per team).
export function slopeCurve(qLocal, qFine, pFine, globalN, cfg, weighted = false, nOut = 600) {
  const [pStart, pCap] = survivalPRange(cfg, globalN);
  if (!(pCap > pStart)) return { x: [], S: [] };
  const xLo = interp1d(pFine, qFine, pStart);
  const xHi = interp1d(pFine, qFine, pCap);
  const eLocal = meanExcessFn(qLocal), eGlobal = meanExcessFn(qFine);
  const x = new Array(nOut), S = new Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const xi = xLo + ((xHi - xLo) * i) / (nOut - 1);
    const er = eLocal(xi), eg = eGlobal(xi);
    let v = er != null && eg != null && eg > 1e-9 ? er / eg : null;
    if (v != null && weighted) {
      const sg = 1 - interp1d(qFine, pFine, xi);
      const sr = 1 - interp1d(qLocal, pFine, xi);
      v = sg > 1e-9 ? v * (sr / sg) : null;
    }
    x[i] = xi;
    S[i] = v;
  }
  return { x, S };
}

export function survivalCurve(qLocal, qFine, pFine, globalN, cfg, nOut = 600) {
  const [pStart, pCap] = survivalPRange(cfg, globalN);
  if (!(pCap > pStart)) return { x: [], R: [] };
  const xLo = interp1d(pFine, qFine, pStart);
  const xHi = interp1d(pFine, qFine, pCap);
  const x = new Array(nOut), R = new Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const xi = xLo + ((xHi - xLo) * i) / (nOut - 1);
    const sg = 1 - interp1d(qFine, pFine, xi);
    const sr = 1 - interp1d(qLocal, pFine, xi);
    x[i] = xi;
    R[i] = sg > 1e-9 ? sr / sg : null;
  }
  return { x, R };
}
