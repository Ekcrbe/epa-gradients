# EPA Gradients

A static, GitHub Pages–hosted visualizer for the FIRST Robotics Competition. For
each region it shows how **locally competitive difficulty compares to the
worldwide baseline as a function of team skill**, using historical
[Statbotics](https://www.statbotics.io/) EPA.

Live site: <https://ekcrbe.github.io/epa-gradients/>

## The idea

EPA (Expected Points Added) is Statbotics' team rating. Using the **unitless**
EPA (an Elo-style, cross-season-comparable scale, ~1500 average), we compare each
region's skill distribution against the worldwide one at every skill level.

**Primary metric — percentile displacement.** With `F_global` the worldwide CDF
of team strength and `Q_region` the region's quantile function, on a
**within-region** percentile axis `q` (a team's standing among its region's
teams):

```
D(q) = F_global( Q_region(q) ) − q
```

`D(q) > 0` → a team at the q-th percentile of its region ranks higher than that
worldwide, i.e. the region is locally *harder* (deeper); `D(q) < 0` → *easier*.
The zero-crossing is where a region flips from easier to harder. (A
worldwide-percentile variant, `p − F_region(Q_global(p))`, is still computed and
retained in the per-region data files.) A secondary **survival ratio**
`R(x) = (1 − F_region(x)) / (1 − F_global(x))` (log axis, tail-capped) probes the
elite tail where percentile differences compress.

Snapshots are labeled by **postseason** year (2008–2026): the competitive state
after that season. A region's teams are those that *competed in that season*, so
`n` reflects current depth rather than long-defunct teams. Each team's strength
is a linear-recency **weighted moving average** (weights 4:3:2:1) of its unitless
EPA over the four most recent seasons up to and including that one — or, via a
toggle, that season's EPA alone. The canceled 2020/2021 seasons are dropped from
every window and produce no snapshot.

## Architecture

Two clean layers:

1. **Offline Python pipeline** (`pipeline/`) — fetches EPA, assigns regions,
   computes WMA strengths, CDFs, `D(p)`, survival ratios, summary stats, and
   bootstrap confidence bands, then writes static JSON into `docs/data/`.
2. **Static frontend** (`docs/`) — vanilla HTML/CSS/JS + vendored D3. Reads only
   the precomputed JSON; **never** calls an API at runtime (no CORS, rate limits,
   or runtime failures).

All EPA fetching happens once and is cached under `data/raw/`, so the statistics
and the site can be iterated without re-hitting any API.

## The site

The page is organized into four sections, each with its own metric, plus the
methodology at the bottom.

**Displacement**

- **Hero displacement curve** — `D(p)` for a selected region and season (or
  pooled): a bold zero line, diverging shading (harder above, easier below), a
  95% bootstrap band, the zero-crossing marker, and a hover readout. Small
  samples (n < 5) omit the band.
- **All regions — displacement** — a **diverging heatmap** (rows = regions,
  columns = regional skill-percentile bins) plus a **small-multiples** grid of
  mini `D(p)` panels on shared axes, sorted by average `D` by default.

**Depth ratio**

- **Depth ratio curve** — `R(x)` on a log axis for the selected region.
- **All regions — depth ratio** — the same heatmap and small-multiples pair over
  `R` instead, on the worldwide-percentile band `R` is trustworthy over and
  colored on `log R` so `2×` and `½×` sit equally far from neutral, sorted by
  average `R` by default.

All three All Regions blocks share the same controls (sort by the block's own mean,
top-heaviness, or team count; filter by minimum `n`; toggle heatmap vs. small
multiples) and keep independent state; click any row or panel to focus that
region.

**Slope of difficulty**

- **Slope curve** — `S(x) = e_region(x) / e_global(x)`, where `e(x) = E[X − x | X > x]`
  is the mean excess: not how many teams are above the cutoff, but how far above
  they sit. Above 1 the climb is steeper than the world's (the teams ahead are
  further ahead); below 1 they're bunched closer in. A toggle multiplies by the
  survival ratio, which by `∫ₓ^∞(1−F) = (1−F(x))·e(x)` gives the ratio of the
  areas under the two survival curves right of `x` — total excess strength above
  `x` per team. Both share the depth-ratio plot's x-axis toggle.
- **All regions — slope of difficulty** — the heatmap and small-multiples pair
  over `S`, following the same weighting toggle. Cells are blank where the region
  has nobody above that cutoff — there is no gap to measure.

**Comparisons**

- **Strength over time** — a per-season time series for the selected region:
  average `D` (left axis) and average `R` (right axis) as solid dots joined by
  straight segments, with `D = 0` and `R = 1` sharing the zero line. Spans the
  full postseason range regardless of the season slider; the single-year EPA
  toggle still switches the strength model. The canceled 2020–21 seasons are
  bridged (2019 joins straight to 2022); any other season the region fielded no
  teams breaks the line.
- **Region comparison** — the percentile a given EPA lands at in one region
  plotted against where it lands in another.

**Methodology** — an in-page explainer of the metric, strength model, region
rules, and uncertainty.

Frontend modules live in `docs/assets/js/` (`app.js`, `data.js`, `hero.js`,
`heatmap.js`, `smallmultiples.js`, `metrics.js`, `ratiocurve.js`, `survival.js`,
`slope.js`, `strength.js`, `comparison.js`, `theme.js`). `metrics.js` holds the
`D`/`R`/`S` descriptors that parameterize the All Regions blocks, and
`ratiocurve.js` is the shared renderer behind the depth-ratio and slope curves.
D3 is vendored at `docs/assets/vendor/d3.v7.min.js`.

## Data sources

- **≤ 2023:** the `v3/team_years.csv` table from a pinned commit of
  [`avgupta456/statbotics-csvs`](https://github.com/avgupta456/statbotics-csvs)
  (has `unitless_epa` back to 2002).
- **2024–2026:** the Statbotics mirror API
  (`https://api-statbotics.iterativerefinement.com/v3`), paginated and cached.
  2024 is taken from the API rather than the pinned CSV because that commit's
  2024 EPAs were still mid-season and compressed toward the mean.
- **California team locations:** [The Blue Alliance](https://www.thebluealliance.com/)
  `/team/{key}` endpoint, used only to split the California district into
  "Northern California" / "Southern California" at 35.789°N (see
  `pipeline/regions.py` / `pipeline/tba.py`). TBA's own `lat`/`lng` team
  fields are no longer populated, so each team's location is resolved via
  `pipeline/geocode.py` in two tiers: first `postal_code` against the US
  Census Bureau's 2023 Gazetteer ZCTA file, then -- for the many teams TBA
  has no postal code for -- `city` against the Gazetteer's California
  places file (both cached to `data/raw/*_centroids.csv`). Requires a
  `config/tba_key.txt` API key (gitignored, never committed); raw results
  are cached to `data/raw/tba_ca_locations.json`. Every team's resolved
  location + assigned region is written to `data/review/ca_team_locations.csv`
  for a human to spot-check; any team still unresolved is listed in
  `data/review/ca_unmapped_teams.csv`. `config/ca_overrides.csv` always
  wins over the automated result, for manual fill-ins or corrections.

## Repository layout

```
config/settings.toml   Pipeline configuration (pinned commit, years, weights, grids)
pipeline/              Offline data pipeline (acquire → normalize → regions →
                       strength → metrics/bootstrap → emit)
data/raw/              Cached source data (committed, offline-rebuildable)
data/interim/          Regenerable intermediates (gitignored)
data/review/           Human-review artifacts (state→district map, PA/CA team lists)
docs/                  The deployed static site (GitHub Pages: main /docs)
  data/                Generated JSON artifacts consumed by the frontend
tests/                 Pipeline unit tests
```

## Build

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -e .        # or: pip install numpy pandas requests pyarrow
.venv/Scripts/python -m pipeline.run            # writes docs/data/*.json
```

Add `--refresh` to re-download source data (otherwise caches are reused).

## Local preview

```bash
python -m http.server -d docs 8000
# open http://localhost:8000/
```

## Deployment

GitHub Pages is served from the `main` branch `/docs` folder. `docs/.nojekyll`
disables Jekyll processing; all asset paths are relative so the project page
works under `/epa-gradients/`.
