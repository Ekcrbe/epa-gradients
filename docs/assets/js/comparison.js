// Region-comparison plot: a parametric curve x(t) = F_region1(t), y(t) =
// F_region2(t) as t sweeps unitless EPA -- where a team of a given raw skill
// lands (in each region's own percentile terms) in Region 1 vs. Region 2.
// y = x means identical distributions. The area between the curve and that
// diagonal is filled: purple vertical stripes where Region 1 is the stronger
// (deeper) region (curve above the diagonal), green horizontal stripes where
// Region 2 is stronger (below).
import { interp1d } from "./interp.js";

const N_SWEEP = 1000;
const GREEN = "29,158,117", PURPLE = "122,91,208"; // r,g,b

export function renderComparison(el, manifest, region1, region2, scope) {
  el.innerHTML = "";
  const sc1 = region1.scopes[scope], sc2 = region2.scopes[scope];
  const q1 = sc1 && sc1.q_local, q2 = sc2 && sc2.q_local;
  const qFine = (manifest.globals[scope] || {}).q_fine;
  if (!q1 || !q2 || !qFine || !qFine.length) {
    el.innerHTML = `<div class="empty-state">${region1.name} and/or ${region2.name} have no data for this season.</div>`;
    return;
  }
  const pFine = manifest.grid.p_fine;
  // Sweep t uniformly in EPA across the world's range for a smooth curve.
  const tLo = qFine[0], tHi = qFine[qFine.length - 1];
  const pts = [];
  for (let i = 0; i < N_SWEEP; i++) {
    const t = tLo + ((tHi - tLo) * i) / (N_SWEEP - 1);
    pts.push({ t, x: interp1d(q1, pFine, t) * 100, y: interp1d(q2, pFine, t) * 100 });
  }

  const tip = document.createElement("div");
  tip.className = "tooltip";
  el.appendChild(tip);

  const iSize = 400;
  const m = { top: 16, right: 16, bottom: 46, left: 54 };
  const x = d3.scaleLinear([0, 100], [0, iSize]);
  const y = d3.scaleLinear([0, 100], [iSize, 0]);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${m.left + iSize + m.right} ${m.top + iSize + m.bottom}`)
    .attr("role", "img")
    .attr("aria-label", `Region comparison: ${region1.name} vs ${region2.name}`);
  const defs = svg.append("defs");
  const stripe = (id, rgb, orient) => {
    const pat = defs.append("pattern").attr("id", id).attr("patternUnits", "userSpaceOnUse")
      .attr("width", 7).attr("height", 7);
    pat.append("rect").attr("width", 7).attr("height", 7).attr("fill", `rgba(${rgb},0.10)`);
    const l = pat.append("line").attr("stroke", `rgba(${rgb},0.55)`).attr("stroke-width", 1);
    if (orient === "v") l.attr("x1", 3.5).attr("y1", 0).attr("x2", 3.5).attr("y2", 7);
    else l.attr("x1", 0).attr("y1", 3.5).attr("x2", 7).attr("y2", 3.5);
  };
  stripe("stripe-v", PURPLE, "v"); // Region 1 stronger
  stripe("stripe-h", GREEN, "h");  // Region 2 stronger
  defs.append("clipPath").attr("id", "cmp-above").append("polygon")
    .attr("points", `0,0 ${iSize},0 0,${iSize}`);
  defs.append("clipPath").attr("id", "cmp-below").append("polygon")
    .attr("points", `${iSize},0 ${iSize},${iSize} 0,${iSize}`);

  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  // Fill between the curve and the y = x diagonal, split by side.
  const area = d3.area().x((p) => x(p.x)).y0((p) => y(p.x)).y1((p) => y(p.y));
  g.append("path").datum(pts).attr("d", area).attr("fill", "url(#stripe-v)").attr("clip-path", "url(#cmp-above)");
  g.append("path").datum(pts).attr("d", area).attr("fill", "url(#stripe-h)").attr("clip-path", "url(#cmp-below)");

  const ticks = [0, 20, 40, 60, 80, 100];
  g.append("g").selectAll("line.vgrid").data(ticks).join("line").attr("class", "gridline")
    .attr("x1", (d) => x(d)).attr("x2", (d) => x(d)).attr("y1", 0).attr("y2", iSize);
  g.append("g").selectAll("line.hgrid").data(ticks).join("line").attr("class", "gridline")
    .attr("x1", 0).attr("x2", iSize).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));

  // y = x baseline (identical regions).
  g.append("line").attr("class", "zero-line")
    .attr("x1", x(0)).attr("y1", y(0)).attr("x2", x(100)).attr("y2", y(100))
    .attr("stroke-dasharray", "4 3");

  const line = d3.line().x((p) => x(p.x)).y((p) => y(p.y));
  g.append("path").datum(pts).attr("class", "d-line").attr("d", line);

  g.append("g").attr("class", "axis").attr("transform", `translate(0,${iSize})`)
    .call(d3.axisBottom(x).tickValues(ticks).tickFormat((d) => d));
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).tickValues(ticks).tickFormat((d) => d));
  g.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
    .attr("x", iSize / 2).attr("y", iSize + 38).text(`${region1.name} — regional percentile`);
  g.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
    .attr("transform", `translate(${-40},${iSize / 2}) rotate(-90)`).text(`${region2.name} — regional percentile`);

  const hover = g.append("g").style("display", "none");
  const hDot = hover.append("circle").attr("class", "hover-dot").attr("r", 4);
  const bisect = d3.bisector((p) => p.x).center;

  g.append("rect").attr("width", iSize).attr("height", iSize).attr("fill", "none").style("pointer-events", "all")
    .on("mouseenter", () => hover.style("display", null))
    .on("mouseleave", () => { hover.style("display", "none"); tip.style.opacity = 0; })
    .on("mousemove", function (event) {
      const [mx] = d3.pointer(event, this);
      const p = pts[bisect(pts, x.invert(mx))];
      hDot.attr("cx", x(p.x)).attr("cy", y(p.y));
      tip.innerHTML = `<div class="tt-p">${Math.round(p.t)} EPA</div>` +
        `<div class="tt-row">${region1.name}: ${p.x.toFixed(1)}th pct</div>` +
        `<div class="tt-row">${region2.name}: ${p.y.toFixed(1)}th pct</div>`;
      tip.style.opacity = 1;
      tip.style.left = `${Math.min(m.left + x(p.x) + 12, m.left + iSize - 40)}px`;
      tip.style.top = `${m.top + y(p.y) - 10}px`;
    });

  // Legend explaining the two fills (uses live region names).
  const legend = document.createElement("div");
  legend.className = "legend cmp-legend";
  legend.innerHTML =
    `<span><span class="sw" style="background:rgba(${PURPLE},0.5)"></span>${region1.name} stronger</span>` +
    `<span><span class="sw" style="background:rgba(${GREEN},0.5)"></span>${region2.name} stronger</span>` +
    `<span><span class="sw-cmp-diag"></span>y = x (identical)</span>`;
  el.appendChild(legend);
}
