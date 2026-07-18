// Data layer: loads precomputed JSON artifacts. No runtime API calls.
// Paths are relative to the document, so this works under /epa-gradients/.

async function getJSON(path) {
  // Revalidate so a rebuilt dataset is always picked up fresh (a cheap 304 when
  // unchanged) rather than served stale from cache.
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

let _manifest = null;
let _summary = null;
const _regions = new Map();

export async function loadManifest() {
  if (!_manifest) _manifest = await getJSON("data/manifest.json");
  return _manifest;
}

export async function loadSummary() {
  if (!_summary) _summary = await getJSON("data/summary.json");
  return _summary;
}

export async function loadRegion(id) {
  if (!_regions.has(id)) _regions.set(id, await getJSON(`data/regions/${id}.json`));
  return _regions.get(id);
}

// The 4-year WMA window for a postseason [Y-3 .. Y] with canceled years removed.
export function strengthWindow(year, skipYears) {
  const skip = new Set(skipYears || []);
  return [year - 3, year - 2, year - 1, year].filter((y) => !skip.has(y));
}
