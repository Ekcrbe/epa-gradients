// Small-multiples grid: one mini panel per region, drawing the section's metric
// (D or R -- see metrics.js) on a domain shared by every visible card so the
// panels stay comparable. Click a panel to focus that region up top.

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Values are plotted in the metric's transformed space (linear for D, log for
// R), so one geometry serves both.
function miniSvg(r, metric, nPts, tMin, tMax) {
  const W = 176, H = 62;
  const y = (t) => ((tMax - Math.max(tMin, Math.min(tMax, t))) / (tMax - tMin)) * H;
  const zeroY = y(metric.t(metric.center));
  const px = (i) => (i / (nPts - 1)) * W;
  const uid = `${metric.id}${r.id.replace(/[^a-z0-9]/gi, "")}`;
  const valid = metric.values(r)
    .map((v, i) => ({ i, t: metric.t(v) }))
    .filter((d) => d.t != null && isFinite(d.t));
  if (valid.length < 2) {
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="sm-svg" aria-hidden="true">
      <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" class="zero-line"/>
    </svg>`;
  }
  const pts = valid.map((d) => `${px(d.i).toFixed(1)},${y(d.t).toFixed(1)}`);
  const line = "M" + pts.join(" L ");
  const area = `M${px(valid[0].i).toFixed(1)},${zeroY} L ${pts.join(" L ")} L ${px(valid[valid.length - 1].i).toFixed(1)},${zeroY} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="sm-svg" aria-hidden="true">
    <defs>
      <clipPath id="u${uid}"><rect x="0" y="0" width="${W}" height="${zeroY}"/></clipPath>
      <clipPath id="d${uid}"><rect x="0" y="${zeroY}" width="${W}" height="${H - zeroY}"/></clipPath>
    </defs>
    <path d="${area}" class="fill-harder" clip-path="url(#u${uid})"/>
    <path d="${area}" class="fill-easier" clip-path="url(#d${uid})"/>
    <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" class="zero-line"/>
    <path d="${line}" class="d-line" style="stroke-width:1.3"/>
  </svg>`;
}

export function renderSmallMultiples(el, { manifest, rows, metric, selectedId, onSelect }) {
  el.innerHTML = "";
  if (!rows.length) { el.innerHTML = `<div class="empty-state small">No regions meet the current filter.</div>`; return; }
  const nPts = manifest.grid.p_coarse.length;
  const [tMin, tMax] = metric.panelDomain(rows);
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const mean = metric.mean(r);
    const cls = mean != null && metric.isHard(mean) ? "hard" : "easy";
    const label = metric.formatMean(mean);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "sm-card" + (r.id === selectedId ? " sel" : "");
    card.setAttribute("aria-label", `${r.name}, n ${r.n}, average ${metric.label} ${label}`);
    card.addEventListener("click", () => onSelect(r.id));
    card.innerHTML =
      `<div class="sm-head"><span class="sm-name">${truncate(r.name, 18)}</span>` +
      `<span class="sm-meta"><span class="${cls}">${label}</span> · n${r.n}</span></div>` +
      miniSvg(r, metric, nPts, tMin, tMax);
    frag.appendChild(card);
  }
  el.appendChild(frag);
}
