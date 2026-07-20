// Strength over time: a per-season time series for the selected region --
// average displacement D (left axis) and average depth ratio R (right axis),
// as solid dots joined by straight segments. Both series come from the
// precomputed per-season scopes (mean_D_local / mean_R), so no curve
// reconstruction is needed. The plot always spans the full postseason range
// regardless of the season slider; the single-year EPA toggle switches the
// scope mode (wma <-> single). The canceled 2020-21 seasons are bridged
// because they are simply absent from the snapshot-year axis, so consecutive
// snapshots (2019, 2022) join directly; any other season in which the region
// fielded no teams leaves a real gap that breaks the line.

// Left (D) and right (R) axes are scaled so that D = 0 and R = 1 land on the
// same pixel row, drawn as the shared solid white zero line (matching the
// other plots). Both scales are stretched, never shifted, off that shared
// reference, so every data point stays in view.
function alignedScales(dVals, rVals, iH) {
  const hasD = dVals.length > 0, hasR = rVals.length > 0;
  let dPos = 0, dNeg = 0, rPos = 0, rNeg = 0;
  if (hasD) { dPos = Math.max(0, d3.max(dVals)); dNeg = Math.max(0, -d3.min(dVals)); }
  if (hasR) { rPos = Math.max(0, d3.max(rVals) - 1); rNeg = Math.max(0, 1 - d3.min(rVals)); }
  const dSpan = Math.max(dPos, dNeg, 1e-4), rSpan = Math.max(rPos, rNeg, 1e-4);
  const PAD = 0.14; // headroom so dots don't sit on the top/bottom edge
  dPos += PAD * dSpan; dNeg += PAD * dSpan;
  rPos += PAD * rSpan; rNeg += PAD * rSpan;

  // Natural fraction (from the bottom) at which each axis's reference sits;
  // average them, then clamp so the shared line stays comfortably inside.
  const fracs = [];
  if (hasD) fracs.push(dNeg / (dNeg + dPos));
  if (hasR) fracs.push(rNeg / (rNeg + rPos));
  let frac0 = fracs.reduce((a, b) => a + b, 0) / fracs.length;
  frac0 = Math.min(0.82, Math.max(0.18, frac0));
  const k = frac0 / (1 - frac0); // required (below-reference) / (above-reference)

  const aD = Math.max(dNeg, k * dPos), bD = aD / k;
  const aR = Math.max(rNeg, k * rPos), bR = aR / k;
  const yD = d3.scaleLinear([-aD, bD], [iH, 0]);
  const yR = d3.scaleLinear([1 - aR, 1 + bR], [iH, 0]);
  return { yD, yR, zeroY: yD(0), hasD, hasR };
}

// Split a null-punctuated, snapshot-year-aligned array into runs of adjacent
// present points. A null (a snapshot season the region has no value for)
// breaks the run; the canceled seasons are already absent from the axis, so
// the snapshots straddling them stay adjacent and join across the gap.
function segmentsOf(arr) {
  const segs = [];
  let cur = [];
  for (const item of arr) {
    if (item == null) { if (cur.length) segs.push(cur); cur = []; }
    else cur.push(item);
  }
  if (cur.length) segs.push(cur);
  return segs;
}

const D_COLOR = "var(--accent)";
const R_COLOR = "var(--refline)";

export function renderStrength(el, legendEl, manifest, region, mode) {
  el.innerHTML = "";
  if (legendEl) legendEl.innerHTML = "";
  const years = manifest.model?.snapshot_years || [];

  // Series aligned with `years`; null where the region has no snapshot there.
  const dArr = years.map((y) => {
    const sc = region.scopes[`${y}:${mode}`];
    return sc && sc.mean_D_local != null ? { year: y, v: sc.mean_D_local } : null;
  });
  const rArr = years.map((y) => {
    const sc = region.scopes[`${y}:${mode}`];
    return sc && sc.mean_R != null ? { year: y, v: sc.mean_R } : null;
  });
  const dVals = dArr.filter(Boolean).map((p) => p.v);
  const rVals = rArr.filter(Boolean).map((p) => p.v);

  if (!dVals.length && !rVals.length) {
    el.innerHTML = `<div class="empty-state small">No seasonal snapshots for ${region.name}.</div>`;
    return;
  }

  const tip = document.createElement("div");
  tip.className = "tooltip";
  el.appendChild(tip);

  const width = Math.max(320, el.clientWidth || 820);
  const height = 300;
  const m = { top: 20, right: 56, bottom: 40, left: 54 };
  const iW = width - m.left - m.right, iH = height - m.top - m.bottom;

  const x = d3.scaleLinear([years[0], years[years.length - 1]], [0, iW]);
  const { yD, yR, zeroY, hasD, hasR } = alignedScales(dVals, rVals, iH);

  const svg = d3.select(el).append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", `Average displacement D and depth ratio R over time for ${region.name}`);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  // Horizontal gridlines keyed to the D (left) axis.
  g.append("g").attr("class", "grid").selectAll("line")
    .data(yD.ticks(6)).join("line").attr("class", "gridline")
    .attr("x1", 0).attr("x2", iW).attr("y1", (d) => yD(d)).attr("y2", (d) => yD(d));

  // Shared reference: D = 0 aligned with R = 1, solid white line.
  g.append("line").attr("class", "zero-line").attr("x1", 0).attr("x2", iW).attr("y1", zeroY).attr("y2", zeroY);

  // Series: line segments (breaking across no-team gaps) then solid dots.
  const drawSeries = (arr, y, lineCls, dotCls, color) => {
    const line = d3.line().x((p) => x(p.year)).y((p) => y(p.v));
    for (const seg of segmentsOf(arr)) {
      g.append("path").datum(seg).attr("class", lineCls).attr("d", line);
    }
    g.selectAll(null).data(arr.filter(Boolean)).join("circle")
      .attr("class", dotCls).attr("cx", (p) => x(p.year)).attr("cy", (p) => y(p.v)).attr("r", 3.6);
    return color;
  };
  if (hasR) drawSeries(rArr, yR, "strength-line strength-r", "strength-dot strength-r-dot", R_COLOR);
  if (hasD) drawSeries(dArr, yD, "strength-line strength-d", "strength-dot strength-d-dot", D_COLOR);

  // X axis (seasons). Thin the tick labels on narrow widths.
  const maxTicks = Math.max(4, Math.floor(iW / 46));
  let tickYears = years;
  if (years.length > maxTicks) {
    const step = Math.ceil(years.length / maxTicks);
    tickYears = years.filter((_, i) => i % step === 0);
    const last = years[years.length - 1];
    if (tickYears[tickYears.length - 1] !== last) tickYears.push(last);
  }
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${iH})`)
    .call(d3.axisBottom(x).tickValues(tickYears).tickFormat((d) => `'${String(d).slice(2)}`));
  g.append("text").attr("class", "axis-title").attr("text-anchor", "middle")
    .attr("x", iW / 2).attr("y", iH + 36).text("season (postseason)");

  // Left axis — displacement D, in percentile points.
  if (hasD) {
    g.append("g").attr("class", "axis axis-d")
      .call(d3.axisLeft(yD).ticks(6).tickFormat((d) => (d > 0 ? "+" : "") + Math.round(d * 100)));
    g.append("text").attr("class", "axis-title axis-title-d").attr("text-anchor", "middle")
      .attr("transform", `translate(${-42},${iH / 2}) rotate(-90)`).text("avg D (percentile pts)");
  }

  // Right axis — depth ratio R.
  if (hasR) {
    g.append("g").attr("class", "axis axis-r").attr("transform", `translate(${iW},0)`)
      .call(d3.axisRight(yR).ticks(6).tickFormat((d) => `${d.toFixed(2)}×`));
    g.append("text").attr("class", "axis-title axis-title-r").attr("text-anchor", "middle")
      .attr("transform", `translate(${iW + 44},${iH / 2}) rotate(90)`).text("avg R (depth ratio)");
  }

  // Hover: nearest season, showing whichever series are present there.
  const hoverPts = years.map((y, i) => ({ year: y, D: dArr[i] ? dArr[i].v : null, R: rArr[i] ? rArr[i].v : null }))
    .filter((h) => h.D != null || h.R != null);
  const hover = g.append("g").style("display", "none");
  const hLine = hover.append("line").attr("class", "hover-line").attr("y1", 0).attr("y2", iH);
  const hDotD = hover.append("circle").attr("class", "hover-dot").attr("r", 4).style("display", "none");
  const hDotR = hover.append("circle").attr("class", "hover-dot").attr("r", 4).style("display", "none");
  const bisect = d3.bisector((h) => h.year).center;

  g.append("rect").attr("width", iW).attr("height", iH).attr("fill", "none").style("pointer-events", "all")
    .on("mouseenter", () => hover.style("display", null))
    .on("mouseleave", () => { hover.style("display", "none"); tip.style.opacity = 0; })
    .on("mousemove", function (event) {
      const mx = d3.pointer(event, this)[0];
      const h = hoverPts[bisect(hoverPts, x.invert(mx))];
      if (!h) return;
      const px = x(h.year);
      hLine.attr("x1", px).attr("x2", px);
      let ttY = zeroY;
      if (h.D != null) { hDotD.style("display", null).attr("cx", px).attr("cy", yD(h.D)); ttY = yD(h.D); }
      else hDotD.style("display", "none");
      if (h.R != null) { hDotR.style("display", null).attr("cx", px).attr("cy", yR(h.R)); ttY = Math.min(ttY, yR(h.R)); }
      else hDotR.style("display", "none");
      const dRow = h.D != null
        ? `<div class="tt-row">D = <span class="${h.D >= 0 ? "tt-hard" : "tt-easy"}">${h.D >= 0 ? "+" : ""}${(h.D * 100).toFixed(1)} pts</span></div>`
        : "";
      const rRow = h.R != null
        ? `<div class="tt-row">R = <span class="${h.R >= 1 ? "tt-hard" : "tt-easy"}">${h.R.toFixed(2)}×</span> vs world</div>`
        : "";
      tip.innerHTML = `<div class="tt-p">${h.year} postseason</div>${dRow}${rRow}`;
      tip.style.opacity = 1;
      tip.style.left = `${Math.min(m.left + px + 14, width - 190)}px`;
      tip.style.top = `${m.top + ttY - 10}px`;
    });

  if (legendEl) {
    const items = [];
    if (hasD) items.push(`<span><span class="sw" style="background:${D_COLOR}"></span>avg D — displacement (left)</span>`);
    if (hasR) items.push(`<span><span class="sw" style="background:${R_COLOR}"></span>avg R — depth ratio (right)</span>`);
    legendEl.innerHTML = items.join("");
  }
}
