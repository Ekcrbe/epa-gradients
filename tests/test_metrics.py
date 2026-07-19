import numpy as np

from pipeline import config, metrics

SETTINGS = config.load_settings()


def test_identical_distribution_gives_zero_displacement():
    vals = np.linspace(1000, 2000, 500)
    p = (np.arange(1, 100)) / 100
    q = np.quantile(np.sort(vals), p)
    d = metrics.displacement(np.sort(vals), q, p)
    assert np.abs(d).max() < 0.02  # region == global -> D ~ 0


def test_stronger_region_reads_as_harder():
    # Region shifted well above global -> a team at global percentile p ranks
    # lower within the region -> F_region small -> D = p - F_region > 0 (harder).
    global_sorted = np.sort(np.linspace(1000, 2000, 1000))
    region = np.linspace(1800, 2200, 200)  # strong region
    p = (np.arange(1, 100)) / 100
    q = np.quantile(global_sorted, p)
    d = metrics.displacement(np.sort(region), q, p)
    assert d.mean() > 0
    # ...and weaker region reads as easier.
    weak = np.linspace(900, 1300, 200)
    d2 = metrics.displacement(np.sort(weak), q, p)
    assert d2.mean() < 0


def test_find_crossings_and_primary():
    p = np.linspace(0, 1, 11)
    d = np.array([-3, -2, -1, 1, 2, 1, -1, -2, 1, 2, 3.0])
    crossings = metrics.find_crossings(p, d)
    dirs = [c["dir"] for c in crossings]
    assert "easier_to_harder" in dirs and "harder_to_easier" in dirs
    # primary = first easier->harder crossing, between p=0.2 and 0.3.
    assert 0.2 < metrics.primary_crossing(crossings) < 0.3


def test_survival_tail_caps_and_ratios():
    global_sorted = np.sort(np.linspace(1000, 2000, 1000))
    region = np.sort(np.linspace(1500, 2100, 100))
    s = metrics.survival_tail(region, global_sorted, SETTINGS)
    m = SETTINGS["metrics"]
    assert len(s["x"]) == len(s["R"]) == m["survival_points"]
    assert min(s["p"]) >= m["survival_p_start"] - 1e-9
    assert max(s["p"]) <= m["survival_p_end_cap"] + 1e-9
    assert np.all(np.asarray(s["R"]) >= 0)
    assert s["mean_R"] is not None


def test_survival_mean_R_matches_manual_mean():
    # Region == global -> R(x) ~ 1 everywhere -> mean_R ~ 1.
    vals = np.sort(np.linspace(1000, 2000, 800))
    s = metrics.survival_tail(vals, vals, SETTINGS)
    assert abs(s["mean_R"] - 1.0) < 1e-6
