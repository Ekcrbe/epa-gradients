// Small-multiples grid: one mini D(p) panel per region, shared identical axes,
// diverging fill around a zero line. Click a panel to focus it in the hero.

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function miniSvg(r, pc, M) {
  const W = 176, H = 62, zeroY = H / 2;
  const y = (v) => {
    const c = Math.max(-M, Math.min(M, v));
    return ((M - c) / (2 * M)) * H;
  };
  const px = (i) => (i / (pc.length - 1)) * W;
  const pts = r.D_coarse.map((v, i) => `${px(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = "M" + pts.join(" L ");
  const area = `M0,${zeroY} L ${pts.join(" L ")} L ${W},${zeroY} Z`;
  const uid = r.id.replace(/[^a-z0-9]/gi, "");
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

export function renderSmallMultiples(el, { manifest, rows, M, selectedId, onSelect }) {
  el.innerHTML = "";
  if (!rows.length) { el.innerHTML = `<div class="empty-state small">No regions meet the current filter.</div>`; return; }
  const pc = manifest.grid.p_coarse;
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    // Headline metric = mean survival ratio (the All Regions sort key), so the
    // number shown matches the ordering. The mini-curve still shows the D_local
    // profile (where within the region it is harder / easier).
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
      miniSvg(r, pc, M);
    frag.appendChild(card);
  }
  el.appendChild(frag);
}
