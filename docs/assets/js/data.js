// Data layer: loads precomputed JSON artifacts. No runtime API calls.
// Paths are relative to the document, so this works under /epa-gradients/.

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

let _manifest = null;
const _regions = new Map();

export async function loadManifest() {
  if (!_manifest) _manifest = await getJSON("data/manifest.json");
  return _manifest;
}

export async function loadRegion(id) {
  if (!_regions.has(id)) _regions.set(id, await getJSON(`data/regions/${id}.json`));
  return _regions.get(id);
}

// The 4-year strength window for a snapshot season (skip years removed).
export function strengthWindow(year, skipYears) {
  const skip = new Set(skipYears || []);
  const win = [year - 4, year - 3, year - 2, year - 1].filter((y) => !skip.has(y));
  return win;
}
