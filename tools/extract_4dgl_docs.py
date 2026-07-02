#!/usr/bin/env python3
"""Extract 4DGL built-in function docs from the HTML mirror of the Diablo16
internal functions manual.

`diablo16_internal_functions.txt` is a clean mkdocs HTML export: one `<h2>`
per function category and one `<h3 id="...">NAME</h3>` per documented
function, each followed by description prose, a `Syntax:  <code>...</code>`
paragraph, an optional Arguments/Description `<table>`, a `Returns:` paragraph,
and an `Example` code block. This is far more reliable to parse than the
original PDF-text extraction, which merged unrelated tables (e.g. GPIO pin
availability rows) into function descriptions and let parameter names leak
into the `returns` field.

    python tools/extract_4dgl_docs.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bs4 import Tag

from _html_extract_utils import (
    clean_text,
    extract_code_blocks,
    extract_notes,
    load_article_children,
    section_body as _section_body,
    table_rows,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "Resources" / "diablo16_internal_functions.txt"
DEFAULT_OUTPUT_DIR = ROOT / "data"


def library_from_source(source: Path) -> str:
    """Infer a library id (e.g. "goldelox") from a source filename like
    "goldelox_internal_functions.txt"."""
    return source.stem.replace("_internal_functions", "")

SYNTAX_LABEL_RE = re.compile(r"^syntax\s*:", re.IGNORECASE)
RETURNS_LABEL_RE = re.compile(r"^returns?\s*:", re.IGNORECASE)
EXAMPLE_LABEL_RE = re.compile(r"^examples?\s*:?\s*$", re.IGNORECASE)
ARGUMENT_HEADERS = {("Arguments", "Description"), ("Argument", "Description")}


def find_label_index(body: list[Tag], pattern: re.Pattern) -> int | None:
    for idx, tag in enumerate(body):
        if tag.name == "p" and pattern.match(clean_text(tag.get_text())):
            return idx
    return None


def parse_returns(body: list[Tag]) -> str:
    idx = find_label_index(body, RETURNS_LABEL_RE)
    if idx is None:
        return ""
    text = clean_text(body[idx].get_text())
    text = RETURNS_LABEL_RE.sub("", text).strip()
    if text.lower() == "none":
        return "void"
    return text


def parse_signature_variants(body: list[Tag]) -> list[str]:
    idx = find_label_index(body, SYNTAX_LABEL_RE)
    if idx is None:
        return []
    variants = []
    for code in body[idx].find_all("code"):
        text = clean_text(code.get_text()).rstrip(";")
        if text and text not in variants:
            variants.append(text)
    return variants


def parse_parameters(body: list[Tag]) -> list[dict]:
    parameters: list[dict] = []
    for tag in body:
        tables = [tag] if tag.name == "table" else tag.find_all("table")
        for table in tables:
            headers = tuple(clean_text(th.get_text()) for th in table.find_all("th"))
            if headers not in ARGUMENT_HEADERS:
                continue
            for row in table_rows(table):
                if len(row) >= 2 and row[0]:
                    parameters.append({"name": row[0], "description": row[1]})
    return parameters


def parse_description(body: list[Tag], syntax_idx: int | None) -> str:
    zone = body[:syntax_idx] if syntax_idx is not None else body
    parts = [clean_text(t.get_text()) for t in zone if t.name == "p"]
    return " ".join(p for p in parts if p)


def parse_examples(body: list[Tag]) -> list[str]:
    idx = find_label_index(body, EXAMPLE_LABEL_RE)
    if idx is None:
        return []
    return extract_code_blocks(body[idx + 1 :])[:2]


def build_function_entry(
    name: str, body: list[Tag], category: str, anchor: str, source_name: str, library: str
) -> dict:
    syntax_idx = find_label_index(body, SYNTAX_LABEL_RE)
    signature_variants = parse_signature_variants(body)
    signature = signature_variants[0] if signature_variants else name

    return {
        "signature": signature,
        "signatureVariants": signature_variants,
        "parameters": parse_parameters(body),
        "returns": parse_returns(body),
        "description": parse_description(body, syntax_idx),
        "notes": extract_notes(body),
        "examples": parse_examples(body),
        "category": category,
        "library": library,
        "source": {"document": source_name, "anchor": anchor},
    }


def build_database(source: Path, library: str) -> dict[str, dict]:
    kids = load_article_children(source)
    functions: dict[str, dict] = {}
    category = ""

    for i, tag in enumerate(kids):
        if tag.name == "h2":
            category = clean_text(tag.get_text())
            continue
        if tag.name != "h3":
            continue

        name = clean_text(tag.get_text())
        if name in functions:
            # Keep the first documented block; skip accidental repeats.
            continue

        body, _ = _section_body(kids, i)
        functions[name] = build_function_entry(
            name, body, category, tag.get("id") or "", source.name, library
        )

    expand_signature_aliases(functions)
    return dict(sorted(functions.items(), key=lambda item: item[0].lower()))


CALLABLE_NAME_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*\(")


def expand_signature_aliases(functions: dict[str, dict]) -> None:
    """Some sections document several callables together under one heading,
    e.g. "COM_TX_pin" documents COM1_TX_pin/COM2_TX_pin/COM3_TX_pin with a
    single "X or Y or Z" Syntax line. The heading name itself ("COM_TX_pin")
    is not something a program can call, so register the entry under each
    real callable name pulled from its signature variants instead, and only
    keep the heading key if it is itself one of those callables.
    """
    for heading_name, entry in list(functions.items()):
        variants = entry.get("signatureVariants") or []
        if len(variants) <= 1:
            continue

        variant_names = []
        for variant in variants:
            match = CALLABLE_NAME_RE.match(variant)
            if match:
                variant_names.append(match.group(1))

        if not variant_names:
            continue

        for variant_name in variant_names:
            functions.setdefault(variant_name, entry)

        if heading_name not in variant_names:
            del functions[heading_name]


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract 4DGL function docs to JSON.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="HTML functions reference file")
    parser.add_argument("--library", help="Library id (default: inferred from --source filename)")
    parser.add_argument("--output", type=Path, default=None, help="Output JSON path")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Source not found: {args.source}")

    library = args.library or library_from_source(args.source)
    output = args.output or (DEFAULT_OUTPUT_DIR / f"4dgl_functions_{library}.json")

    functions = build_database(args.source, library)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(functions, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(functions)} functions to {output}")


if __name__ == "__main__":
    main()
