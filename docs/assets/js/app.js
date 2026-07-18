// App orchestration: controls, state, and rendering for all views.
import { loadManifest, loadSummary, loadRegion, strengthWindow } from "./data.js";
import { renderHero } from "./hero.js";
import { renderHeatmap } from "./heatmap.js";
import { renderSmallMultiples } from "./smallmultiples.js";
import { renderSurvival } from "./survival.js";
import { divergingColor } from "./theme.js";
import { ordinal } from "./format.js";

const TYPE_LABEL = { district: "Districts", state: "States / provinces", country: "Countries" };
const TYPE_ORDER = ["district", "state", "country"];

// Regions with no easier→harder crossing get a sentinel: harder-everywhere
// sorts to the "flips early" (hard) end, easier-everywhere to the far end.
const effCross = (r) => (r.crossover != null ? r.crossover : (r.mean_D > 0 ? -1 : 2));
const SORTS = {
  meanD_desc: (a, b) => b.mean_D - a.mean_D,
  meanD_asc: (a, b) => a.mean_D - b.mean_D,
  crossover_asc: (a, b) => effCross(a) - effCross(b),
  top_desc: (a, b) => b.top_heaviness - a.top_heaviness,
  n_desc: (a, b) => b.n - a.n,
};

const els = {
  region: document.getElementById("region-select"),
  year: document.getElementById("year-range"),
  yearOut: document.getElementById("year-out"),
  pooled: document.getElementById("pooled-toggle"),
  scopeCaption: document.getElementById("scope-caption"),
  hero: document.querySelector(".hero"),
  title: document.getElementById("hero-title"),
  readout: document.getElementById("hero-readout"),
  chips: document.getElementById("stat-chips"),
  chart: document.getElementById("hero-chart"),
  legend: document.getElementById("hero-legend"),
  status: document.getElementById("app-status"),
  stamp: document.getElementById("build-stamp"),
  survivalSub: document.getElementById("survival-sub"),
  survivalChart: document.getElementById("survival-chart"),
  sort: document.getElementById("sort-select"),
  minn: document.getElementById("minn-range"),
  minnOut: document.getElementById("minn-out"),
  arCount: document.getElementById("ar-count"),
  hmLegend: document.getElementById("hm-legend"),
  viewHeatmap: document.getElementById("view-heatmap"),
  viewGrid: document.getElementById("view-grid"),
  heatmap: document.getElementById("heatmap"),
  sm: document.getElementById("smallmultiples"),
};

const state = { regionId: null, year: 2027, pooled: false, sort: "meanD_desc", minN: 20, view: "heatmap" };
let manifest = null, summary = null, currentRegion = null;

init().catch((err) => { els.status.textContent = `Failed to load data: ${err.message}`; });

async function init() {
  [manifest, summary] = await Promise.all([loadManifest(), loadSummary()]);
  buildRegionOptions();
  if (manifest.build?.generated) {
    els.stamp.textContent = `Built ${manifest.build.generated.slice(0, 10)} · commit ${String(manifest.build.csv_commit).slice(0, 7)}.`;
  }
  wireEvents();
  await selectRegion(manifest.regions[0].id, false);
}

function buildRegionOptions() {
  const byType = new Map(TYPE_ORDER.map((t) => [t, []]));
  for (const r of manifest.regions) byType.get(r.type)?.push(r);
  els.region.innerHTML = "";
  for (const t of TYPE_ORDER) {
    const list = byType.get(t) || [];
    if (!list.length) continue;
    const og = document.createElement("optgroup");
    og.label = TYPE_LABEL[t];
    for (const r of list) {
      const o = document.createElement("option");
      o.value = r.id;
      o.textContent = `${r.name} (n=${r.n_latest ?? r.n_pooled ?? "?"})`;
      og.appendChild(o);
    }
    els.region.appendChild(og);
  }
}

function wireEvents() {
  els.region.addEventListener("change", () => selectRegion(els.region.value, false));
  els.year.addEventListener("input", () => {
    state.year = +els.year.value;
    els.yearOut.textContent = els.year.value;
    if (!state.pooled) { renderSelected(); renderAllRegions(); }
  });
  els.pooled.addEventListener("change", () => {
    state.pooled = els.pooled.checked;
    els.year.disabled = state.pooled;
    renderSelected(); renderAllRegions();
  });
  els.sort.addEventListener("change", () => { state.sort = els.sort.value; renderAllRegions(); });
  els.minn.addEventListener("input", () => {
    state.minN = +els.minn.value; els.minnOut.textContent = els.minn.value; renderAllRegions();
  });
  els.viewHeatmap.addEventListener("click", () => setView("heatmap"));
  els.viewGrid.addEventListener("click", () => setView("grid"));
  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { renderSelected(); renderAllRegions(); }, 160); });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener?.("change", () => { renderSelected(); renderAllRegions(); });
}

function setView(v) {
  state.view = v;
  const grid = v === "grid";
  els.viewGrid.classList.toggle("active", grid);
  els.viewHeatmap.classList.toggle("active", !grid);
  els.viewGrid.setAttribute("aria-pressed", grid);
  els.viewHeatmap.setAttribute("aria-pressed", !grid);
  els.sm.hidden = !grid;
  els.heatmap.hidden = grid;
  renderAllRegions();
}

function scopeKey() { return state.pooled ? "pooled" : String(state.year); }

async function selectRegion(id, scroll) {
  state.regionId = id;
  if (els.region.value !== id) els.region.value = id;
  currentRegion = await loadRegion(id);
  const years = currentRegion.years || [];
  if (years.length) {
    els.year.min = years[0]; els.year.max = years[years.length - 1];
    state.year = Math.min(Math.max(state.year, years[0]), years[years.length - 1]);
    els.year.value = state.year; els.yearOut.textContent = state.year;
  }
  renderSelected();
  renderAllRegions();
  if (scroll) els.hero.scrollIntoView({ behavior: "smooth", block: "start" });
}
const onSelect = (id) => selectRegion(id, true);

function scopeLabel() {
  if (state.pooled) return "pooled — all seasons 2009–2027";
  const win = strengthWindow(state.year, manifest.model?.skip_years);
  return `${state.year} preseason · form from ${win[0]}–${win[win.length - 1]}`;
}

// --- selected-region views (hero + survival) ---
function renderSelected() {
  const region = currentRegion;
  if (!region) return;
  const scope = scopeKey();
  const sc = region.scopes[scope];
  els.scopeCaption.textContent = state.pooled ? "(all-time)" : "(preseason)";
  els.title.textContent = `${region.name} vs. the world`;
  els.survivalSub.textContent = `${region.name} · ${state.pooled ? "pooled" : state.year}`;

  if (!sc) {
    const span = `${region.years[0]}–${region.years[region.years.length - 1]}`;
    els.chart.innerHTML = `<div class="empty-state">${region.name} has no teams in ${state.year}.<br>Available: ${span}.</div>`;
    els.survivalChart.innerHTML = "";
    els.chips.innerHTML = ""; els.legend.innerHTML = ""; els.readout.textContent = ""; els.status.textContent = "";
    return;
  }
  els.readout.textContent = `${scopeLabel()}. ${describe(sc)}`;
  renderChips(sc);
  renderLegend(sc);
  renderHero(els.chart, manifest, region, scope);
  renderSurvival(els.survivalChart, region, scope);
  els.status.textContent = sc.band_lo ? "" : `Small sample (n=${sc.n}) — no bootstrap band shown; interpret the curve cautiously.`;
}

function describe(sc) {
  const D = sc.D, n = D.length;
  let pos = 0;
  for (const v of D) if (v > 0) pos++;
  const frac = pos / n;
  if (frac > 0.85) return "Locally harder than the world across nearly all skill levels.";
  if (frac < 0.15) return "Locally easier than the world across nearly all skill levels.";
  if (sc.crossover != null) {
    const xp = Math.round(sc.crossover * 100);
    return D[n - 1] + D[n - 2] > 0
      ? `Easier than the world for lower-skill teams but harder for elite teams — the flip is near the ${ordinal(xp)} percentile.`
      : `Harder than the world for lower-skill teams but easier for elite teams — the flip is near the ${ordinal(xp)} percentile.`;
  }
  return "A mix of locally harder and easier zones across the skill range.";
}

function renderChips(sc) {
  const md = sc.mean_D * 100;
  const cls = sc.mean_D > 0 ? "harder" : "easier";
  const cross = sc.crossover != null ? `p${Math.round(sc.crossover * 100)}` : "—";
  els.chips.innerHTML =
    chip("teams (n)", sc.n) +
    chip("avg vs world", `${md > 0 ? "+" : ""}${md.toFixed(1)}`, cls) +
    chip("crossover", cross);
}
const chip = (k, v, cls = "") => `<div class="chip ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;

function renderLegend(sc) {
  const items = [
    `<span><span class="sw" style="background:var(--harder);opacity:.55"></span>harder than world</span>`,
    `<span><span class="sw" style="background:var(--easier);opacity:.55"></span>easier than world</span>`,
  ];
  if (sc.band_lo) items.push(`<span><span class="sw" style="background:var(--band);opacity:.35"></span>95% bootstrap band</span>`);
  if (sc.crossover != null) items.push(`<span><span class="sw-cross"></span>crossover</span>`);
  els.legend.innerHTML = items.join("");
}

// --- all-regions views (heatmap / small multiples) ---
function buildRows(scope) {
  const rows = [];
  for (const meta of manifest.regions) {
    const s = summary.regions[meta.id]?.scopes?.[scope];
    if (s) rows.push({ id: meta.id, name: meta.name, type: meta.type, ...s });
  }
  return rows;
}

function colorDomain(rows) {
  const vals = [];
  for (const r of rows) for (const v of r.D_coarse) vals.push(Math.abs(v));
  if (!vals.length) return 0.1;
  vals.sort((a, b) => a - b);
  const q = vals[Math.floor(vals.length * 0.92)];
  return Math.max(0.08, Math.min(0.4, Math.ceil(q / 0.02) * 0.02));
}

function renderAllRegions() {
  if (!summary) return;
  const scope = scopeKey();
  const all = buildRows(scope);
  const rows = all.filter((r) => r.n >= state.minN).sort(SORTS[state.sort]);
  els.arCount.textContent = `${rows.length} of ${all.length} regions · n ≥ ${state.minN} · ${state.pooled ? "pooled" : state.year}`;
  const M = colorDomain(rows.length ? rows : all);
  renderLegendBar(M);
  const opts = { manifest, rows, M, selectedId: state.regionId, onSelect };
  if (state.view === "grid") renderSmallMultiples(els.sm, opts);
  else renderHeatmap(els.heatmap, opts);
}

function renderLegendBar(M) {
  const neg = divergingColor(-M, M), mid = divergingColor(0, M), pos = divergingColor(M, M);
  els.hmLegend.innerHTML =
    `<span class="hm-leg-lab easy">easier</span>` +
    `<span class="hm-leg-bar" style="background:linear-gradient(90deg,${neg},${mid},${pos})"></span>` +
    `<span class="hm-leg-lab hard">harder</span>` +
    `<span class="hm-leg-scale">&plusmn;${Math.round(M * 100)} pts</span>`;
}
