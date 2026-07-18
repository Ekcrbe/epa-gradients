"""Offline data pipeline for EPA-gradients.

Stages (run via ``python -m pipeline.run``):
    acquire  -> normalize -> regions -> strength -> metrics/bootstrap -> emit

All fetching, normalization, and statistics happen here at build time. The
deployed site only reads the static JSON written into ``docs/data``.
"""
