// Diverging heatmap: rows = regions (pre-sorted/filtered by the caller),
// columns = coarse skill-percentile bins, color = displacement D centered at 0.
import { divergingColor, isDark } from "./theme.js";

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function renderHeatmap(el, { manifest, rows, M, selectedId, onSelect }) {
  el.innerHTML = "";
  if (!rows.length) { el.innerHTML = `<div class="empty-state small">No regions meet the current filter.</div>`; return; }
  const tip = document.createElement("div");
  tip.className = "tooltip";
  el.appendChild(tip);

  const pc = manifest.grid.p_coarse;
  const ncol = pc.length;
  const dark = isDark();
  const labelW = 148, rowH = 18, top = 6, bottom = 30, right = 14;
  const width = Math.max(360, el.clientWidth || 820);
  const iW = width - labelW - right;
  const cellW = iW / ncol;
  const height = top + rows.length * rowH + bottom;
  const x = d3.scaleLinear([0, 1], [labelW, labelW + iW]);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", `Diverging heatmap of displacement across ${rows.length} regions`);

  const cells = [];
  rows.forEach((r, ri) => r.D_coarse.forEach((v, j) => cells.push({ ri, j, v })));

  svg.append("g").selectAll("rect.cell").data(cells).join("rect")
    .attr("class", "cell")
    .attr("x", (d) => labelW + d.j * cellW)
    .attr("y", (d) => top + d.ri * rowH)
    .attr("width", cellW + 0.6)
    .attr("height", rowH - 1)
    .attr("fill", (d) => divergingColor(d.v, M, dark));

  const labels = svg.append("g");
  labels.selectAll("text.hm-label").data(rows).join("text")
    .attr("class", "hm-label")
    .attr("x", labelW - 8).attr("y", (_, ri) => top + ri * rowH + rowH / 2 + 3)
    .attr("text-anchor", "end")
    .classed("sel", (r) => r.id === selectedId)
    .text((r) => truncate(r.name, 20));
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
      const d = r.D_coarse[j] * 100;
      tip.innerHTML = `<div class="tt-p">${r.name}</div>` +
        `<div class="tt-row">${Math.round(pc[j] * 100)}th pct · ` +
        `<span class="${d >= 0 ? "tt-hard" : "tt-easy"}">${d >= 0 ? "+" : ""}${d.toFixed(1)} pts</span></div>`;
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
    .text("team skill — worldwide percentile");
}
