import pandas as pd

from pipeline import config, regions

SETTINGS = config.load_settings()


def test_build_district_map_is_modal_and_by_state():
    df = pd.DataFrame({
        "year": [2026] * 6,
        "country": ["USA", "USA", "USA", "USA", "Israel", "Canada"],
        "state": ["MI", "NH", "NH", "TX", None, "ON"],
        # NH has a stray null district; modal rule should still map NH -> ne.
        "district": ["fim", "ne", None, "fit", "isr", "ont"],
    })
    m = regions.build_district_map(df, 2026)
    assert m[("USA", "MI")] == "fim"
    assert m[("USA", "NH")] == "ne"
    assert m[("USA", "TX")] == "fit"
    assert m[("Israel", None)] == "isr"
    assert m[("Canada", "ON")] == "ont"


def test_sc_time_rule():
    # <=2022 and >=2025 (sc_fsc_from) both merge into "st_sc" since they never
    # overlap with the pch (Peachtree) years.
    assert regions.sc_region_for_year(2019, SETTINGS) == "st_sc"
    assert regions.sc_region_for_year(2022, SETTINGS) == "st_sc"
    assert regions.sc_region_for_year(2023, SETTINGS) == "pch"
    assert regions.sc_region_for_year(2024, SETTINGS) == "pch"
    assert regions.sc_region_for_year(2025, SETTINGS) == "st_sc"
    assert regions.sc_region_for_year(2027, SETTINGS) == "st_sc"


def test_region_for_year_applies_sc_dynamic():
    tr = pd.DataFrame([
        {"team": 10, "base_region": "fim", "is_sc": False},
        {"team": 20, "base_region": None, "is_sc": True},
    ])
    r2022 = regions.region_for_year(tr, 2022, SETTINGS)
    r2023 = regions.region_for_year(tr, 2023, SETTINGS)
    r2026 = regions.region_for_year(tr, 2026, SETTINGS)
    assert r2022[10] == "fim" and r2022[20] == "st_sc"
    assert r2023[20] == "pch"
    assert r2026[10] == "fim" and r2026[20] == "st_sc"  # merged, not "fsc"


def test_region_naming():
    assert regions.region_name("fim") == ("FIRST in Michigan", "district")
    assert regions.region_name("st_fl") == ("Florida", "state")
    assert regions.region_name("st_qc") == ("Québec", "state")
    assert regions.region_name("st_pa") == ("Rest of Pennsylvania", "state")
    # South Carolina is grouped with the districts (its present-day form),
    # even though its id keeps the "st_" prefix from its pre-2023 years.
    assert regions.region_name("st_sc") == ("South Carolina", "district")
    name, typ = regions.region_name("co_china")
    assert typ == "country"
    country_names = {"co_canada": "Rest of Canada", "co_chinese_taipei": "Taiwan"}
    assert regions.region_name("co_canada", country_names) == ("Rest of Canada", "country")
    assert regions.region_name("co_chinese_taipei", country_names) == ("Taiwan", "country")
