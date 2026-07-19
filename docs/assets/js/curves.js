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

// Right-tail survival ratio R(x) = (1 - F_region(x)) / (1 - F_global(x)) sampled
// uniformly in EPA (so the sparse upper tail gets as much x-resolution as the
// dense middle) across the trustworthy range [Q_global(p_start), Q_global(p_cap)].
export function survivalCurve(qLocal, qFine, pFine, globalN, cfg, nOut = 600) {
  const pCap = Math.min(1 - Math.max(cfg.min_global_frac, cfg.min_global_teams / globalN), cfg.p_end_cap);
  const pStart = cfg.p_start;
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
