// Region-comparison plot: a parametric curve x(t) = F_region1(t), y(t) =
// F_region2(t) as t sweeps unitless EPA -- where a team of a given raw skill
// lands (in each region's own percentile terms) in Region 1 vs. Region 2.
// y = x means identical distributions. Both axes are regional percentile,
// each computed by inverse-interpolating that region's own quantile function
// (q_local, EPA-at-percentile) against a shared EPA sweep.
import { interp1d } from "./interp.js";

export function renderComparison(el, manifest, region1, region2, scope) {
  el.innerHTML = "";
  const sc1 = region1.scopes[scope], sc2 = region2.scopes[scope];
  const q1 = sc1 && sc1.q_local, q2 = sc2 && sc2.q_local;
  const tGrid = (manifest.globals[scope] || {}).q_fine;
  if (!q1 || !q2 || !tGrid || !tGrid.length) {
    el.innerHTML = `<div class="empty-state">${region1.name} and/or ${region2.name} have no data for this season.</div>`;
    return;
  }
  const pFine = manifest.grid.p_fine;
  const pts = tGrid.map((t) => ({
    t,
    x: interp1d(q1, pFine, t) * 100,
    y: interp1d(q2, pFine, t) * 100,
  }));

  const tip = document.createElement("div");
  tip.className = "tooltip";
  el.appendChild(tip);

  const width = Math.max(320, el.clientWidth || 640);
  const iSize = 400;
  const m = { top: 16, right: 16, bottom: 46, left: 54 };

  const x = d3.scaleLinear([0, 100], [0, iSize]);
  const y = d3.scaleLinear([0, 100], [iSize, 0]);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${m.left + iSize + m.right} ${m.top + iSize + m.bottom}`)
    .attr("role", "img")
    .attr("aria-label", `Region comparison: ${region1.name} vs ${region2.name}`);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

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

  g.append("rect").attr("width", iSize).attr("height", iSize).attr("fill", "none").style("pointer-events", "all")
    .on("mouseenter", () => hover.style("display", null))
    .on("mouseleave", () => { hover.style("display", "none"); tip.style.opacity = 0; })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, this);
      let best = 0, bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const dx = x(pts[i].x) - mx, dy = y(pts[i].y) - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; best = i; }
      }
      const p = pts[best];
      hDot.attr("cx", x(p.x)).attr("cy", y(p.y));
      tip.innerHTML = `<div class="tt-p">${Math.round(p.t)} EPA</div>` +
        `<div class="tt-row">${region1.name}: ${p.x.toFixed(1)}th pct</div>` +
        `<div class="tt-row">${region2.name}: ${p.y.toFixed(1)}th pct</div>`;
      tip.style.opacity = 1;
      const tx = m.left + x(p.x) + 12;
      tip.style.left = `${Math.min(tx, width - 200)}px`;
      tip.style.top = `${m.top + y(p.y) - 10}px`;
    });
}
