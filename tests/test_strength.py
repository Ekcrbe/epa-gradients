import numpy as np
import pandas as pd

from pipeline import config, strength

SETTINGS = config.load_settings()


def test_window_matches_spec():
    # Present-day (2027 preseason) uses the four prior seasons.
    assert config.valid_seasons_before(2027, SETTINGS) == [2023, 2024, 2025, 2026]
    assert config.valid_seasons_before(2026, SETTINGS) == [2022, 2023, 2024, 2025]
    # COVID years drop out (shrink), not backfilled.
    assert config.valid_seasons_before(2023, SETTINGS) == [2019, 2022]
    assert config.valid_seasons_before(2022, SETTINGS) == [2018, 2019]


def _tr(team):
    return pd.DataFrame([{"team": team, "base_region": "co_x", "is_sc": False}])


def test_wma_linear_recency_weights():
    # One team with all four prior seasons present -> weights 4:3:2:1 by offset.
    df = pd.DataFrame({
        "team": [1, 1, 1, 1],
        "year": [2023, 2024, 2025, 2026],
        "unitless_epa": [1000.0, 2000.0, 3000.0, 4000.0],
    })
    out = strength.compute(df, _tr(1), SETTINGS)
    row = out[out.snapshot_year == 2027].iloc[0]
    expected = (1 * 1000 + 2 * 2000 + 3 * 3000 + 4 * 4000) / 10
    assert row.strength == expected
    assert row.n_seasons_used == 4


def test_covid_shrink_renormalizes():
    # 2023 snapshot: only 2019 (weight 1) and 2022 (weight 4) survive.
    df = pd.DataFrame({
        "team": [1, 1],
        "year": [2019, 2022],
        "unitless_epa": [1000.0, 2000.0],
    })
    out = strength.compute(df, _tr(1), SETTINGS)
    row = out[out.snapshot_year == 2023].iloc[0]
    assert row.strength == (1 * 1000 + 4 * 2000) / 5
    assert row.n_seasons_used == 2


def test_team_needs_in_window_season():
    # A team active only in 2010 has no in-window season for 2027 -> absent there.
    df = pd.DataFrame({"team": [1], "year": [2010], "unitless_epa": [1500.0]})
    out = strength.compute(df, _tr(1), SETTINGS)
    assert 2027 not in set(out.snapshot_year)
    assert 2014 in set(out.snapshot_year)  # 2010 is in the 2011-2014 window
