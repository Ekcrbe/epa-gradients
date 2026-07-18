// Elite-tail survival ratio R(x) = (1 - F_region) / (1 - F_global) on a log
// y-axis, with a reference line at R = 1 (region matches the world's depth).

export function renderSurvival(el, region, scope) {
  el.innerHTML = "";
  const sc = region.scopes[scope];
  const sv = sc && sc.survival;
  const pts = sv && sv.x ? sv.x.map((x, i) => ({ x, R: sv.R[i] })).filter((p) => p.R != null && p.R > 0) : [];
  if (pts.length < 3) {
    el.innerHTML = `<div class="empty-state small">Not enough elite-tail depth to estimate a survival ratio for ${region.name} here.</div>`;
    return;
  }
  const tip = document.createElement("div");
  tip.className = "tooltip";
  el.appendChild(tip);

  const width = Math.max(320, el.clientWidth || 820);
  const height = 260;
  const m = { top: 12, right: 16, bottom: 40, left: 48 };
  const iW = width - m.left - m.right, iH = height - m.top - m.bottom;

  const xs = pts.map((p) => p.x), rs = pts.map((p) => p.R);
  const x = d3.scaleLinear([d3.min(xs), d3.max(xs)], [0, iW]);
  const yMin = Math.min(0.5, d3.min(rs) * 0.85);
  const yMax = Math.max(2, d3.max(rs) * 1.15);
  const y = d3.scaleLog([yMin, yMax], [iH, 0]).clamp(true);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", `Elite-tail survival ratio for ${region.name}`);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  g.append("g").attr("class", "grid").selectAll("line")
    .data(y.ticks(4)).join("line").attr("class", "gridline")
    .attr("x1", 0).attr("x2", iW).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));

  // Reference line at R = 1.
  g.append("line").attr("class", "zero-line").attr("x1", 0).attr("x2", iW).attr("y1", y(1)).attr("y2", y(1));
  g.append("text").attr("class", "axis-title").attr("x", iW).attr("y", y(1) - 5).attr("text-anchor", "end")
    .text("R = 1 (matches world)");

  const line = d3.line().x((p) => x(p.x)).y((p) => y(p.R));
  g.append("path").datum(pts).attr("class", "d-line").attr("d", line);

  g.append("g").attr("class", "axis").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat((d) => Math.round(d)));
  g.append("g").attr("class", "axis")
    .call(d3.axisLeft(y).ticks(4, "~g"));
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
}
