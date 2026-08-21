#!/usr/bin/env python3
"""Extract documented 4DGL/Diablo16 native constants into JSON.

`diablo16_internal_functions.txt` (the HTML mirror of the Diablo16 internal
functions manual) renders every constant table as a real `<table>` with a
`<thead>`, so constants can be read straight out of the DOM instead of
reconstructed from regexes over flattened PDF text. This avoids the previous
extractor's biggest problem: an "example-derived" fallback that treated any
`NAME // comment` pattern inside an *Example* code block as a constant,
which fabricated dozens of non-constants (plain variable/string names such
as `HELLO`, `OK`, `ONE`, `TEST` that merely happened to appear in sample
code). That fallback has been removed entirely — every entry here comes from
a genuine documentation table.

    python tools/extract_4dgl_constants.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bs4 import Tag

from _html_extract_utils import clean_text, load_article_children, table_rows


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "Resources" / "diablo16_internal_functions.txt"
DEFAULT_OUTPUT_DIR = ROOT / "data"


def library_from_source(source: Path) -> str:
    """Infer a library id (e.g. "goldelox") from a source filename like
    "goldelox_internal_functions.txt"."""
    return source.stem.replace("_internal_functions", "")

SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9_#/-]*[A-Z0-9]$")

SKIP_HEADER_SETS = {("arguments", "description"), ("argument", "description")}
NAME_HEADER_KEYWORDS = ("name", "constant", "flag", "offset", "label", "specifier", "format")
VALUE_HEADER_KEYWORDS = ("value",)
VALUE_FALLBACK_KEYWORDS = ("number",)
DESC_HEADER_KEYWORDS = ("description", "comment", "meaning", "notes", "usage", "action")
AVAILABILITY_HEADER = "availability"


def classify_columns(headers_lower: list[str]) -> tuple[int | None, int | None, list[int]]:
    # Several constant tables render with an empty `<th>` for every column
    # (no header text at all). Fall back to the doc's consistent column
    # ordering for those rather than dropping the table's data entirely.
    if headers_lower and all(h == "" for h in headers_lower):
        ncols = len(headers_lower)
        if ncols == 2:
            return 0, None, [1]
        if ncols == 3:
            return 0, 1, [2]
        if ncols == 4:
            return 0, 2, [3]
        return None, None, []

    value_col = None
    for i, h in enumerate(headers_lower):
        if h in VALUE_HEADER_KEYWORDS:
            value_col = i
            break
    if value_col is None:
        for i, h in enumerate(headers_lower):
            if any(k in h for k in VALUE_FALLBACK_KEYWORDS):
                value_col = i
                break

    desc_cols = [i for i, h in enumerate(headers_lower) if any(k in h for k in DESC_HEADER_KEYWORDS)]
    desc_cols += [i for i, h in enumerate(headers_lower) if h == AVAILABILITY_HEADER and i not in desc_cols]

    name_col = None
    for i, h in enumerate(headers_lower):
        if i == value_col or i in desc_cols:
            continue
        if any(k in h for k in NAME_HEADER_KEYWORDS):
            name_col = i
            break
    if name_col is None:
        for i in range(len(headers_lower)):
            if i != value_col and i not in desc_cols:
                name_col = i
                break

    return name_col, value_col, desc_cols


def describe_cell(header_lower: str, cell_text: str) -> str:
    if header_lower == AVAILABILITY_HEADER:
        return f"4D predefined pin. Availability: {cell_text}."
    return cell_text


def add_constant(
    constants: dict[str, dict],
    name: str,
    *,
    value: str,
    description: str,
    category: str,
    anchor: str,
    source_name: str,
    library: str,
) -> None:
    name = name.strip().strip(",.;:")
    if not SYMBOL_RE.match(name):
        return

    description = clean_text(description).lstrip("- ").strip()
    value = clean_text(value)
    if not description and not value:
        return

    incoming = {
        "value": value,
        "description": description,
        "category": category,
        "library": library,
        "source": {"document": source_name, "anchor": anchor, "confidence": "documented"},
    }

    existing = constants.get(name)
    if not existing:
        constants[name] = incoming
        return

    existing_score = bool(existing.get("value")) + min(len(existing.get("description", "")), 120) / 120
    incoming_score = bool(incoming.get("value")) + min(len(incoming.get("description", "")), 120) / 120
    if incoming_score > existing_score:
        constants[name] = incoming


# A "specifier family" table has no header text and every single cell is itself a
# valid symbol — the putnum/print format constants are laid out this way, as a grid
# of DEC/DECZ/DECZB, HEX/HEXZ/HEXZB, BIN/BIN1/BIN1Z... Treating column 2 as a value
# and column 3 as a description would fabricate nonsense pairs, so every cell is
# read as a name instead. The all-cells-are-symbols test is a strong signal: a real
# [name, value, description] table has values like `0x0400` (SYMBOL_RE needs a
# leading A-Z) and prose descriptions, neither of which can match.
def is_specifier_table(headers_lower: list[str], rows: list[list[str]]) -> bool:
    if not headers_lower or not all(h == "" for h in headers_lower):
        return False
    cells = [cell for row in rows for cell in row if cell]
    if len(cells) < 4:
        return False
    return all(SYMBOL_RE.match(cell) for cell in cells)


def extract_specifier_table(
    table: Tag,
    rows: list[list[str]],
    category: str,
    function_name: str,
    anchor: str,
    constants: dict[str, dict],
    source_name: str,
    library: str,
) -> None:
    subject = function_name or category
    description = (
        f"Pre-defined format constant documented under {subject}." if subject
        else "Pre-defined format constant."
    )
    for row in rows:
        for cell in row:
            if not cell:
                continue
            add_constant(
                constants,
                cell,
                value="",
                description=description,
                category=category,
                anchor=anchor,
                source_name=source_name,
                library=library,
            )


# `NAME or NAME`, `NAME, NAME or NAME` — how an argument's accepted values are
# written inside an Arguments/Description table when they get no table of their own:
# "mode | TRANSPARENT or OPAQUE (0 or 1)", "spi# | The SPI port to use, e.g. SPI0,
# SPI1, SPI2 or SPI3.". Requiring the explicit "or" alternation is what keeps this
# from harvesting every capitalised word in a description.
ALTERNATIVES_RE = re.compile(
    r"\b[A-Z][A-Z0-9_]+\b(?:\s*,\s*\b[A-Z][A-Z0-9_]+\b)*\s+or\s+\b[A-Z][A-Z0-9_]+\b"
)
ALTERNATIVE_NAME_RE = re.compile(r"\b[A-Z][A-Z0-9_]+\b")


def extract_argument_alternatives(
    table: Tag, category: str, anchor: str, constants: dict[str, dict], source_name: str, library: str
) -> None:
    """Constants that exist only as the documented alternatives for an argument.

    `TRANSPARENT` and `OPAQUE` are the clearest case: they are real constants used
    all over the manuals' example code, but they are never given a name/value row —
    only `gfx_FillPattern`'s and `txt_Set`'s argument tables mention them, as prose
    inside the description cell. Without this pass they simply don't exist as far as
    the extension is concerned.
    """
    rows = table_rows(table)
    for row in rows:
        if len(row) < 2:
            continue
        argument, cell = row[0], row[1]
        for match in ALTERNATIVES_RE.finditer(cell):
            for name in ALTERNATIVE_NAME_RE.findall(match.group(0)):
                add_constant(
                    constants,
                    name,
                    value="",
                    description=f"Accepted value for the `{argument}` argument: {cell}",
                    category=category,
                    anchor=anchor,
                    source_name=source_name,
                    library=library,
                )


def extract_table_constants(
    table: Tag, category: str, function_name: str, anchor: str, constants: dict[str, dict], source_name: str, library: str
) -> None:
    headers = [clean_text(th.get_text()) for th in table.find_all("th")]
    headers_lower = [h.lower() for h in headers]
    if not headers:
        return
    if tuple(headers_lower) in SKIP_HEADER_SETS:
        extract_argument_alternatives(table, category, anchor, constants, source_name, library)
        return

    rows = table_rows(table)
    if is_specifier_table(headers_lower, rows):
        extract_specifier_table(
            table, rows, category, function_name, anchor, constants, source_name, library
        )
        return

    name_col, value_col, desc_cols = classify_columns(headers_lower)
    if name_col is None:
        return

    # Columns that classify_columns didn't account for. When a table has no
    # description column at all they become the description, as "Header: cell"
    # pairs — otherwise every row is dropped, because add_constant discards an entry
    # with neither a value nor a description. That was silently losing whole
    # capability tables: `pin_Set`'s pin list is
    # [Pin Name | Pin No. | OUTPUT | INPUT | ANALOGUE | SOUND], none of which is a
    # "value" or "description" header, so IO1_PIN..IO11_PIN and IO19_PIN never
    # existed even though the manual references IO1_PIN 26 times.
    extra_cols = (
        [i for i in range(len(headers_lower)) if i != name_col and i != value_col]
        if not desc_cols
        else []
    )

    for row in rows:
        if name_col >= len(row):
            continue
        name = row[name_col]
        value = row[value_col] if value_col is not None and value_col < len(row) else ""
        desc_parts = [
            describe_cell(headers_lower[i], row[i])
            for i in desc_cols
            if i < len(row) and row[i]
        ]
        desc_parts += [
            f"{headers[i]}: {row[i]}"
            for i in extra_cols
            if i < len(row) and row[i] and headers[i]
        ]
        add_constant(
            constants,
            name,
            value=value,
            description=" ".join(desc_parts),
            category=category,
            anchor=anchor,
            source_name=source_name,
            library=library,
        )


RANGE_RE = re.compile(
    r"(?P<prefix>[A-Z][A-Z0-9_]*_)(?P<start>\d+)\s*(?:</strong>)?\s*(?:to|through to)\s*(?:<strong>)?\s*"
    r"(?P=prefix)(?P<end>\d+)",
)


def extract_prose_ranges(
    tag: Tag, category: str, anchor: str, constants: dict[str, dict], source_name: str, library: str
) -> None:
    """Some constants are only introduced in prose, e.g. "the pre-defined
    constants FILLPATTERN_0 through to FILLPATTERN_31" rather than a table.
    Scan the raw inner HTML (not get_text()) so the regex can still see the
    <strong> boundaries mkdocs wraps each constant name in.
    """
    for match in RANGE_RE.finditer(tag.decode_contents()):
        prefix = match.group("prefix")
        start, end = int(match.group("start")), int(match.group("end"))
        if end < start or end - start > 128:
            continue
        for number in range(start, end + 1):
            add_constant(
                constants,
                f"{prefix}{number}",
                value="",
                description=f"Predefined constant in range {prefix}{start} through {prefix}{end}.",
                category=category,
                anchor=anchor,
                source_name=source_name,
                library=library,
            )


def build_database(source: Path, library: str) -> dict[str, dict]:
    kids = load_article_children(source)
    constants: dict[str, dict] = {}

    category = ""
    function_name = ""
    anchor = ""

    for tag in kids:
        if tag.name == "h2":
            category = clean_text(tag.get_text())
            function_name = ""
            anchor = tag.get("id") or ""
            continue
        if tag.name == "h3":
            function_name = clean_text(tag.get_text())
            anchor = tag.get("id") or anchor
            continue

        label = f"{category} / {function_name}" if function_name else category

        tables = [tag] if tag.name == "table" else tag.find_all("table")
        for table in tables:
            extract_table_constants(table, label, function_name, anchor, constants, source.name, library)

        if tag.name == "p":
            extract_prose_ranges(tag, label, anchor, constants, source.name, library)

    return dict(sorted(constants.items(), key=lambda item: item[0].lower()))


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract 4DGL native constants to JSON.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="HTML functions reference file")
    parser.add_argument("--library", help="Library id (default: inferred from --source filename)")
    parser.add_argument("--output", type=Path, default=None, help="Output JSON path")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Source not found: {args.source}")

    library = args.library or library_from_source(args.source)
    output = args.output or (DEFAULT_OUTPUT_DIR / f"4dgl_constants_{library}.json")

    constants = build_database(args.source, library)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(constants, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(constants)} constants to {output}")


if __name__ == "__main__":
    main()
