// Small-multiples grid: one mini survival-ratio R(x) panel per region, sharing
// a log y-domain and a diverging fill around R = 1. Click a panel to focus it
// in the hero. Matches the fact that the headline chip and sort key are both
// the mean survival ratio, not the displacement.

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// A shared log-scale R domain across every visible card, so panels stay
// visually comparable (mirrors survival.js's own per-region yMin/yMax logic).
function rDomain(rows) {
  let min = Infinity, max = -Infinity;
  for (const r of rows) for (const v of r.R_coarse || []) {
    if (v == null || v <= 0) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min)) return [0.5, 2];
  return [Math.min(0.5, min * 0.85), Math.max(2, max * 1.15)];
}

function miniSvg(r, nPts, yMin, yMax) {
  const W = 176, H = 62;
  const logMin = Math.log(yMin), logMax = Math.log(yMax);
  const y = (v) => {
    const c = Math.max(yMin, Math.min(yMax, v));
    return ((logMax - Math.log(c)) / (logMax - logMin)) * H;
  };
  const zeroY = y(1);
  const px = (i) => (i / (nPts - 1)) * W;
  const uid = r.id.replace(/[^a-z0-9]/gi, "");
  const valid = (r.R_coarse || [])
    .map((v, i) => ({ i, v }))
    .filter((d) => d.v != null && d.v > 0);
  if (valid.length < 2) {
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="sm-svg" aria-hidden="true">
      <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" class="zero-line"/>
    </svg>`;
  }
  const pts = valid.map((d) => `${px(d.i).toFixed(1)},${y(d.v).toFixed(1)}`);
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

export function renderSmallMultiples(el, { manifest, rows, selectedId, onSelect }) {
  el.innerHTML = "";
  if (!rows.length) { el.innerHTML = `<div class="empty-state small">No regions meet the current filter.</div>`; return; }
  const nPts = manifest.grid.p_coarse.length;
  const [yMin, yMax] = rDomain(rows);
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const sr = r.mean_survival_R;
    const cls = sr != null && sr >= 1 ? "hard" : "easy";
    const label = sr != null ? `${sr.toFixed(2)}×` : "—";
    const card = document.createElement("button");
    card.type = "button";
    card.className = "sm-card" + (r.id === selectedId ? " sel" : "");
    card.setAttribute("aria-label", `${r.name}, n ${r.n}, average survival ratio ${label}`);
    card.addEventListener("click", () => onSelect(r.id));
    card.innerHTML =
      `<div class="sm-head"><span class="sm-name">${truncate(r.name, 18)}</span>` +
      `<span class="sm-meta"><span class="${cls}">${label}</span> · n${r.n}</span></div>` +
      miniSvg(r, nPts, yMin, yMax);
    frag.appendChild(card);
  }
  el.appendChild(frag);
}
