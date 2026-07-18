// Data layer: loads precomputed JSON artifacts. No runtime API calls.
// Paths are relative to the document, so this works under /epa-gradients/.

async function getJSON(path, tries = 3) {
  // Revalidate so a rebuilt dataset is picked up fresh (a cheap 304 when
  // unchanged). Retry transient failures (e.g. a GitHub Pages CDN 503) with a
  // short backoff so a hiccup doesn't brick the page; 4xx fails fast.
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(path, { cache: "no-cache" });
      if (res.ok) return await res.json();
      if (res.status < 500) throw new Error(`${path}: HTTP ${res.status}`);
      lastErr = new Error(`${path}: HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < tries) await new Promise((r) => setTimeout(r, 350 * attempt));
  }
  throw lastErr;
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
