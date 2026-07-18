"""Orchestrate the full offline pipeline: acquire -> emit static JSON.

Usage:
    python -m pipeline.run [--refresh] [--fast]

    --refresh   re-download / re-fetch source data, ignoring caches
    --fast      skip bootstrap bands (quick iteration on the frontend/metrics)
"""
from __future__ import annotations

import argparse
import time

from . import acquire, config, emit, metrics, normalize, regions, strength


def main(refresh: bool = False, fast: bool = False) -> None:
    settings = config.load_settings()
    if fast:
        settings["metrics"]["bootstrap_B"] = 0
    config.ensure_dirs()

    t0 = time.time()
    acquire.run(settings, refresh=refresh)
    normalize.run(settings)
    regions.run(settings)
    strength.run(settings)
    out = metrics.run(settings)
    emit.run(out, settings)
    print(f"[done] pipeline finished in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Build EPA-gradients static JSON artifacts.")
    ap.add_argument("--refresh", action="store_true", help="re-download / re-fetch source data")
    ap.add_argument("--fast", action="store_true", help="skip bootstrap bands")
    args = ap.parse_args()
    main(refresh=args.refresh, fast=args.fast)
