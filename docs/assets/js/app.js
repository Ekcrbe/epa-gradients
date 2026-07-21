// App orchestration: controls, state, and rendering for all views.
import { loadManifest, loadSummary, loadRegion, strengthWindow } from "./data.js";
import { renderHero } from "./hero.js";
import { renderHeatmap } from "./heatmap.js";
import { renderSmallMultiples } from "./smallmultiples.js";
import { renderSurvival } from "./survival.js";
import { renderSlope } from "./slope.js";
import { renderStrength } from "./strength.js";
import { renderComparison } from "./comparison.js";
import { localDisplacementCurve, survivalPRange } from "./curves.js";
import { divergingColor } from "./theme.js";
import { METRICS } from "./metrics.js";

const TYPE_LABEL = { district: "Districts", state: "States / provinces", country: "Countries" };
const TYPE_ORDER = ["district", "state", "country"];

// Sorts shared by both All Regions blocks. "mean_*" ranks by the block's own
// metric; regions with no computable mean (too little tail depth) fall back to
// its neutral value, so they land in the middle rather than at either end.
const SORTS = {
  mean_desc: (m) => (a, b) => (m.mean(b) ?? m.center) - (m.mean(a) ?? m.center),
  mean_asc: (m) => (a, b) => (m.mean(a) ?? m.center) - (m.mean(b) ?? m.center),
  top_desc: () => (a, b) => b.top_heaviness - a.top_heaviness,
  n_desc: () => (a, b) => b.n - a.n,
};

const els = {
  region: document.getElementById("region-select"),
  year: document.getElementById("year-range"),
  yearOut: document.getElementById("year-out"),
  pooled: document.getElementById("pooled-toggle"),
  single: document.getElementById("single-toggle"),
  scopeCaption: document.getElementById("scope-caption"),
  title: document.getElementById("hero-title"),
  readout: document.getElementById("hero-readout"),
  chips: document.getElementById("stat-chips"),
  chart: document.getElementById("hero-chart"),
  legend: document.getElementById("hero-legend"),
  status: document.getElementById("app-status"),
  stamp: document.getElementById("build-stamp"),
  survivalSub: document.getElementById("survival-sub"),
  survivalChips: document.getElementById("survival-chips"),
  survivalChart: document.getElementById("survival-chart"),
  survivalLegend: document.getElementById("survival-legend"),
  survivalXMode: document.getElementById("survival-xmode"),
  slopeSub: document.getElementById("slope-sub"),
  slopeChips: document.getElementById("slope-chips"),
  slopeChart: document.getElementById("slope-chart"),
  slopeLegend: document.getElementById("slope-legend"),
  slopeNote: document.getElementById("slope-note"),
  slopeXMode: document.getElementById("slope-xmode"),
  slopeWeighted: document.getElementById("slope-weighted"),
  strengthSub: document.getElementById("strength-sub"),
  strengthChart: document.getElementById("strength-chart"),
  strengthLegend: document.getElementById("strength-legend"),
  cmpRegion1: document.getElementById("cmp-region1"),
  cmpRegion2: document.getElementById("cmp-region2"),
  cmpChart: document.getElementById("cmp-chart"),
};

const state = {
  regionId: null, year: 2026, pooled: false, single: false,
  cmpRegion1: null, cmpRegion2: null, survivalX: "epa", slopeX: "epa", slopeWeighted: false,
};
let manifest = null, summary = null, currentRegion = null;

// One All Regions block per metric: same heatmap + small-multiples pair, each
// over its own metric and with its own sort / min-n / view state.
const allRegions = [
  makeAllRegions("d", METRICS.D, ".hero"),
  makeAllRegions("r", METRICS.R, ".survival"),
  // Follows the section's weighting toggle, so the metric is resolved per render.
  makeAllRegions("s", () => (state.slopeWeighted ? METRICS.SW : METRICS.S), ".slope"),
];
const renderAllRegions = () => { for (const b of allRegions) b.render(); };

init().catch((err) => { els.status.textContent = `Failed to load data: ${err.message}`; });

async function init() {
  [manifest, summary] = await Promise.all([loadManifest(), loadSummary()]);
  buildRegionOptions();
  if (manifest.build?.generated) {
    els.stamp.textContent = `Built ${manifest.build.generated.slice(0, 10)} · commit ${String(manifest.build.csv_commit).slice(0, 7)}.`;
  }
  wireEvents();
  state.cmpRegion1 = manifest.regions[0].id;
  state.cmpRegion2 = manifest.regions[1]?.id || manifest.regions[0].id;
  els.cmpRegion1.value = state.cmpRegion1;
  els.cmpRegion2.value = state.cmpRegion2;
  await selectRegion(manifest.regions[0].id, null);
  await renderCompare();
}

function populateRegionSelect(selectEl) {
  const byType = new Map(TYPE_ORDER.map((t) => [t, []]));
  for (const r of manifest.regions) byType.get(r.type)?.push(r);
  selectEl.innerHTML = "";
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
    selectEl.appendChild(og);
  }
}

function buildRegionOptions() {
  populateRegionSelect(els.region);
  populateRegionSelect(els.cmpRegion1);
  populateRegionSelect(els.cmpRegion2);
}

function wireEvents() {
  els.region.addEventListener("change", () => selectRegion(els.region.value, null));
  els.year.addEventListener("input", () => {
    state.year = +els.year.value;
    els.yearOut.textContent = els.year.value;
    if (!state.pooled) { renderSelected(); renderAllRegions(); renderCompare(); }
  });
  els.pooled.addEventListener("change", () => {
    state.pooled = els.pooled.checked;
    els.year.disabled = state.pooled;
    syncSingleControl();
    renderSelected(); renderAllRegions(); renderCompare();
  });
  els.single.addEventListener("change", () => {
    state.single = els.single.checked;
    renderSelected(); renderAllRegions(); renderCompare();
  });
  // Affects only the depth-ratio curve's x mapping, so nothing else re-renders.
  els.survivalXMode.addEventListener("change", () => {
    state.survivalX = els.survivalXMode.checked ? "pct" : "epa";
    renderSelected();
  });
  els.slopeXMode.addEventListener("change", () => {
    state.slopeX = els.slopeXMode.checked ? "pct" : "epa";
    renderSelected();
  });
  // Weighting drives both the curve and this section's All Regions block.
  els.slopeWeighted.addEventListener("change", () => {
    state.slopeWeighted = els.slopeWeighted.checked;
    renderSelected(); renderAllRegions();
  });
  els.cmpRegion1.addEventListener("change", () => { state.cmpRegion1 = els.cmpRegion1.value; renderCompare(); });
  els.cmpRegion2.addEventListener("change", () => { state.cmpRegion2 = els.cmpRegion2.value; renderCompare(); });
  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { renderSelected(); renderAllRegions(); renderCompare(); }, 160); });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener?.("change", () => { renderSelected(); renderAllRegions(); renderCompare(); });
}

function scopeKey() {
  const base = state.pooled ? "pooled" : String(state.year);
  // All-time (pooled) mode forces single-year EPA: applying the 4-year WMA and
  // then pooling every year would multiply-count the middle seasons of each
  // window relative to the first/last, which isn't statistically justified.
  return `${base}:${state.pooled || state.single ? "single" : "wma"}`;
}

function syncSingleControl() {
  if (state.pooled) { els.single.checked = true; els.single.disabled = true; }
  else { els.single.disabled = false; els.single.checked = state.single; }
}

// scrollTo: the element to bring into view, or null to leave the scroll
// position alone. Selecting from an All Regions block scrolls to that section's
// own selected-region plot, not across sections.
async function selectRegion(id, scrollTo) {
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
  if (scrollTo) scrollTo.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scopeLabel() {
  if (state.pooled) return "pooled — all postseasons 2008–2026 · single-year EPA";
  if (state.single) return `${state.year} postseason · single-year EPA`;
  const win = strengthWindow(state.year, manifest.model?.skip_years);
  return `${state.year} postseason · WMA of ${win[0]}–${win[win.length - 1]}`;
}

// --- selected-region views (hero + survival) ---
function renderSelected() {
  const region = currentRegion;
  if (!region) return;
  const scope = scopeKey();
  const sc = region.scopes[scope];
  els.scopeCaption.textContent = state.pooled ? "(all-time)" : "(postseason)";
  els.title.textContent = `${region.name} vs. the world`;
  els.survivalSub.textContent = `${region.name} · ${state.pooled ? "pooled" : state.year}`;
  els.slopeSub.textContent = `${region.name} · ${state.pooled ? "pooled" : state.year}`;
  els.slopeNote.innerHTML = slopeNote();

  // Strength-over-time spans every postseason regardless of the selected
  // season, so it renders before the (season-specific) empty-state return.
  // It follows the single-year EPA toggle (wma <-> single) like everything else.
  const strengthMode = state.pooled || state.single ? "single" : "wma";
  els.strengthSub.textContent = `${region.name} · all postseasons · ${strengthMode === "single" ? "single-year EPA" : "4-year WMA"}`;
  renderStrength(els.strengthChart, els.strengthLegend, manifest, region, strengthMode);

  if (!sc) {
    const rc = manifest.regions_config || {};
    const inScGap = region.id === rc.sc_gap_region && !state.pooled
      && (rc.sc_gap_years || []).includes(state.year);
    const canceled = (manifest.model?.skip_years || []).includes(state.year);
    const span = `${region.years[0]}–${region.years[region.years.length - 1]}`;
    let msg;
    if (inScGap) {
      const redirect = manifest.regions.find((r) => r.id === rc.sc_gap_redirect);
      msg = `South Carolina competed as part of the ${redirect ? redirect.name : "Peachtree"} district in ${state.year}.<br>Select <strong>${redirect ? redirect.name : "Peachtree"}</strong> from the region list to see this season.`;
    } else if (canceled) {
      msg = `The ${state.year} season was canceled — no snapshot.`;
    } else {
      msg = `${region.name} has no teams in ${state.year}.<br>Available: ${span}.`;
    }
    els.chart.innerHTML = `<div class="empty-state">${msg}</div>`;
    els.survivalChart.innerHTML = ""; els.survivalLegend.innerHTML = ""; els.survivalChips.innerHTML = "";
    els.slopeChart.innerHTML = ""; els.slopeLegend.innerHTML = ""; els.slopeChips.innerHTML = "";
    els.chips.innerHTML = ""; els.legend.innerHTML = ""; els.readout.textContent = ""; els.status.textContent = "";
    return;
  }
  const qFine = (manifest.globals[scope] || {}).q_fine || [];
  const D = localDisplacementCurve(sc.q_local, qFine, manifest.grid.p_fine);
  els.readout.textContent = `${scopeLabel()}. ${describe(D)}`;
  renderChips(sc);
  renderSurvivalChips(sc);
  renderSlopeChips(sc);
  renderLegend(sc);
  renderHero(els.chart, manifest, region, scope);
  renderSurvival(els.survivalChart, els.survivalLegend, manifest, region, scope, state.survivalX);
  renderSlope(els.slopeChart, els.slopeLegend, manifest, region, scope, state.slopeX, state.slopeWeighted);
  els.status.textContent = sc.band_local_lo ? "" : `Small sample (n=${sc.n}) — no bootstrap band shown; interpret the curve cautiously.`;
}

function describe(D) {
  let pos = 0;
  for (const v of D) if (v > 0) pos++;
  const frac = pos / D.length;
  if (frac > 0.85) return "Locally harder than the world across nearly all of its teams.";
  if (frac < 0.15) return "Locally easier than the world across nearly all of its teams.";
  return "A mix of locally harder and easier standing across the region.";
}

function renderChips(sc) {
  const md = sc.mean_D_local * 100;
  const cls = sc.mean_D_local > 0 ? "harder" : "easier";
  els.chips.innerHTML =
    chip("teams (n)", sc.n) +
    chip("avg vs world", `${md > 0 ? "+" : ""}${md.toFixed(1)}`, cls);
}

function renderSurvivalChips(sc) {
  if (!els.survivalChips) return;
  const r = sc.mean_R;
  const cls = r != null ? (r >= 1 ? "harder" : "easier") : "";
  els.survivalChips.innerHTML =
    chip("teams (n)", sc.n) +
    chip("avg R", r != null ? `${r.toFixed(2)}×` : "—", cls);
}

function renderSlopeChips(sc) {
  if (!els.slopeChips) return;
  const v = state.slopeWeighted ? sc.mean_slope_wt : sc.mean_slope;
  const cls = v != null ? (v >= 1 ? "harder" : "easier") : "";
  els.slopeChips.innerHTML =
    chip("teams (n)", sc.n) +
    chip(state.slopeWeighted ? "avg S×R" : "avg S", v != null ? `${v.toFixed(2)}×` : "—", cls);
}

// The two forms measure different things, so the explainer swaps with the toggle.
function slopeNote() {
  if (state.slopeWeighted) {
    return "Now weighted by the depth ratio, which makes this the ratio of the areas under the two survival curves to the right of each cutoff &mdash; the <em>total</em> excess strength above that level per team, counting both how many teams are above it and how far above they sit. " +
      "<span class=\"k-hard\">Above 1&times;</span> there is more strength stacked above that level than worldwide; <span class=\"k-easy\">below</span>, less.";
  }
  return "For each skill level, how far above it the teams that beat it actually sit &mdash; the region&rsquo;s mean gap divided by the world&rsquo;s. " +
    "<span class=\"k-hard\">Above 1&times;</span> the climb is steeper than the world&rsquo;s: the teams ahead are further ahead. <span class=\"k-easy\">Below</span>, they&rsquo;re bunched closer in, so a small gain in EPA moves you past more of them. " +
    "This is independent of <em>how many</em> teams are above you &mdash; that&rsquo;s the depth ratio.";
}

const chip = (k, v, cls = "") => `<div class="chip ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;

function renderLegend(sc) {
  const items = [
    `<span><span class="sw" style="background:var(--harder);opacity:.55"></span>harder than world</span>`,
    `<span><span class="sw" style="background:var(--easier);opacity:.55"></span>easier than world</span>`,
  ];
  if (sc.band_local_lo) items.push(`<span><span class="sw" style="background:var(--band);opacity:.35"></span>95% bootstrap band</span>`);
  if (sc.mean_D_local != null) items.push(`<span><span class="sw-avg"></span>avg D</span>`);
  els.legend.innerHTML = items.join("");
}

// --- all-regions views (heatmap / small multiples) ---
function buildRows(scope) {
  const rows = [];
  for (const meta of manifest.regions) {
    const s = summary.regions[meta.id]?.scopes?.[scope];
    if (!s) continue;
    // In pooled mode, s.n is a sum across every postseason the region has --
    // a region active many years accumulates a large total even with few
    // teams per year. Use the average per-year n instead, so the min-n filter
    // (and the displayed count) reflect a typical season, not the year count.
    const yearsCount = Math.max(1, (meta.years || []).length);
    const n = state.pooled ? Math.round(s.n / yearsCount) : s.n;
    rows.push({ id: meta.id, name: meta.name, type: meta.type, ...s, n });
  }
  return rows;
}

// The x-grid each metric's coarse sparkline is sampled on (see
// pipeline/metrics.py): D over regional percentiles, R over the trustworthy
// worldwide-percentile band, which narrows in thin seasons.
function heatmapAxis(metric, scope) {
  if (metric.id === "D") {
    const pc = manifest.grid.p_coarse;
    return { domain: [0, 1], columns: () => pc, title: "team standing — regional percentile" };
  }
  const [lo, hi] = survivalPRange(manifest.survival, (manifest.globals[scope] || {}).n || 1);
  return {
    domain: [lo, hi],
    columns: (n) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1)),
    title: "team strength — worldwide percentile",
  };
}

// focusSelector: the selected-region plot in this block's own section, scrolled
// to when a row or panel is clicked.
function makeAllRegions(prefix, metric, focusSelector) {
  const el = (suffix) => document.getElementById(`${prefix}-${suffix}`);
  const focusEl = document.querySelector(focusSelector);
  const onSelect = (id) => selectRegion(id, focusEl);
  // A block's metric may depend on section state, so allow a getter.
  const getMetric = typeof metric === "function" ? metric : () => metric;
  const ui = {
    sort: el("sort-select"), minn: el("minn-range"), minnOut: el("minn-out"),
    count: el("ar-count"), legend: el("hm-legend"),
    viewHeatmap: el("view-heatmap"), viewGrid: el("view-grid"),
    heatmap: el("heatmap"), sm: el("smallmultiples"),
  };
  const own = { sort: "mean_desc", minN: +ui.minn.value, view: "heatmap" };

  function setView(v) {
    own.view = v;
    const grid = v === "grid";
    ui.viewGrid.classList.toggle("active", grid);
    ui.viewHeatmap.classList.toggle("active", !grid);
    ui.viewGrid.setAttribute("aria-pressed", grid);
    ui.viewHeatmap.setAttribute("aria-pressed", !grid);
    ui.sm.hidden = !grid;
    ui.heatmap.hidden = grid;
    render();
  }

  function render() {
    if (!summary) return;
    const metric = getMetric();
    const scope = scopeKey();
    const all = buildRows(scope);
    const rows = all.filter((r) => r.n >= own.minN).sort(SORTS[own.sort](metric));
    const nLabel = state.pooled ? `avg n/yr ≥ ${own.minN}` : `n ≥ ${own.minN}`;
    ui.count.textContent = `${rows.length} of ${all.length} regions · ${nLabel} · ${state.pooled ? "pooled" : state.year}`;
    const M = metric.colorDomain(rows.length ? rows : all);
    renderLegendBar(ui.legend, metric, M);
    const opts = { manifest, rows, metric, axis: heatmapAxis(metric, scope), M, selectedId: state.regionId, onSelect };
    if (own.view === "grid") renderSmallMultiples(ui.sm, opts);
    else renderHeatmap(ui.heatmap, opts);
  }

  ui.sort.addEventListener("change", () => { own.sort = ui.sort.value; render(); });
  ui.minn.addEventListener("input", () => { own.minN = +ui.minn.value; ui.minnOut.textContent = ui.minn.value; render(); });
  ui.viewHeatmap.addEventListener("click", () => setView("heatmap"));
  ui.viewGrid.addEventListener("click", () => setView("grid"));

  return { render };
}

// --- region comparison ---
async function renderCompare() {
  if (!state.cmpRegion1 || !state.cmpRegion2 || !manifest) return;
  const [r1, r2] = await Promise.all([loadRegion(state.cmpRegion1), loadRegion(state.cmpRegion2)]);
  renderComparison(els.cmpChart, manifest, r1, r2, scopeKey());
}

// M is a half-width in the metric's transformed space, so the ramp is symmetric
// for both (linear points for D, a multiplicative factor for R).
function renderLegendBar(el, metric, M) {
  const neg = divergingColor(-M, M), mid = divergingColor(0, M), pos = divergingColor(M, M);
  el.innerHTML =
    `<span class="hm-leg-lab easy">easier</span>` +
    `<span class="hm-leg-bar" style="background:linear-gradient(90deg,${neg},${mid},${pos})"></span>` +
    `<span class="hm-leg-lab hard">harder</span>` +
    `<span class="hm-leg-scale">${metric.legendScale(M)}</span>`;
}
