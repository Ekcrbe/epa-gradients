// Shared renderer for the region-vs-world ratio plots (depth ratio, slope of
// difficulty). Both are a ratio against EPA on a log y-axis, centered on 1,
// with diverging red/blue shading, faint global-percentile markers above, and a
// dotted line at the region's mean. Callers supply the curve and the wording.
import { interp1d } from "./interp.js";

const REF_PERCENTILES = [10, 25, 50, 75, 90, 95, 99];

// The x mapping over the same [xLo, xHi] EPA span, in one of two flavors:
// "epa" spaces equal EPA gaps equally, "pct" spaces equal shares of the world's
// teams equally. The latter is a polylinear scale threaded through the global
// quantile knots, which keeps invert() and tick generation working -- so both
// axes (EPA ticks below, percentile markers above) simply land in new spots.
function makeXScale(mode, xLo, xHi, qFine, pFine, iW) {
  if (mode !== "pct" || !qFine || !qFine.length) return d3.scaleLinear([xLo, xHi], [0, iW]);
  const pLo = interp1d(qFine, pFine, xLo), pHi = interp1d(qFine, pFine, xHi);
  if (!(pHi > pLo)) return d3.scaleLinear([xLo, xHi], [0, iW]);
  const domain = [xLo], range = [0];
  for (let i = 0; i < qFine.length; i++) {
    // Ties in EPA would break strict monotonicity, which invert() needs.
    if (qFine[i] <= domain[domain.length - 1] || qFine[i] >= xHi) continue;
    domain.push(qFine[i]);
    range.push(((pFine[i] - pLo) / (pHi - pLo)) * iW);
  }
  domain.push(xHi); range.push(iW);
  return d3.scaleLinear(domain, range);
}

// opts: { curve: {x, v}, mean, xMode, qFine, pFine, uid, emptyMsg, ariaLabel,
//         yTitle, meanLabel, tipLabel, hardWord, easyWord, meanLegend }
export function renderRatioCurve(el, legendEl, opts) {
  el.innerHTML = "";
  if (legendEl) legendEl.innerHTML = "";
  const { curve, mean, xMode = "epa", qFine, pFine, uid } = opts;
  const pts = (curve.x || [])
    .map((x, i) => ({ x, v: curve.v[i] }))
    .filter((p) => p.v != null && p.v > 0 && isFinite(p.v));
  if (pts.length < 3) {
    el.innerHTML = `<div class="empty-state small">${opts.emptyMsg}</div>`;
    return;
  }
  const tip = document.createElement("div");
  tip.className = "tooltip";
  el.appendChild(tip);

  const width = Math.max(320, el.clientWidth || 820);
  const height = 280;
  const m = { top: 26, right: 16, bottom: 40, left: 48 };
  const iW = width - m.left - m.right, iH = height - m.top - m.bottom;

  const xs = pts.map((p) => p.x), vs = pts.map((p) => p.v);
  const x = makeXScale(xMode, d3.min(xs), d3.max(xs), qFine, pFine, iW);
  const yVals = mean != null ? [...vs, mean] : vs;
  const yMin = Math.min(0.5, d3.min(yVals) * 0.85);
  const yMax = Math.max(2, d3.max(yVals) * 1.15);
  const y = d3.scaleLog([yMin, yMax], [iH, 0]).clamp(true);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", opts.ariaLabel);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  g.append("g").attr("class", "grid").selectAll("line")
    .data(y.ticks(5)).join("line").attr("class", "gridline")
    .attr("x1", 0).attr("x2", iW).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));

  const zeroY = y(1);
  const idx = pts.map((_, i) => i);

  // Diverging fill around 1, clipped above/below the reference line. Clip ids
  // are per-plot so two of these can coexist on one page.
  const area = d3.area().x((i) => x(pts[i].x)).y0(zeroY).y1((i) => y(pts[i].v));
  const defs = svg.append("defs");
  defs.append("clipPath").attr("id", `${uid}-up`).append("rect")
    .attr("x", 0).attr("y", 0).attr("width", iW).attr("height", Math.max(0, zeroY));
  defs.append("clipPath").attr("id", `${uid}-down`).append("rect")
    .attr("x", 0).attr("y", zeroY).attr("width", iW).attr("height", Math.max(0, iH - zeroY));
  g.append("path").datum(idx).attr("class", "fill-harder").attr("clip-path", `url(#${uid}-up)`).attr("d", area);
  g.append("path").datum(idx).attr("class", "fill-easier").attr("clip-path", `url(#${uid}-down)`).attr("d", area);

  // Faint global-percentile markers to orient the raw-EPA x-axis.
  if (qFine && qFine.length) {
    // Read the span off the data, not x.domain() -- in percentile mode the
    // domain is the full array of quantile knots, not a two-element extent.
    const xMin = d3.min(xs), xMax = d3.max(xs);
    for (const pct of REF_PERCENTILES) {
      const val = interp1d(pFine, qFine, pct / 100);
      if (val == null || val < xMin || val > xMax) continue;
      const px = x(val);
      g.append("line").attr("class", "pct-line").attr("x1", px).attr("x2", px).attr("y1", 0).attr("y2", iH);
      g.append("text").attr("class", "pct-label").attr("x", px).attr("y", -12).attr("text-anchor", "middle")
        .text(`p${pct}`);
    }
  }

  g.append("line").attr("class", "zero-line").attr("x1", 0).attr("x2", iW).attr("y1", zeroY).attr("y2", zeroY);

  // Mean reference line -- the region's headline single-number stat.
  if (mean != null) {
    const my = y(mean);
    g.append("line").attr("class", "avg-line").attr("x1", 0).attr("x2", iW).attr("y1", my).attr("y2", my);
    g.append("text").attr("class", "avg-label")
      .attr("x", iW - 4).attr("y", my - 5).attr("text-anchor", "end")
      .text(`${opts.meanLabel} = ${mean.toFixed(2)}×`);
  }

  const line = d3.line().x((p) => x(p.x)).y((p) => y(p.v));
  g.append("path").datum(pts).attr("class", "d-line").attr("d", line);

  g.append("g").attr("class", "axis").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat((d) => Math.round(d)));
  g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5, "~g"));
  g.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
    .attr("x", iW / 2).attr("y", iH + 34).text("team strength — unitless EPA");
  g.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
    .attr("transform", `translate(${-36},${iH / 2}) rotate(-90)`).text(opts.yTitle);

  // Hover.
  const hover = g.append("g").style("display", "none");
  const hLine = hover.append("line").attr("class", "hover-line").attr("y1", 0).attr("y2", iH);
  const hDot = hover.append("circle").attr("class", "hover-dot").attr("r", 3.5);

  const bisect = d3.bisector((p) => p.x).center;
  g.append("rect").attr("width", iW).attr("height", iH).attr("fill", "none").style("pointer-events", "all")
    .on("mouseenter", () => hover.style("display", null))
    .on("mouseleave", () => { hover.style("display", "none"); tip.style.opacity = 0; })
    .on("mousemove", function (event) {
      const mx = d3.pointer(event, this)[0];
      const p = pts[bisect(pts, x.invert(mx))];
      const px = x(p.x);
      hLine.attr("x1", px).attr("x2", px);
      hDot.attr("cx", px).attr("cy", y(p.v));
      tip.innerHTML = `<div class="tt-p">${Math.round(p.x)} EPA</div>` +
        `<div class="tt-row">${opts.tipLabel} = <span class="${p.v >= 1 ? "tt-hard" : "tt-easy"}">${p.v.toFixed(2)}×</span> vs world</div>`;
      tip.style.opacity = 1;
      tip.style.left = `${Math.min(m.left + px + 12, width - 160)}px`;
      tip.style.top = `${m.top + y(p.v) - 8}px`;
    });

  if (legendEl) {
    const items = [
      `<span><span class="sw" style="background:var(--harder);opacity:.55"></span>${opts.hardWord}</span>`,
      `<span><span class="sw" style="background:var(--easier);opacity:.55"></span>${opts.easyWord}</span>`,
    ];
    if (mean != null) items.push(`<span><span class="sw-avg"></span>${opts.meanLegend}</span>`);
    legendEl.innerHTML = items.join("");
  }
}
