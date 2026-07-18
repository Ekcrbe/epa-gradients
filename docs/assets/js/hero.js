// Hero displacement chart: D(p) with diverging fill, bootstrap band,
// zero line, zero-crossing marker, and hover readout. Uses the global d3.
import { ordinal } from "./format.js";

const M_MIN = 0.08;

function niceHalf(maxAbs) {
  const raw = Math.max(M_MIN, maxAbs * 1.12);
  return Math.ceil(raw / 0.02) * 0.02;
}

export function renderHero(el, manifest, region, scope) {
  const p = manifest.grid.p_fine;
  const sc = region.scopes[scope];
  const q = (manifest.globals[scope] || {}).q_fine || [];
  el.innerHTML = "";
  const tip = document.createElement("div");
  tip.className = "tooltip";
  el.appendChild(tip);

  const D = sc.D, lo = sc.band_lo, hi = sc.band_hi;
  const n = p.length;
  const hasBand = Array.isArray(lo) && Array.isArray(hi);

  let maxAbs = 0;
  for (const v of D) if (v != null) maxAbs = Math.max(maxAbs, Math.abs(v));
  if (hasBand) for (let i = 0; i < n; i++) maxAbs = Math.max(maxAbs, Math.abs(lo[i]), Math.abs(hi[i]));
  const M = niceHalf(maxAbs);

  const width = Math.max(320, el.clientWidth || 820);
  const height = Math.round(Math.min(460, Math.max(320, width * 0.5)));
  const m = { top: 16, right: 18, bottom: 44, left: 54 };
  const iW = width - m.left - m.right;
  const iH = height - m.top - m.bottom;

  const x = d3.scaleLinear([0, 1], [0, iW]);
  const y = d3.scaleLinear([-M, M], [iH, 0]);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", `Displacement curve for ${region.name}, ${scope}`);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  // Horizontal gridlines.
  g.append("g").attr("class", "grid")
    .selectAll("line").data(y.ticks(7)).join("line")
    .attr("class", "gridline")
    .attr("x1", 0).attr("x2", iW).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));

  const zeroY = y(0);
  const idx = D.map((_, i) => i);

  // Bootstrap band.
  if (hasBand) {
    const band = d3.area().x((i) => x(p[i])).y0((i) => y(lo[i])).y1((i) => y(hi[i]));
    g.append("path").datum(idx).attr("class", "band").attr("d", band);
  }

  // Diverging fill (area between curve and zero, clipped above / below).
  const area = d3.area().x((i) => x(p[i])).y0(zeroY).y1((i) => y(D[i]));
  const defs = svg.append("defs");
  defs.append("clipPath").attr("id", "clip-up").append("rect")
    .attr("x", 0).attr("y", 0).attr("width", iW).attr("height", Math.max(0, zeroY));
  defs.append("clipPath").attr("id", "clip-down").append("rect")
    .attr("x", 0).attr("y", zeroY).attr("width", iW).attr("height", Math.max(0, iH - zeroY));
  g.append("path").datum(idx).attr("class", "fill-harder").attr("clip-path", "url(#clip-up)").attr("d", area);
  g.append("path").datum(idx).attr("class", "fill-easier").attr("clip-path", "url(#clip-down)").attr("d", area);

  // Zero-crossing marker.
  if (sc.crossover != null) {
    const cx = x(sc.crossover);
    g.append("line").attr("class", "crossover-line").attr("x1", cx).attr("x2", cx).attr("y1", 0).attr("y2", iH);
    g.append("text").attr("class", "crossover-label")
      .attr("x", Math.min(cx + 5, iW - 4)).attr("y", 13)
      .attr("text-anchor", cx > iW - 60 ? "end" : "start")
      .text(`crossover p${Math.round(sc.crossover * 100)}`);
  }

  // Zero line + curve.
  g.append("line").attr("class", "zero-line").attr("x1", 0).attr("x2", iW).attr("y1", zeroY).attr("y2", zeroY);
  const line = d3.line().x((i) => x(p[i])).y((i) => y(D[i]));
  g.append("path").datum(idx).attr("class", "d-line").attr("d", line);

  // Axes.
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat((d) => `${Math.round(d * 100)}`));
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(7).tickFormat((d) => (d > 0 ? "+" : "") + Math.round(d * 100)));
  g.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
    .attr("x", iW / 2).attr("y", iH + 38).text("team skill — worldwide percentile");
  g.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
    .attr("transform", `translate(${-42},${iH / 2}) rotate(-90)`).text("displacement D  (percentile points)");

  // Hover.
  const hover = g.append("g").style("display", "none");
  const hLine = hover.append("line").attr("class", "hover-line").attr("y1", 0).attr("y2", iH);
  const hDot = hover.append("circle").attr("class", "hover-dot").attr("r", 3.5);
  const step = p[1] - p[0];

  g.append("rect").attr("width", iW).attr("height", iH).attr("fill", "none")
    .style("pointer-events", "all")
    .on("mouseenter", () => hover.style("display", null))
    .on("mouseleave", () => { hover.style("display", "none"); tip.style.opacity = 0; })
    .on("mousemove", function (event) {
      const mx = d3.pointer(event, this)[0];
      let i = Math.round((x.invert(mx) - p[0]) / step);
      i = Math.max(0, Math.min(n - 1, i));
      const px = x(p[i]);
      hLine.attr("x1", px).attr("x2", px);
      hDot.attr("cx", px).attr("cy", y(D[i]));
      const dPts = D[i] * 100;
      const harder = D[i] >= 0;
      const regPct = Math.round((p[i] - D[i]) * 100);
      const epa = q[i] != null ? Math.round(q[i]) : null;
      tip.innerHTML =
        `<div class="tt-p">${ordinal(Math.round(p[i] * 100))} worldwide percentile</div>` +
        (epa != null ? `<div class="tt-row">≈ ${epa} unitless EPA</div>` : "") +
        `<div class="tt-row">D = <span class="${harder ? "tt-hard" : "tt-easy"}">${harder ? "+" : ""}${dPts.toFixed(1)} pts</span> — ` +
        `${harder ? "harder" : "easier"} here</div>` +
        `<div class="tt-row">ranks ~${ordinal(regPct)} within ${region.name}</div>`;
      tip.style.opacity = 1;
      const tx = m.left + px + 14;
      tip.style.left = `${Math.min(tx, width - 230)}px`;
      tip.style.top = `${m.top + y(D[i]) - 10}px`;
    });
}
