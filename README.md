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

- **Hero displacement curve** — `D(p)` for a selected region and season (or
  pooled): a bold zero line, diverging shading (harder above, easier below), a
  95% bootstrap band, the zero-crossing marker, and a hover readout. Small
  samples (n < 5) omit the band.
- **All regions** — a sortable **diverging heatmap** (rows = regions, columns =
  skill-percentile bins) plus a **small-multiples** grid of mini `D(p)` panels on
  shared axes. Sort by average difficulty, crossover, top-heaviness, or team
  count; filter by minimum `n`; click any row or panel to focus it in the hero.
- **Elite-tail survival ratio** — `R(x)` on a log axis for the selected region.
- **Methodology** — an in-page explainer of the metric, strength model, region
  rules, and uncertainty.

Frontend modules live in `docs/assets/js/` (`app.js`, `data.js`, `hero.js`,
`heatmap.js`, `smallmultiples.js`, `survival.js`, `theme.js`); D3 is vendored at
`docs/assets/vendor/d3.v7.min.js`.

## Data sources

- **≤ 2023:** the `v3/team_years.csv` table from a pinned commit of
  [`avgupta456/statbotics-csvs`](https://github.com/avgupta456/statbotics-csvs)
  (has `unitless_epa` back to 2002).
- **2024–2026:** the Statbotics mirror API
  (`https://api-statbotics.iterativerefinement.com/v3`), paginated and cached.
  2024 is taken from the API rather than the pinned CSV because that commit's
  2024 EPAs were still mid-season and compressed toward the mean.

## Repository layout

```
config/settings.toml   Pipeline configuration (pinned commit, years, weights, grids)
pipeline/              Offline data pipeline (acquire → normalize → regions →
                       strength → metrics/bootstrap → emit)
data/raw/              Cached source data (committed, offline-rebuildable)
data/interim/          Regenerable intermediates (gitignored)
data/review/           Human-review artifacts (state→district map, PA team list)
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
