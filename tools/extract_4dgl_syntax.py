#!/usr/bin/env python3
"""Extract 4DGL language keywords and pre-processor directives from the
HTML mirror of the 4DGL Programmer's Reference.

Unlike the PDF-based extractors, `directives_and_syntax.txt` is a clean
mkdocs HTML export (h2/h3/h4 sections with stable `id` anchors, real
<table> elements for argument lists, and Pygments-tagged <div class="highlight">
code blocks). This script walks a curated list of sections describing
4DGL statements/keywords and pre-processor directives and writes them to
a JSON database that mirrors the shape already used by
`data/4dgl_functions.json` / `data/4dgl_constants.json`.

    python tools/extract_4dgl_syntax.py
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
    find_heading_index,
    load_article_children,
    section_body as _section_body,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "Resources" / "directives_and_syntax.txt"
DEFAULT_OUTPUT = ROOT / "data" / "4dgl_keywords.json"

# (anchor id, keyword/directive spellings, kind, category)
SECTIONS: list[tuple[str, list[str], str, str]] = [
    ("constants", ["#constant", "#CONST"], "directive", "Constants and Variables"),
    ("variables", ["var"], "keyword", "Constants and Variables"),
    ("private-variables", ["private"], "keyword", "Constants and Variables"),
    ("data-blocks", ["#DATA", "#END"], "directive", "Constants and Variables"),
    ("stop", ["#STOP"], "directive", "Pre-Processor Directives"),
    ("use-and-if-using", ["#USE", "#IF USING"], "directive", "Pre-Processor Directives"),
    ("mode", ["#MODE"], "directive", "Pre-Processor Directives"),
    ("stack", ["#STACK"], "directive", "Pre-Processor Directives"),
    ("inherit", ["#inherit"], "directive", "Pre-Processor Directives"),
    ("if-else-endif", ["if", "else", "endif"], "keyword", "Language Flow Control"),
    ("while-wend", ["while", "wend"], "keyword", "Language Flow Control"),
    ("repeat-untilforever", ["repeat", "until", "forever"], "keyword", "Language Flow Control"),
    ("goto", ["goto"], "keyword", "Language Flow Control"),
    ("for-next", ["for", "next"], "keyword", "Language Flow Control"),
    ("switch-endswitch", ["switch", "endswitch", "case"], "keyword", "Language Flow Control"),
    ("break-and-continue", ["break", "continue"], "keyword", "Language Flow Control"),
    ("func-endfunc", ["func", "endfunc", "return"], "keyword", "Functions and Subroutines"),
    ("gosub-endsub", ["gosub", "endsub"], "keyword", "Functions and Subroutines"),
    ("systemreset", ["SystemReset"], "function", "Functions and Subroutines"),
    ("programexit", ["ProgramExit"], "function", "Functions and Subroutines"),
    ("argcount", ["argcount"], "keyword", "Functions and Subroutines"),
]

LABEL_ONLY_RE = re.compile(r"^(syntax|returns?)\s*:?\s*$", re.IGNORECASE)
EXAMPLE_LABEL_RE = re.compile(r"^examples?\s*:?\s*$", re.IGNORECASE)
RELATED_MARKER_RE = re.compile(r"^related statements$", re.IGNORECASE)


def section_body(kids: list[Tag], anchor_id: str) -> list[Tag]:
    body, _ = _section_body(kids, find_heading_index(kids, anchor_id))
    return body


def extract_tables(body: list[Tag]) -> tuple[list[dict], list[dict]]:
    parameters: list[dict] = []
    related: list[dict] = []
    for tag in body:
        tables = [tag] if tag.name == "table" else tag.find_all("table")
        for table in tables:
            in_related = False
            for tr in table.find_all("tr"):
                cells = tr.find_all("td")
                if len(cells) < 2:
                    continue
                name = clean_text(cells[0].get_text())
                description = clean_text(cells[1].get_text())
                if not name and not description:
                    continue
                if RELATED_MARKER_RE.match(name):
                    in_related = True
                    continue
                entry = {"name": name, "description": description}
                (related if in_related else parameters).append(entry)
    return parameters, related


def split_at_example_label(body: list[Tag]) -> int:
    for idx, tag in enumerate(body):
        if tag.name == "p":
            text = clean_text(tag.get_text())
            if EXAMPLE_LABEL_RE.match(text):
                return idx
    return len(body)


def extract_description(zone: list[Tag]) -> str:
    parts = []
    for idx, tag in enumerate(zone):
        if tag.name != "p":
            continue
        text = clean_text(tag.get_text())
        if not text or LABEL_ONLY_RE.match(text):
            continue
        # Skip list-intro captions like "...are:" immediately followed by a <ul>;
        # they read as dangling fragments once the list itself is dropped.
        next_tag = zone[idx + 1] if idx + 1 < len(zone) else None
        if text.endswith(":") and next_tag is not None and next_tag.name == "ul":
            continue
        parts.append(text)
        if len(parts) >= 3:
            break
    return " ".join(parts)


def build_entry(anchor_id: str, names: list[str], kind: str, category: str, kids: list[Tag]) -> dict:
    body = section_body(kids, anchor_id)
    split_idx = split_at_example_label(body)
    syntax_zone = body[:split_idx]
    example_zone = body[split_idx + 1 :]

    description = extract_description(syntax_zone)
    notes = extract_notes(body)
    parameters, related = extract_tables(body)
    syntax_blocks = extract_code_blocks(syntax_zone)
    example_blocks = extract_code_blocks(example_zone)

    return {
        "names": names,
        "kind": kind,
        "category": category,
        "signature": syntax_blocks[0] if syntax_blocks else "",
        "syntaxVariants": syntax_blocks,
        "description": description,
        "notes": notes,
        "parameters": parameters,
        "related": related,
        "examples": example_blocks[:3],
        "source": {"document": DEFAULT_SOURCE.name, "anchor": anchor_id},
    }


# The "Conditional Pre-Processor Directives" section is a prose paragraph
# followed by bullet lists rather than the Syntax/Table/Example pattern used
# everywhere else, so it needs its own small extractor.
def extract_conditional_directives(kids: list[Tag]) -> dict[str, dict]:
    anchor_id = "conditional-pre-processor-directives"
    body = section_body(kids, anchor_id)

    intro_parts = [clean_text(tag.get_text()) for tag in body if tag.name == "p"]
    intro = " ".join(p for p in intro_parts if p)

    entries: dict[str, dict] = {}
    directive_names = ["#IF", "#IFNOT", "#IF EXISTS", "#IFNOT EXISTS", "#ELSE", "#ENDIF"]
    helper_names: dict[str, str] = {}
    notice_names = ["#MESSAGE", "#NOTICE", "#ERROR"]

    for ul in body:
        if ul.name != "ul":
            continue
        for li in ul.find_all("li", recursive=False):
            text = clean_text(li.get_text())
            code = li.find("code")
            if code:
                token = clean_text(code.get_text())
                rest = text.split(code.get_text().strip(), 1)
                desc = clean_text(rest[1]) if len(rest) > 1 else ""
                desc = desc.lstrip("-– ").strip()
                if token in ("sizeof", "argcount"):
                    helper_names[token] = desc
                # else: plain directive bullet, description picked up via intro

    for name in directive_names:
        entries[f"cond-{name}"] = {
            "names": [name],
            "kind": "directive",
            "category": "Pre-Processor Directives",
            "signature": "",
            "syntaxVariants": [],
            "description": intro,
            "notes": [],
            "parameters": [],
            "related": [],
            "examples": [],
            "source": {"document": DEFAULT_SOURCE.name, "anchor": anchor_id},
        }

    for name in notice_names:
        entries[f"notice-{name}"] = {
            "names": [name],
            "kind": "directive",
            "category": "Pre-Processor Directives",
            "signature": "",
            "syntaxVariants": [],
            "description": "Pre-processor directive used to provide helpful notices, warnings, or errors during compilation.",
            "notes": [],
            "parameters": [],
            "related": [],
            "examples": [],
            "source": {"document": DEFAULT_SOURCE.name, "anchor": anchor_id},
        }

    for token, desc in helper_names.items():
        entries[f"helper-{token}"] = {
            "names": [token],
            "kind": "keyword",
            "category": "Pre-Processor Directives",
            "signature": "",
            "syntaxVariants": [],
            "description": desc,
            "notes": [],
            "parameters": [],
            "related": [],
            "examples": [],
            "source": {"document": DEFAULT_SOURCE.name, "anchor": anchor_id},
        }

    return entries


def build_database(source: Path) -> dict[str, dict]:
    kids = load_article_children(source)
    database: dict[str, dict] = {}

    for anchor_id, names, kind, category in SECTIONS:
        database[anchor_id] = build_entry(anchor_id, names, kind, category, kids)

    database.update(extract_conditional_directives(kids))
    return database


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract 4DGL keywords/directives to JSON.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="HTML syntax reference file")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output JSON path")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Source not found: {args.source}")

    database = build_database(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(database, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    name_count = sum(len(entry["names"]) for entry in database.values())
    print(f"Wrote {len(database)} sections ({name_count} keyword/directive spellings) to {args.output}")


if __name__ == "__main__":
    main()
