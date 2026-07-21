// Slope of difficulty: S(x) = e_region(x) / e_global(x), where e is the mean
// excess E[X - x | X > x]. Above 1, the teams that beat x sit further above it
// locally than they do worldwide -- climbing from x means covering more ground.
// The weighted form multiplies by the survival ratio, giving the ratio of the
// areas under the two survival curves right of x: how much total excess
// strength sits above x, per team, counting both how many and by how much.
import { slopeCurve } from "./curves.js";
import { renderRatioCurve } from "./ratiocurve.js";

export function renderSlope(el, legendEl, manifest, region, scope, xMode = "epa", weighted = false) {
  const sc = region.scopes[scope];
  const g0 = manifest.globals[scope] || {};
  const qFine = g0.q_fine, pFine = manifest.grid.p_fine;
  const c = sc && sc.q_local && qFine
    ? slopeCurve(sc.q_local, qFine, pFine, g0.n, manifest.survival, weighted)
    : { x: [], S: [] };
  const mean = sc ? (weighted ? sc.mean_slope_wt : sc.mean_slope) : null;
  renderRatioCurve(el, legendEl, {
    curve: { x: c.x, v: c.S },
    mean: mean ?? null,
    xMode, qFine, pFine,
    uid: "slclip",
    emptyMsg: `Not enough depth above the cutoff to estimate a slope for ${region.name} here.`,
    ariaLabel: `Slope of difficulty for ${region.name}`,
    yTitle: weighted ? "excess-area ratio (region ÷ world)" : "slope ratio (region ÷ world)",
    meanLabel: weighted ? "avg S×R" : "avg S",
    tipLabel: weighted ? "S×R" : "S",
    hardWord: weighted ? "more strength above" : "steeper than world",
    easyWord: weighted ? "less strength above" : "shallower than world",
    meanLegend: weighted ? "mean S&times;R (1st&ndash;99th pct)" : "mean S (1st&ndash;99th pct)",
  });
}
