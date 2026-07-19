// Piecewise-linear interpolation over a monotonic (ascending) grid. Works in
// either direction -- e.g. percentile -> EPA value, or (swapping the arrays)
// EPA value -> percentile -- as long as xArr is sorted ascending.

export function interp1d(xArr, yArr, xTarget) {
  const n = xArr.length;
  if (!n) return null;
  if (xTarget <= xArr[0]) return yArr[0];
  if (xTarget >= xArr[n - 1]) return yArr[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xArr[mid] <= xTarget) lo = mid; else hi = mid;
  }
  const span = xArr[hi] - xArr[lo];
  const t = span === 0 ? 0 : (xTarget - xArr[lo]) / span;
  return yArr[lo] + t * (yArr[hi] - yArr[lo]);
}
