"""Shared helpers for parsing the mkdocs-generated HTML mirrors of the 4DGL
manuals (`directives_and_syntax.txt`, `diablo16_internal_functions.txt`).

Both files share the same document shape: an `<article>` whose direct
children are a flat, ordered sequence of `<h1>`-`<h4>` headings (with stable
`id` anchors), `<p>` prose, `<table>`/`<ul>` content, `<div class="admonition">`
callouts, and `<div class="highlight"><pre><code>` Pygments-tagged code
blocks (optionally wrapped in `<div class="tabbed-set">` for multiple
variants).
"""

from __future__ import annotations

import re

try:
    from bs4 import BeautifulSoup, Tag
except ImportError as exc:  # pragma: no cover - user-facing dependency guard
    raise SystemExit(
        "Missing dependency: beautifulsoup4. Install it with "
        "`python -m pip install beautifulsoup4`."
    ) from exc

from pathlib import Path

HEADING_LEVEL = {"h1": 1, "h2": 2, "h3": 3, "h4": 4}


def clean_text(text: str) -> str:
    text = text.replace("\xa0", " ").replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\s*\n\s*", " ", text).strip()


def clean_code(text: str) -> str:
    lines = [line.rstrip() for line in text.split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


def load_article_children(path: Path) -> list[Tag]:
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
    article = soup.find("article")
    if article is None:
        raise SystemExit(f"Could not find <article> content in {path}")
    return [c for c in article.contents if isinstance(c, Tag)]


def find_heading_index(kids: list[Tag], anchor_id: str) -> int:
    for i, tag in enumerate(kids):
        if tag.name in HEADING_LEVEL and tag.get("id") == anchor_id:
            return i
    raise KeyError(f"Anchor not found: {anchor_id}")


def section_body(kids: list[Tag], start_index: int) -> tuple[list[Tag], int]:
    """Return the tags between kids[start_index] (a heading) and the next
    heading of the same or shallower level, plus the index that heading was
    found at (or len(kids))."""
    level = HEADING_LEVEL[kids[start_index].name]
    j = start_index + 1
    while j < len(kids):
        tag = kids[j]
        if tag.name in HEADING_LEVEL and HEADING_LEVEL[tag.name] <= level:
            break
        j += 1
    return kids[start_index + 1 : j], j


def extract_notes(body: list[Tag]) -> list[str]:
    notes = []
    for tag in body:
        if tag.name != "div" or "admonition" not in (tag.get("class") or []):
            continue
        parts = []
        for el in tag.find_all(["p", "li"]):
            if "admonition-title" in (el.get("class") or []):
                continue
            t = clean_text(el.get_text())
            if t:
                parts.append(t)
        if parts:
            notes.append(" ".join(parts))
    return notes


def extract_code_blocks(tags: list[Tag]) -> list[str]:
    blocks = []
    for tag in tags:
        is_highlight_div = tag.name == "div" and "highlight" in (tag.get("class") or [])
        highlights = [tag] if is_highlight_div else tag.find_all("div", class_="highlight")
        for div in highlights:
            code = div.find("code")
            if not code:
                continue
            text = clean_code(code.get_text())
            if text and text not in blocks:
                blocks.append(text)
    return blocks


def table_rows(table: Tag) -> list[list[str]]:
    """Return the <td>-only rows of a table (header <th> rows are skipped)."""
    rows = []
    for tr in table.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        rows.append([clean_text(c.get_text()) for c in cells])
    return rows
