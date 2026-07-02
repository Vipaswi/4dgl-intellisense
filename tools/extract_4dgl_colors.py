#!/usr/bin/env python3
"""Extract named 4DGL colour constants into JSON.

`colors.pdf` is 4D Systems application note 4D-AN-00043 ("Colour Constants"),
a short vendor PDF with a genuine text layer (unlike the two big manual PDFs
in this repo, which have no usable text layer and were superseded by their
HTML mkdocs exports). Its two pages render each colour as a
`NAME 0xHEXVALUE` pair in a 3-column table; `pdfplumber`'s plain
`page.extract_text()` reads that back out as literal `NAME 0xHEXVALUE` text
in reading order regardless of column position, so a simple regex over the
concatenated page text is enough, no OCR required.

    python -m pip install pdfplumber   # one-time
    python tools/extract_4dgl_colors.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "Resources" / "colors.pdf"
DEFAULT_OUTPUT = ROOT / "data" / "4dgl_colors.json"

COLOR_PAIR_RE = re.compile(r"\b([A-Z][A-Z0-9]*)\s+(0[xX][0-9A-Fa-f]{4})\b")

AGGREGATE_KEYS = ("COLOR", "COLOUR")


def rgb565_to_css_hex(value: str) -> str:
    """Convert a packed RGB565 value (e.g. "0xFFE0") to a CSS "#RRGGBB" string.

    VS Code's suggest widget auto-renders a colour swatch for CompletionItemKind.Color
    items when it can find a recognizable CSS colour (like #RRGGBB) in the item's
    label/detail/documentation, but RGB565 hex isn't in a format it recognizes -
    hence converting to standard 8-bit-per-channel CSS hex here.
    """
    v = int(value, 16)
    r5, g6, b5 = (v >> 11) & 0x1F, (v >> 5) & 0x3F, v & 0x1F
    r8 = (r5 << 3) | (r5 >> 2)
    g8 = (g6 << 2) | (g6 >> 4)
    b8 = (b5 << 3) | (b5 >> 2)
    return f"#{r8:02X}{g8:02X}{b8:02X}"


def extract_pairs(source: Path) -> list[tuple[str, str]]:
    with pdfplumber.open(source) as pdf:
        text = "\n".join(page.extract_text() or "" for page in pdf.pages)

    pairs: list[tuple[str, str]] = []
    seen: set[str] = set()
    for name, value in COLOR_PAIR_RE.findall(text):
        if name in seen:
            continue
        seen.add(name)
        pairs.append((name, f"0x{value[2:].upper()}"))

    return pairs


def build_reference_table(pairs: list[tuple[str, str]]) -> str:
    ordered = sorted(pairs, key=lambda pair: pair[0])
    lines = ["| Name | Value | Name | Value |", "|---|---|---|---|"]
    for i in range(0, len(ordered), 2):
        left = ordered[i]
        right = ordered[i + 1] if i + 1 < len(ordered) else None
        left_cell = f"{left[0]} | `{left[1]}`"
        right_cell = f"{right[0]} | `{right[1]}`" if right else " | "
        lines.append(f"| {left_cell} | {right_cell} |")
    return "\n".join(lines)


def build_database(source: Path) -> dict[str, dict]:
    pairs = extract_pairs(source)

    colors: dict[str, dict] = {}
    for name, value in pairs:
        colors[name] = {
            "value": value,
            "cssHex": rgb565_to_css_hex(value),
            "description": "Named colour constant.",
            "category": "Colour Constant",
            "source": {"document": source.name, "confidence": "documented"},
        }

    reference_table = build_reference_table(pairs)
    for key in AGGREGATE_KEYS:
        colors[key] = {
            "description": f"All {len(pairs)} named colour constants available in 4DGL:\n\n{reference_table}",
            "category": "Colour Constants Reference",
            "source": {"document": source.name, "confidence": "documented"},
        }

    return colors


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Colour constants PDF")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output JSON path")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Source not found: {args.source}")

    colors = build_database(args.source)
    args.output.write_text(json.dumps(colors, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(colors)} entries to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
