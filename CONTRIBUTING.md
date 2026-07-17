# Contributing

> Note: All documentation and functions are derived from 4D System's official documentation:
> https://resources.4dsystems.com.au/ . This repository has explicit permission from 4D Systems
> to build intellisense using their documentation provided that this repository remains open
> source.

Phase 1 intentionally avoids a parser or language server. Built-in function docs are extracted
into JSON ahead of time and used directly for hover documentation, function autocomplete, and
signature help. See [CLAUDE.md](CLAUDE.md) for the full architecture writeup (data pipeline,
provider wiring, known quirks) if you're changing extension code.

## Running locally

Open this folder in VS Code and press `F5` to start an Extension Development Host. The provider
code is plain JavaScript, so there's no build step before local testing. Open a `.4dg` or
`.4dgl` file and try:

```4dgl
gfx_Line(10, 10, 100, 100, BLUE);
```

Hover over `gfx_Line`, type `gfx_` for completions, or place the cursor inside the call for
signature help.

## Documentation extraction

Built-in function docs, native constants, and language keywords/pre-processor directives are all
extracted from the pure-HTML mirrors of the manuals under `Resources/`, not the PDFs. The HTML has
real `<table>`/`<p>` structure, which is far more reliable than PDF text extraction — the previous
PDF-based approach let unrelated tables (e.g. a GPIO pin availability table) bleed into function
descriptions, and had no way to distinguish a real documented constant from a variable name that
merely appeared in an example snippet.

Install the extractor dependency once:

```sh
python -m pip install beautifulsoup4 pdfplumber
```

Then regenerate everything:

```sh
python tools/extract_all_libraries.py   # Resources/<library>_internal_functions.txt -> data/4dgl_{functions,constants}_<library>.json, for all 4 libraries
python tools/extract_4dgl_syntax.py     # Resources/directives_and_syntax.txt        -> data/4dgl_keywords.json
python tools/extract_4dgl_colors.py     # Resources/colors.pdf                       -> data/4dgl_colors.json
```

`extract_4dgl_docs.py`/`extract_4dgl_constants.py` can also be run against a single library via
`--source Resources/<library>_internal_functions.txt` (`--library`/`--output` are inferred from
the source filename if omitted).

- `data/4dgl_functions_<library>.json` — one entry per built-in function (signature, parameters, returns, description, examples).
- `data/4dgl_constants_<library>.json` — native constants sourced only from documented tables/prose ranges (no examples-derived fabrications like `HELLO`/`OK`/`TEST`).
- `data/4dgl_keywords.json` — language keywords (`private`, `while`/`wend`, `repeat`/`until`/`forever`, `for`/`next`, `func`/`endfunc`, `gosub`/`endsub`, `switch`/`case`/`endswitch`, `break`/`continue`, `goto`, ...) and pre-processor directives (`#DATA`/`#END`, `#MODE`, `#STACK`, `#inherit`, `#IF`/`#IFNOT`/`#ELSE`/`#ENDIF`, `#USE`, `#STOP`, `#MESSAGE`/`#NOTICE`/`#ERROR`, ...), each with signature, description, parameter/related-statement tables, and examples.

`tools/_html_extract_utils.py` holds the shared HTML-walking helpers (all three HTML-based
extractors rely on the same `<article>` → heading → section-body traversal).

The PDFs under `Resources/` are kept for reference only; nothing is generated from them anymore
except `colors.pdf`, which has a genuine text layer and is read directly by `extract_4dgl_colors.py`.

Diff the output before committing — these scripts are heuristic (header-keyword column
classification, prose range regexes) and a source-doc change can shift results in ways worth a
quick sanity check (`git diff --stat data/`, spot-check a few entries).

## Testing changes

There's no automated test suite. To verify extension changes:

1. Press `F5` to launch an Extension Development Host.
2. Open a `.4dgl`/`.4dg` test file and check hover, `Ctrl+Space` completion, and syntax
   highlighting for both built-ins (e.g. `gfx_Line`, `ABS`) and keyword/directive coverage
   (`private`, `#DATA`, `wend`, `forever`, `endswitch`, `gosub`, `sizeof`, `#MODE`, `#STACK`,
   `#inherit`).

To sanity-check just the data layer without VS Code, `node -e` and `require()` the extension
modules directly — most of `extension/` only depends on `fs`/`path`, not `vscode`, so it runs
under plain Node.

## Packaging

Install the VSCE packager, then build a `.vsix`:

```sh
npm install
npm run package
```

Install the generated package:

```sh
code --install-extension 4dgl-intellisense-<version>.vsix
```

The generated JSON database is deliberately isolated under `data/` so a future parser or language
server can reuse it without coupling to VS Code provider code.
