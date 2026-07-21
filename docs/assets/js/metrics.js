// The two all-regions metrics. Each section of the page (Displacement, Depth
// ratio) renders the same heatmap + small-multiples pair over its own metric,
// so both views are parameterized by one of these descriptors rather than
// hard-coding D or R.
//
// `t` maps a raw value onto the axis the view actually draws on -- identity for
// D (linear, centered at 0), natural log for R (log axis, centered at 1). Color
// and mini-panel geometry both work in that transformed space.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 92nd percentile of |t(v)| across every visible cell, so a handful of extreme
// regions don't wash out the ramp.
function spread(rows, metric, step, lo, hi) {
  const vals = [];
  for (const r of rows) {
    for (const v of metric.values(r)) {
      const t = metric.t(v);
      if (t != null && isFinite(t)) vals.push(Math.abs(t));
    }
  }
  if (!vals.length) return lo;
  vals.sort((a, b) => a - b);
  return clamp(Math.ceil(vals[Math.floor(vals.length * 0.92)] / step) * step, lo, hi);
}

function extent(rows, metric) {
  let min = Infinity, max = -Infinity;
  for (const r of rows) {
    for (const v of metric.values(r)) {
      const t = metric.t(v);
      if (t == null || !isFinite(t)) continue;
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  return [min, max];
}

export const METRICS = {
  D: {
    id: "D",
    label: "displacement",
    center: 0,
    values: (r) => r.D_coarse || [],
    mean: (r) => r.mean_D,
    t: (v) => (v == null ? null : v),
    isHard: (v) => v >= 0,
    format: (v) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} pts`,
    formatMean: (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}`),
    colorDomain: (rows) => spread(rows, METRICS.D, 0.02, 0.08, 0.4),
    legendScale: (M) => `&plusmn;${Math.round(M * 100)} pts`,
    // Symmetric around 0, never tighter than +/-10 points.
    panelDomain(rows) {
      const [min, max] = extent(rows, this);
      if (!isFinite(min)) return [-0.1, 0.1];
      const m = Math.max(0.1, Math.max(Math.abs(min), Math.abs(max)) * 1.05);
      return [-m, m];
    },
  },
  R: {
    id: "R",
    label: "depth ratio",
    center: 1,
    values: (r) => r.R_coarse || [],
    mean: (r) => r.mean_survival_R,
    // Nonpositive R can't go on a log axis (and means an empty tail).
    t: (v) => (v == null || v <= 0 ? null : Math.log(v)),
    isHard: (v) => v >= 1,
    format: (v) => `${v.toFixed(2)}×`,
    formatMean: (v) => (v == null ? "—" : `${v.toFixed(2)}×`),
    colorDomain: (rows) => spread(rows, METRICS.R, 0.05, Math.log(1.15), Math.log(4)),
    legendScale: (M) => `&times;/&divide;&nbsp;${Math.exp(M).toFixed(1)}`,
    // Mirrors survival.js: always shows at least the 0.5x-2x band.
    panelDomain(rows) {
      const [min, max] = extent(rows, this);
      if (!isFinite(min)) return [Math.log(0.5), Math.log(2)];
      return [Math.min(Math.log(0.5), min - 0.15), Math.max(Math.log(2), max + 0.15)];
    },
  },
};

// Slope of difficulty, in its plain and survival-weighted forms. Both are
// ratios centered on 1 like R, so they share its log handling; they differ only
// in which stored array/scalar they read and how they are worded.
const slopeMetric = (id, values, mean, label) => ({
  ...METRICS.R,
  id,
  label,
  values,
  mean,
  colorDomain: (rows) => spread(rows, METRICS[id], 0.05, Math.log(1.15), Math.log(4)),
  panelDomain(rows) {
    const [min, max] = extent(rows, this);
    if (!isFinite(min)) return [Math.log(0.5), Math.log(2)];
    return [Math.min(Math.log(0.5), min - 0.15), Math.max(Math.log(2), max + 0.15)];
  },
});

METRICS.S = slopeMetric("S", (r) => r.slope_coarse || [], (r) => r.mean_slope, "slope");

// The weighted form's per-column values are the elementwise product of the two
// stored arrays, so only its mean needs its own field (the mean of the product
// is not the product of the means).
METRICS.SW = slopeMetric("SW", (r) => {
  const s = r.slope_coarse, q = r.R_coarse;
  if (!s || !q) return [];
  return s.map((v, i) => (v == null || q[i] == null ? null : v * q[i]));
}, (r) => r.mean_slope_wt, "excess area");
