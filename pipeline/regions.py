"""Assign every team to a present-day region, applied to all historical seasons.

Rules (see README / plan):
  * Districts are derived empirically from the 2026 rows as a modal
    (country, state) -> district map, then applied to all seasons by a team's
    canonical (most-recent) state. This absorbs district code changes
    (e.g. chs -> fch) and stray null-district noise (e.g. a few NH teams).
  * CA is split into two regions by latitude: teams whose resolved location
    is at or north of settings.regions.ca_split_lat (35.789 deg N) are
    "ca_north" (Northern California), the rest "ca_south" (Southern
    California). Location comes from The Blue Alliance's postal_code/city
    fields resolved via geocode.py (see tba.py for the fetch/cache); teams
    that still can't be resolved are excluded and listed in
    data/review/ca_unmapped_teams.csv. config/ca_overrides.csv always wins
    over the automated result, for manual fill-ins or corrections.
  * SC is time-dependent: own state region ("South Carolina") <=2022 and again
    from 2025 (the present-day FIRST South Carolina district years), merged into
    one "st_sc" region since they never overlap in time; pch (Peachtree) in
    2023-2024 instead.
  * PA is split: teams active in/after 2012 take their present-day district as
    given (fma, else non-district PA, displayed "Rest of Pennsylvania"); teams
    defunct before 2012 are emitted to data/review/pa_defunct_teams.csv for
    manual assignment via config/pa_overrides.csv.
  * Remaining non-district teams group by state if USA (or state == QC),
    otherwise by country.

Outputs:
  data/interim/team_region.parquet     team -> base_region + flags + canonical loc
  data/interim/region_meta.json        region_id -> {name, type}
  data/review/state_district_map.json  human-review of the derived mapping
  data/review/pa_defunct_teams.csv     defunct pre-2012 PA teams to sort by hand
  data/review/ca_unmapped_teams.csv    CA teams with no resolvable location
  data/review/ca_team_locations.csv    every CA team's resolved location + region, for audit
"""
from __future__ import annotations

import json
import re
import unicodedata

import pandas as pd

from . import config

DISTRICT_NAMES = {
    "ca_north": "Northern California",
    "ca_south": "Southern California",
    "fch": "FIRST Chesapeake",
    "fim": "FIRST in Michigan",
    "fin": "FIRST Indiana",
    "fit": "FIRST in Texas",
    "fma": "FIRST Mid-Atlantic",
    "fnc": "FIRST North Carolina",
    "isr": "Israel",
    "ne": "New England",
    "ont": "Ontario",
    "pch": "Peachtree (Georgia)",
    "pnw": "Pacific Northwest",
    # South Carolina is grouped with the districts, not the states, even
    # though it spends pre-2023 seasons organized as its own state region --
    # its present-day, and most-recent, form is the FIRST South Carolina
    # district (see regions.sc_region_for_year for the merge).
    "st_sc": "South Carolina",
    "win": "FIRST Wisconsin",
}

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico", "GU": "Guam",
    "QC": "Québec",
}


# Display-name overrides for country regions (Ontario and Québec are separate
# regions, so the remaining Canadian provinces are "Rest of Canada"; "Chinese
# Taipei" is FIRST's event-registration name for Taiwan).
COUNTRY_DISPLAY = {"Canada": "Rest of Canada", "Chinese Taipei": "Taiwan"}

# Display-name overrides for state regions (FMA is its own region, so the rest
# of Pennsylvania is "Rest of Pennsylvania").
STATE_DISPLAY = {"PA": "Rest of Pennsylvania"}


def _slug(s: str) -> str:
    # Strip accents so e.g. "Türkiye" -> "turkiye" rather than "t_rkiye".
    ascii_s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", ascii_s.lower()).strip("_")


def _opt(v):
    """Return a plain str or None from a possibly-NA pandas value."""
    return v if (v is not None and pd.notna(v)) else None


def build_district_map(df: pd.DataFrame, year: int = 2026) -> dict[tuple, str]:
    """Modal (country, state) -> district from a single present-day season."""
    d = df[df["year"] == year]
    mapping: dict[tuple, str] = {}
    for (country, state), g in d.groupby(["country", "state"], dropna=False):
        vc = g["district"].dropna().value_counts()
        if len(vc):
            mapping[(_opt(country), _opt(state))] = vc.index[0]
    return mapping


def sc_region_for_year(year: int, settings: dict) -> str:
    """South Carolina's region for a snapshot year.

    <= 2022 and >= sc_fsc_from (the present-day FIRST South Carolina district
    years) both map to "st_sc" -- they never overlap in time, so they merge
    into one "South Carolina" region with a gap in the pch (Peachtree) years.
    """
    r = settings["regions"]
    if year in r["sc_pch_years"]:
        return "pch"
    return "st_sc"


def region_name(region_id: str, country_names: dict[str, str] | None = None) -> tuple[str, str]:
    """Return (display_name, type) for a region id."""
    country_names = country_names or {}
    if region_id in DISTRICT_NAMES:
        return DISTRICT_NAMES[region_id], "district"
    if region_id.startswith("st_"):
        code = region_id[3:].upper()
        name = US_STATES.get(code, code)
        return STATE_DISPLAY.get(code, name), "state"
    if region_id.startswith("co_"):
        return country_names.get(region_id, region_id[3:].replace("_", " ").title()), "country"
    return region_id, "unknown"


def _split_california(
    base: dict[int, str | None], ca_teams: list[int], locations: dict[int, dict], split_lat: float
) -> list[int]:
    """Reassign "ca" teams in-place to "ca_north" / "ca_south" by resolved latitude.

    Teams at or north of split_lat are ca_north, the rest ca_south. Teams
    with no resolvable location are left unmapped (base=None) and returned
    so the caller can list them for review / manual override.
    """
    unresolved: list[int] = []
    for team in ca_teams:
        lat = (locations.get(team) or {}).get("lat")
        if lat is None:
            base[team] = None
            unresolved.append(team)
        else:
            base[team] = "ca_north" if lat >= split_lat else "ca_south"
    return unresolved


def _load_overrides(filename: str) -> dict[int, str]:
    """team -> region from a config/*.csv with (at least) team,region columns."""
    path = config.ROOT / "config" / filename
    if not path.exists():
        return {}
    ov = pd.read_csv(path, comment="#")
    ov = ov.dropna(subset=["team", "region"])
    return {int(t): str(r).strip() for t, r in zip(ov["team"], ov["region"])}


def classify(df: pd.DataFrame, settings: dict) -> tuple[pd.DataFrame, dict]:
    dmap = build_district_map(df, 2026)
    # PA and SC are handled by dedicated rules, not the auto-map.
    auto_map = {k: v for k, v in dmap.items() if k not in {("USA", "PA"), ("USA", "SC")}}

    # Canonical (most-recent) location + activity span per team.
    last = df.sort_values("year").drop_duplicates("team", keep="last").set_index("team")
    span = df.groupby("team").agg(
        first_year=("year", "min"), last_year=("year", "max"), seasons=("year", "nunique")
    )
    teams = last[["name", "country", "state", "district"]].join(span)
    teams = teams.rename(columns={"district": "last_district"})

    pa_cut = settings["regions"]["pa_active_cutoff"]
    overrides = _load_overrides("pa_overrides.csv")

    country_names: dict[str, str] = {}
    base: dict[int, str | None] = {}
    is_sc: dict[int, bool] = {}
    pa_defunct: list[dict] = []
    unmapped: list[dict] = []

    for team, r in teams.iterrows():
        country, state = _opt(r["country"]), _opt(r["state"])
        is_sc[team] = False

        if country == "USA" and state == "SC":
            is_sc[team] = True
            base[team] = None
            continue

        if country == "USA" and state == "PA":
            if r["last_year"] >= pa_cut:
                ld = _opt(r["last_district"])
                base[team] = "fma" if ld == "fma" else "st_pa"
            elif team in overrides:
                base[team] = overrides[team]
            else:
                base[team] = None
                pa_defunct.append({
                    "team": team, "name": r["name"], "first_year": r["first_year"],
                    "last_year": r["last_year"], "seasons": r["seasons"],
                    "last_known_district": _opt(r["last_district"]),
                })
            continue

        key = (country, state)
        if key in auto_map:
            base[team] = auto_map[key]
        elif country == "USA" and state:
            base[team] = f"st_{state.lower()}"
        elif state == "QC":
            base[team] = "st_qc"
        elif country:
            rid = f"co_{_slug(country)}"
            base[team] = rid
            country_names[rid] = COUNTRY_DISPLAY.get(country, country)
        else:
            base[team] = None
            unmapped.append({"team": team, "country": country, "state": state})

    ca_teams = [team for team, rid in base.items() if rid == "ca"]
    ca_unmapped: list[dict] = []
    ca_locations: dict[int, dict] = {}
    if ca_teams:
        from . import tba
        ca_locations = tba.fetch_team_locations(ca_teams)
        split_lat = settings["regions"]["ca_split_lat"]
        unresolved = set(_split_california(base, ca_teams, ca_locations, split_lat))
        # config/ca_overrides.csv always wins, whether filling in a team the
        # automated lookup couldn't resolve or correcting one it got wrong
        # (e.g. a boundary case a human reviewer disagrees with).
        ca_overrides = _load_overrides("ca_overrides.csv")
        for team in ca_teams:
            if team in ca_overrides:
                base[team] = ca_overrides[team]
        for team in unresolved:
            if team not in ca_overrides:
                ca_unmapped.append({
                    "team": team,
                    "name": teams.loc[team, "name"] if team in teams.index else None,
                    "city": (ca_locations.get(team) or {}).get("city"),
                })

    out = teams.reset_index()[["team", "name", "country", "state", "last_year", "first_year", "seasons"]].copy()
    out["base_region"] = out["team"].map(base).astype("string")
    out["is_sc"] = out["team"].map(is_sc)
    config.INTERIM.mkdir(parents=True, exist_ok=True)
    out.to_parquet(config.INTERIM / "team_region.parquet", index=False)

    # Region metadata for every region id that can appear (incl. SC's dynamic targets).
    region_ids = set(out["base_region"].dropna().unique())
    region_ids |= {"st_sc", "pch"}
    meta = {rid: dict(zip(("name", "type"), region_name(rid, country_names))) for rid in sorted(region_ids)}
    (config.INTERIM / "region_meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    _emit_review(df, dmap, out, pa_defunct, unmapped, ca_unmapped, settings, ca_teams, ca_locations, base)

    print(
        f"  regions: {len(meta)} region ids; "
        f"{out['base_region'].notna().sum():,}/{len(out):,} teams mapped, "
        f"{int(out['is_sc'].sum())} SC (dynamic), {len(pa_defunct)} PA-defunct to review, "
        f"{len(ca_unmapped)} CA teams with no TBA location, {len(unmapped)} unmapped"
    )
    return out, meta


def _emit_review(df, dmap, team_region, pa_defunct, unmapped, ca_unmapped, settings,
                  ca_teams, ca_locations, base) -> None:
    config.REVIEW.mkdir(parents=True, exist_ok=True)
    usa = df[df["year"] == 2026]
    usa = usa[usa["country"] == "USA"]
    districted_states = {s for (c, s) in dmap if c == "USA" and s}
    non_district_states = sorted(
        s for s in usa["state"].dropna().unique()
        if s not in districted_states and s not in {"PA", "SC"}
    )
    review = {
        "generated_from": "2026 rows (present-day boundaries), applied to all seasons by canonical team state",
        "district_map": {f"{c}|{s or ''}": d for (c, s), d in sorted(dmap.items(), key=lambda kv: kv[1])},
        "usa_non_district_states": non_district_states,
        "specials": {
            "SC": {"<=2022": "st_sc (South Carolina)", "2023-2024": "pch (Peachtree)",
                   ">=2025": "st_sc again (present-day FIRST South Carolina district, merged)"},
            "PA": {"active>=2012": "present-day district as given (fma, else st_pa / Rest of Pennsylvania)",
                   "defunct<2012": "manual via config/pa_overrides.csv (see pa_defunct_teams.csv)"},
            "CA": {"split": "ca_north / ca_south by team location (TBA postal_code -> ZIP "
                             "centroid, falling back to city -> CA place centroid), "
                             f"threshold {settings['regions']['ca_split_lat']} deg N",
                   "no_location": "excluded, listed in ca_unmapped_teams.csv",
                   "manual_override": "config/ca_overrides.csv always wins, for unresolved "
                                       "teams or to correct a boundary case",
                   "audit": "every CA team's resolved location + assigned region is in "
                            "ca_team_locations.csv for review"},
            "notes": "A few NH teams have null district in 2026; the modal rule assigns all NH -> ne.",
        },
        "pa_defunct_count": len(pa_defunct),
        "unmapped_count": len(unmapped),
        "ca_unmapped_count": len(ca_unmapped),
    }
    (config.REVIEW / "state_district_map.json").write_text(
        json.dumps(review, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    pa_df = pd.DataFrame(pa_defunct, columns=["team", "name", "first_year", "last_year", "seasons", "last_known_district"])
    pa_df = pa_df.sort_values("team") if len(pa_df) else pa_df
    pa_df.to_csv(config.REVIEW / "pa_defunct_teams.csv", index=False)

    ca_unmapped_path = config.REVIEW / "ca_unmapped_teams.csv"
    if ca_unmapped:
        pd.DataFrame(ca_unmapped, columns=["team", "name", "city"]).sort_values("team").to_csv(
            ca_unmapped_path, index=False
        )
    elif ca_unmapped_path.exists():
        ca_unmapped_path.unlink()  # nothing left to review -- don't leave a stale list

    if ca_teams:
        # Full audit trail of every California team's resolved location and
        # assigned region, so a human reviewer can spot-check the automated
        # split (especially boundary cases near ca_split_lat) and force a
        # correction via config/ca_overrides.csv if they disagree.
        audit = []
        overridden = set(_load_overrides("ca_overrides.csv"))
        for team in ca_teams:
            loc = ca_locations.get(team) or {}
            audit.append({
                "team": team,
                "region": base.get(team),
                "city": loc.get("city"),
                "postal_code": loc.get("postal_code"),
                "lat": loc.get("lat"),
                "lng": loc.get("lng"),
                "overridden": team in overridden,
            })
        pd.DataFrame(audit).sort_values("team").to_csv(
            config.REVIEW / "ca_team_locations.csv", index=False
        )

    if unmapped:
        pd.DataFrame(unmapped).to_csv(config.REVIEW / "unmapped_teams.csv", index=False)


def region_for_year(team_region: pd.DataFrame, year: int, settings: dict) -> pd.Series:
    """Region id per team for a given snapshot year (applies the SC time rule)."""
    reg = team_region["base_region"].astype("object").copy()
    reg[team_region["is_sc"].to_numpy()] = sc_region_for_year(year, settings)
    reg.index = team_region["team"].to_numpy()
    return reg


def run(settings: dict) -> pd.DataFrame:
    from . import normalize
    print("[regions]")
    df = normalize.load(settings)
    team_region, _ = classify(df, settings)
    return team_region


if __name__ == "__main__":
    run(config.load_settings())
