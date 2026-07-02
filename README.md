# 4DGL VSCode Extension

> Note: All documentation and functions are derived from 4D System's official documentation: https://resources.4dsystems.com.au/ . 

This extension adds initial IDE support for 4D Systems 4DGL on Diablo16 devices. Note that this repository has explicit permission from 4DGL to build intellisense using their documentation provided that this repository remains open source.

Phase 1 intentionally avoids a parser or language server. Built-in function docs are extracted into JSON and used directly for:

- Hover documentation
- Function autocomplete
- Signature help

## Internal functions libraries

4D Systems ships several display chips (Diablo16, Goldelox, Picaso, Pixxi), each with its own
internal-functions manual and largely non-overlapping function/constant set — only 18 functions
are common to all four. The extension can only target one library at a time; pick it via the
`4dgl.library` setting or the `4DGL: Switch Internal Functions Library` command (settable
globally or per-workspace). If unset, you're prompted the first time the extension activates.

Colour constants (`colors.pdf`) and language keywords/pre-processor directives
(`directives_and_syntax.txt`) are shared across all libraries and always available regardless of
which internal functions library is active.

## Documentation Extraction

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
- `data/4dgl_constants_<library>.json` — native constants sourced only from documented tables/prose ranges (no more examples-derived fabrications like `HELLO`/`OK`/`TEST`).
- `data/4dgl_keywords.json` — language keywords (`private`, `while`/`wend`, `repeat`/`until`/`forever`, `for`/`next`, `func`/`endfunc`, `gosub`/`endsub`, `switch`/`case`/`endswitch`, `break`/`continue`, `goto`, ...) and pre-processor directives (`#DATA`/`#END`, `#MODE`, `#STACK`, `#inherit`, `#IF`/`#IFNOT`/`#ELSE`/`#ENDIF`, `#USE`, `#STOP`, `#MESSAGE`/`#NOTICE`/`#ERROR`, ...), each with signature, description, parameter/related-statement tables, and examples.

`tools/_html_extract_utils.py` holds the shared HTML-walking helpers (all three HTML-based
extractors rely on the same `<article>` → heading → section-body traversal).

The PDFs under `Resources/` are kept for reference only; nothing is generated from them anymore
except `colors.pdf`, which has a genuine text layer and is read directly by `extract_4dgl_colors.py`.

## Running Locally

Open this folder in VSCode and press `F5` to start an Extension Development Host. The Phase 1 provider code is plain JavaScript, so there is no TypeScript build step before local testing. Open a `.4dg` or `.4dgl` file and try:

```4dgl
gfx_Line(10, 10, 100, 100, BLUE);
```

Hover over `gfx_Line`, type `gfx_` for completions, or place the cursor inside the call for signature help.

## Packaging

Install the VSCE packager, then build a `.vsix`:

```sh
npm install
npm run package
```

Install the generated package:

```sh
code --install-extension 4dgl-vscode-0.0.1.vsix
```

The generated JSON database is deliberately isolated under `data/` so a future parser or language server can reuse it without coupling to VSCode provider code.

## Licensing

This extension is released under the MIT License.

4DGL language information, function names, constants, and reference material
remain the intellectual property of 4D Systems. Their inclusion in this
project is used with permission from 4D Systems for the purpose of providing
editor tooling for the 4DGL programming language.

This project is not officially affiliated with 4D Systems.

See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for details.
