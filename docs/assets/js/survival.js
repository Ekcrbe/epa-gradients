// Right-tail depth: survival ratio R(x) = (1 - F_region) / (1 - F_global),
// reconstructed client-side from the quantile knots and sampled uniformly in
// EPA (so the sparse upper tail stays smooth), on a log y-axis. Diverging
// red/blue shading around R = 1, faint global-percentile gridlines to orient
// the raw-EPA x-axis, and a dotted line at the region's mean R -- the site's
// "average difficulty" stat (also the All Regions sort key).
import { interp1d } from "./interp.js";
import { survivalCurve } from "./curves.js";

const REF_PERCENTILES = [10, 25, 50, 75, 90, 95, 99];

export function renderSurvival(el, legendEl, manifest, region, scope) {
  el.innerHTML = "";
  if (legendEl) legendEl.innerHTML = "";
  const sc = region.scopes[scope];
  const g0 = manifest.globals[scope] || {};
  const qFine = g0.q_fine, pFine = manifest.grid.p_fine;
  const curve = sc && sc.q_local && qFine
    ? survivalCurve(sc.q_local, qFine, pFine, g0.n, manifest.survival)
    : { x: [], R: [] };
  const pts = curve.x.map((x, i) => ({ x, R: curve.R[i] })).filter((p) => p.R != null && p.R > 0);
  if (pts.length < 3) {
    el.innerHTML = `<div class="empty-state small">Not enough right-tail depth to estimate a survival ratio for ${region.name} here.</div>`;
    return;
  }
  const tip = document.createElement("div");
  tip.className = "tooltip";
  el.appendChild(tip);

  const width = Math.max(320, el.clientWidth || 820);
  const height = 280;
  const m = { top: 26, right: 16, bottom: 40, left: 48 };
  const iW = width - m.left - m.right, iH = height - m.top - m.bottom;

  const xs = pts.map((p) => p.x), rs = pts.map((p) => p.R);
  const x = d3.scaleLinear([d3.min(xs), d3.max(xs)], [0, iW]);
  const meanR = sc.mean_R;
  const yVals = meanR != null ? [...rs, meanR] : rs;
  const yMin = Math.min(0.5, d3.min(yVals) * 0.85);
  const yMax = Math.max(2, d3.max(yVals) * 1.15);
  const y = d3.scaleLog([yMin, yMax], [iH, 0]).clamp(true);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", `Right-tail depth (survival ratio) for ${region.name}`);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  g.append("g").attr("class", "grid").selectAll("line")
    .data(y.ticks(5)).join("line").attr("class", "gridline")
    .attr("x1", 0).attr("x2", iW).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));

  const zeroY = y(1);
  const idx = pts.map((_, i) => i);

  // Diverging fill around R = 1 (harder above, easier below), clipped.
  const area = d3.area().x((i) => x(pts[i].x)).y0(zeroY).y1((i) => y(pts[i].R));
  const defs = svg.append("defs");
  defs.append("clipPath").attr("id", "sclip-up").append("rect")
    .attr("x", 0).attr("y", 0).attr("width", iW).attr("height", Math.max(0, zeroY));
  defs.append("clipPath").attr("id", "sclip-down").append("rect")
    .attr("x", 0).attr("y", zeroY).attr("width", iW).attr("height", Math.max(0, iH - zeroY));
  g.append("path").datum(idx).attr("class", "fill-harder").attr("clip-path", "url(#sclip-up)").attr("d", area);
  g.append("path").datum(idx).attr("class", "fill-easier").attr("clip-path", "url(#sclip-down)").attr("d", area);

  // Faint global-percentile markers to orient the raw-EPA x-axis.
  if (qFine && qFine.length) {
    const [xMin, xMax] = x.domain();
    for (const pct of REF_PERCENTILES) {
      const val = interp1d(pFine, qFine, pct / 100);
      if (val == null || val < xMin || val > xMax) continue;
      const px = x(val);
      g.append("line").attr("class", "pct-line").attr("x1", px).attr("x2", px).attr("y1", 0).attr("y2", iH);
      g.append("text").attr("class", "pct-label").attr("x", px).attr("y", -12).attr("text-anchor", "middle")
        .text(`p${pct}`);
    }
  }

  // Reference line at R = 1.
  g.append("line").attr("class", "zero-line").attr("x1", 0).attr("x2", iW).attr("y1", zeroY).attr("y2", zeroY);

  // Mean-R reference line -- the region's headline "average difficulty" stat.
  if (meanR != null) {
    const my = y(meanR);
    g.append("line").attr("class", "avg-line").attr("x1", 0).attr("x2", iW).attr("y1", my).attr("y2", my);
    g.append("text").attr("class", "avg-label")
      .attr("x", iW - 4).attr("y", my - 5).attr("text-anchor", "end")
      .text(`avg R = ${meanR.toFixed(2)}×`);
  }

  const line = d3.line().x((p) => x(p.x)).y((p) => y(p.R));
  g.append("path").datum(pts).attr("class", "d-line").attr("d", line);

  g.append("g").attr("class", "axis").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat((d) => Math.round(d)));
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(5, "~g"));
  g.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
    .attr("x", iW / 2).attr("y", iH + 34).text("team strength — unitless EPA");
  g.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
    .attr("transform", `translate(${-36},${iH / 2}) rotate(-90)`).text("survival ratio (region ÷ world)");

  const bisect = d3.bisector((p) => p.x).center;
  g.append("rect").attr("width", iW).attr("height", iH).attr("fill", "none").style("pointer-events", "all")
    .on("mouseleave", () => { tip.style.opacity = 0; })
    .on("mousemove", function (event) {
      const mx = d3.pointer(event, this)[0];
      const p = pts[bisect(pts, x.invert(mx))];
      tip.innerHTML = `<div class="tt-p">${Math.round(p.x)} EPA</div>` +
        `<div class="tt-row">R = <span class="${p.R >= 1 ? "tt-hard" : "tt-easy"}">${p.R.toFixed(2)}×</span> vs world</div>`;
      tip.style.opacity = 1;
      tip.style.left = `${Math.min(m.left + x(p.x) + 12, width - 160)}px`;
      tip.style.top = `${m.top + y(p.R) - 8}px`;
    });

  if (legendEl) {
    const items = [
      `<span><span class="sw" style="background:var(--harder);opacity:.55"></span>harder than world</span>`,
      `<span><span class="sw" style="background:var(--easier);opacity:.55"></span>easier than world</span>`,
    ];
    if (meanR != null) items.push(`<span><span class="sw-avg"></span>mean R (1st&ndash;99th pct)</span>`);
    legendEl.innerHTML = items.join("");
  }
}
