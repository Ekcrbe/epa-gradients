// App orchestration: controls, state, and rendering for the hero view.
import { loadManifest, loadRegion, strengthWindow } from "./data.js";
import { renderHero } from "./hero.js";

const TYPE_LABEL = { district: "Districts", state: "States / provinces", country: "Countries" };
const TYPE_ORDER = ["district", "state", "country"];

const els = {
  region: document.getElementById("region-select"),
  year: document.getElementById("year-range"),
  yearOut: document.getElementById("year-out"),
  pooled: document.getElementById("pooled-toggle"),
  scopeCaption: document.getElementById("scope-caption"),
  title: document.getElementById("hero-title"),
  readout: document.getElementById("hero-readout"),
  chips: document.getElementById("stat-chips"),
  chart: document.getElementById("hero-chart"),
  legend: document.getElementById("hero-legend"),
  status: document.getElementById("app-status"),
  stamp: document.getElementById("build-stamp"),
};

const state = { regionId: null, year: 2027, pooled: false };
let manifest = null;
let currentRegion = null;

init().catch((err) => { els.status.textContent = `Failed to load data: ${err.message}`; });

async function init() {
  manifest = await loadManifest();
  buildRegionOptions();
  if (manifest.build?.generated) {
    els.stamp.textContent = `Built ${manifest.build.generated.slice(0, 10)} · commit ${String(manifest.build.csv_commit).slice(0, 7)}.`;
  }
  state.regionId = manifest.regions[0].id;
  els.region.value = state.regionId;
  wireEvents();
  await update();
}

function buildRegionOptions() {
  const byType = new Map(TYPE_ORDER.map((t) => [t, []]));
  for (const r of manifest.regions) (byType.get(r.type) || byType.set(r.type, []).get(r.type)).push(r);
  els.region.innerHTML = "";
  for (const t of TYPE_ORDER) {
    const list = byType.get(t) || [];
    if (!list.length) continue;
    const og = document.createElement("optgroup");
    og.label = TYPE_LABEL[t] || t;
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
  els.region.addEventListener("change", async () => {
    state.regionId = els.region.value;
    await update();
  });
  els.year.addEventListener("input", () => {
    state.year = +els.year.value;
    els.yearOut.textContent = els.year.value;
    if (!state.pooled) render();
  });
  els.pooled.addEventListener("change", () => {
    state.pooled = els.pooled.checked;
    els.year.disabled = state.pooled;
    render();
  });
  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => render(), 150); });
}

function scopeKey() { return state.pooled ? "pooled" : String(state.year); }

async function update() {
  currentRegion = await loadRegion(state.regionId);
  // Constrain the slider to seasons this region actually has.
  const years = currentRegion.years || [];
  if (years.length) {
    const lo = years[0], hi = years[years.length - 1];
    els.year.min = lo; els.year.max = hi;
    if (state.year < lo) state.year = lo;
    if (state.year > hi) state.year = hi;
    els.year.value = state.year;
    els.yearOut.textContent = state.year;
  }
  render();
}

function scopeLabel() {
  if (state.pooled) return "pooled — all seasons 2009–2027";
  const win = strengthWindow(state.year, manifest.model?.skip_years);
  return `${state.year} preseason · form from ${win[0]}–${win[win.length - 1]}`;
}

function render() {
  const region = currentRegion;
  if (!region) return;
  const scope = scopeKey();
  const sc = region.scopes[scope];

  els.scopeCaption.textContent = state.pooled ? "(all-time)" : "(preseason)";
  els.title.textContent = `${region.name} vs. the world`;

  if (!sc) {
    els.chart.innerHTML = `<div class="empty-state">${region.name} has no teams in ${state.year}.<br>Available: ${region.years[0]}–${region.years[region.years.length - 1]}.</div>`;
    els.chips.innerHTML = "";
    els.legend.innerHTML = "";
    els.readout.textContent = "";
    els.status.textContent = "";
    return;
  }

  els.readout.textContent = `${scopeLabel()}. ${describe(sc)}`;
  renderChips(sc);
  renderLegend(sc);
  renderHero(els.chart, manifest, region, scope);
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
    const highHarder = D[n - 1] + D[n - 2] > 0;
    return highHarder
      ? `Easier than the world for lower-skill teams but harder for elite teams — the flip is near the ${xp}th percentile.`
      : `Harder than the world for lower-skill teams but easier for elite teams — the flip is near the ${xp}th percentile.`;
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

function chip(k, v, cls = "") {
  return `<div class="chip ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}

function renderLegend(sc) {
  const items = [
    `<span><span class="sw" style="background:var(--harder);opacity:.55"></span>harder than world</span>`,
    `<span><span class="sw" style="background:var(--easier);opacity:.55"></span>easier than world</span>`,
  ];
  if (sc.band_lo) items.push(`<span><span class="sw" style="background:var(--band);opacity:.35"></span>95% bootstrap band</span>`);
  if (sc.crossover != null) items.push(`<span><span class="sw-cross"></span>crossover</span>`);
  els.legend.innerHTML = items.join("");
}
