#!/usr/bin/env python3
"""Regenerate function/constant JSON for every supported 4DGL internal-functions
library (diablo16, goldelox, picaso, pixxi) in one shot.

Each library's manual is mirrored at
`Resources/<library>_internal_functions.txt` and produces its own pair of
JSON databases, `data/4dgl_functions_<library>.json` and
`data/4dgl_constants_<library>.json`, since the libraries document largely
non-overlapping function/constant sets (they target different display
chips) rather than variants of one shared API.

    python tools/extract_all_libraries.py
"""

from __future__ import annotations

import json
from pathlib import Path

import extract_4dgl_constants
import extract_4dgl_docs

ROOT = Path(__file__).resolve().parents[1]
RESOURCES = ROOT / "Resources"
DATA = ROOT / "data"

LIBRARIES = ["diablo16", "goldelox", "picaso", "pixxi"]


def main() -> None:
    for library in LIBRARIES:
        source = RESOURCES / f"{library}_internal_functions.txt"
        if not source.exists():
            print(f"Skipping {library}: {source} not found")
            continue

        functions = extract_4dgl_docs.build_database(source, library)
        functions_out = DATA / f"4dgl_functions_{library}.json"
        functions_out.write_text(json.dumps(functions, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"Wrote {len(functions)} functions to {functions_out}")

        constants = extract_4dgl_constants.build_database(source, library)
        constants_out = DATA / f"4dgl_constants_{library}.json"
        constants_out.write_text(json.dumps(constants, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"Wrote {len(constants)} constants to {constants_out}")


if __name__ == "__main__":
    main()
