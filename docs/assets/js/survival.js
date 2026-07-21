// Depth ratio: survival ratio R(x) = (1 - F_region) / (1 - F_global),
// reconstructed client-side from the quantile knots and sampled uniformly in
// EPA (so the sparse upper tail stays smooth). Drawn by the shared ratio-curve
// renderer; the dotted line marks the region's mean R -- the site's "average
// difficulty" stat and the Depth ratio All Regions sort key.
import { survivalCurve } from "./curves.js";
import { renderRatioCurve } from "./ratiocurve.js";

export function renderSurvival(el, legendEl, manifest, region, scope, xMode = "epa") {
  const sc = region.scopes[scope];
  const g0 = manifest.globals[scope] || {};
  const qFine = g0.q_fine, pFine = manifest.grid.p_fine;
  const c = sc && sc.q_local && qFine
    ? survivalCurve(sc.q_local, qFine, pFine, g0.n, manifest.survival)
    : { x: [], R: [] };
  renderRatioCurve(el, legendEl, {
    curve: { x: c.x, v: c.R },
    mean: sc ? sc.mean_R : null,
    xMode, qFine, pFine,
    uid: "sclip",
    emptyMsg: `Not enough depth to estimate a survival ratio for ${region.name} here.`,
    ariaLabel: `Depth ratio for ${region.name}`,
    yTitle: "survival ratio (region ÷ world)",
    meanLabel: "avg R",
    tipLabel: "R",
    hardWord: "harder than world",
    easyWord: "easier than world",
    meanLegend: "mean R (1st&ndash;99th pct)",
  });
}
