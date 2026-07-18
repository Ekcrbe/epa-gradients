import pandas as pd

from pipeline import config, strength

SETTINGS = config.load_settings()


def test_window_and_snapshot_years():
    # Postseason Y uses [Y-3 .. Y]; the anchor year Y is the most recent.
    assert config.wma_window(2026, SETTINGS) == [2023, 2024, 2025, 2026]
    assert config.wma_window(2025, SETTINGS) == [2022, 2023, 2024, 2025]
    assert config.wma_window(2019, SETTINGS) == [2016, 2017, 2018, 2019]
    # COVID years drop out (shrink), not backfilled.
    assert config.wma_window(2022, SETTINGS) == [2019, 2022]
    # Canceled seasons are not produced as snapshots.
    years = config.snapshot_years(SETTINGS)
    assert years[0] == 2008 and years[-1] == 2026
    assert 2020 not in years and 2021 not in years


def _tr(*teams):
    return pd.DataFrame([{"team": t, "base_region": "co_x", "is_sc": False} for t in teams])


def test_wma_linear_recency_weights_and_single():
    # Anchor 2026 with the full window -> weights 4:3:2:1 (Y..Y-3).
    df = pd.DataFrame({
        "team": [1, 1, 1, 1],
        "year": [2023, 2024, 2025, 2026],
        "unitless_epa": [1000.0, 2000.0, 3000.0, 4000.0],
    })
    out = strength.compute(df, _tr(1), SETTINGS)
    row = out[out.snapshot_year == 2026].iloc[0]
    assert row.strength_wma == (4 * 4000 + 3 * 3000 + 2 * 2000 + 1 * 1000) / 10  # 3000
    assert row.strength_single == 4000  # anchor-year EPA only
    assert row.n_seasons_used == 4


def test_covid_shrink_renormalizes():
    # Postseason 2022: only 2022 (weight 4) and 2019 (weight 1) survive.
    df = pd.DataFrame({"team": [1, 1], "year": [2019, 2022], "unitless_epa": [1000.0, 2000.0]})
    out = strength.compute(df, _tr(1), SETTINGS)
    row = out[out.snapshot_year == 2022].iloc[0]
    assert row.strength_wma == (4 * 2000 + 1 * 1000) / 5
    assert row.strength_single == 2000


def test_only_anchor_season_teams_are_counted():
    # A team that competed in a window year but NOT the anchor year is excluded.
    df = pd.DataFrame({"team": [1], "year": [2024], "unitless_epa": [1500.0]})
    out = strength.compute(df, _tr(1), SETTINGS)
    # 2024 is the anchor for postseason 2024 -> included there...
    assert 2024 in set(out.snapshot_year)
    # ...but for postseason 2026 (anchor 2026) the team has no 2026 row -> absent,
    # even though 2024 is inside that window.
    assert 2026 not in set(out.snapshot_year[out.team == 1])
