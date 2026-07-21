// Diverging heatmap: rows = regions (pre-sorted/filtered by the caller),
// columns = coarse skill-percentile bins, color = the section's metric centered
// on its neutral value (D at 0, R at 1) -- see metrics.js.
import { divergingColor, isDark } from "./theme.js";
import { ordinal } from "./format.js";

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function renderHeatmap(el, { manifest, rows, metric, axis, M, selectedId, onSelect }) {
  el.innerHTML = "";
  if (!rows.length) { el.innerHTML = `<div class="empty-state small">No regions meet the current filter.</div>`; return; }
  const tip = document.createElement("div");
  tip.className = "tooltip";
  el.appendChild(tip);

  // Column centers on the metric's own x-grid: D_coarse is sampled on regional
  // percentiles (p_coarse), R_coarse on the trustworthy worldwide-percentile band.
  const ncol = manifest.grid.p_coarse.length;
  const pc = axis.columns(ncol);
  const dark = isDark();
  const width = Math.max(320, el.clientWidth || 820);
  const narrow = width < 560;
  const labelW = narrow ? 94 : 148, rowH = 18, top = 6, bottom = 30, right = 14;
  const nameMax = narrow ? 12 : 20;
  const iW = width - labelW - right;
  const cellW = iW / ncol;
  const height = top + rows.length * rowH + bottom;
  const x = d3.scaleLinear(axis.domain, [labelW, labelW + iW]);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", `Diverging heatmap of ${metric.label} across ${rows.length} regions`);

  const cells = [];
  rows.forEach((r, ri) => metric.values(r).forEach((v, j) => cells.push({ ri, j, t: metric.t(v) })));

  svg.append("g").selectAll("rect.cell").data(cells).join("rect")
    .attr("class", "cell")
    .attr("x", (d) => labelW + d.j * cellW)
    .attr("y", (d) => top + d.ri * rowH)
    .attr("width", cellW + 0.6)
    .attr("height", rowH - 1)
    // Cells with no computable value (an empty tail) stay at the neutral midpoint.
    .attr("fill", (d) => divergingColor(d.t ?? 0, M, dark));

  const labels = svg.append("g");
  labels.selectAll("text.hm-label").data(rows).join("text")
    .attr("class", "hm-label")
    .attr("x", labelW - 8).attr("y", (_, ri) => top + ri * rowH + rowH / 2 + 3)
    .attr("text-anchor", "end")
    .classed("sel", (r) => r.id === selectedId)
    .text((r) => truncate(r.name, nameMax));
  labels.selectAll("text.hm-n").data(rows).join("text")
    .attr("class", "hm-n")
    .attr("x", 2).attr("y", (_, ri) => top + ri * rowH + rowH / 2 + 3)
    .text((r) => r.n);

  // Selected-row outline.
  const si = rows.findIndex((r) => r.id === selectedId);
  if (si >= 0) {
    svg.append("rect").attr("class", "hm-sel")
      .attr("x", labelW).attr("y", top + si * rowH - 0.5)
      .attr("width", iW).attr("height", rowH).attr("fill", "none");
  }

  // Per-row hit areas (click to select, hover for tooltip).
  svg.append("g").selectAll("rect.hit").data(rows).join("rect")
    .attr("class", "hit")
    .attr("x", 0).attr("y", (_, ri) => top + ri * rowH)
    .attr("width", width).attr("height", rowH)
    .attr("fill", "transparent").style("cursor", "pointer")
    .on("click", (_, r) => onSelect(r.id))
    .on("mouseleave", () => { tip.style.opacity = 0; })
    .on("mousemove", function (event, r) {
      const mx = d3.pointer(event, svg.node())[0];
      const j = Math.max(0, Math.min(ncol - 1, Math.floor((mx - labelW) / cellW)));
      const v = metric.values(r)[j];
      const cls = v != null && metric.isHard(v) ? "tt-hard" : "tt-easy";
      const shown = v == null ? "—" : `<span class="${cls}">${metric.format(v)}</span>`;
      tip.innerHTML = `<div class="tt-p">${r.name}</div>` +
        `<div class="tt-row">${ordinal(Math.round(pc[j] * 100))} pct · ${shown}</div>`;
      tip.style.opacity = 1;
      const [ex, ey] = d3.pointer(event, el);
      tip.style.left = `${Math.min(ex + 14, width - 180)}px`;
      tip.style.top = `${ey + 12}px`;
    });

  svg.append("g").attr("class", "axis hm-axis")
    .attr("transform", `translate(0,${top + rows.length * rowH})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat((d) => Math.round(d * 100)));
  svg.append("text").attr("class", "axis-title")
    .attr("x", labelW + iW / 2).attr("y", height - 2).attr("text-anchor", "middle")
    .text(axis.title);
}
