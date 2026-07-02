# 4DGL Documentation Data

Function and constant data is generated per internal-functions library (diablo16, goldelox,
picaso, pixxi) from the pure-HTML mirrors of the vendor manuals under `Resources/` — see the
root `README.md` for setup. `colors.pdf` and `directives_and_syntax.txt` are library-agnostic and
produce a single shared database each.

`4dgl_functions_<library>.json` / `4dgl_constants_<library>.json` are generated for all four
libraries in one shot by:

```sh
python tools/extract_all_libraries.py
```

(or individually via `python tools/extract_4dgl_docs.py --source Resources/<library>_internal_functions.txt`
and the equivalent `extract_4dgl_constants.py` invocation — `--library` is inferred from the
source filename if omitted).

`4dgl_keywords.json` — language keywords and pre-processor directives, shared across all
libraries — is generated from `Resources/directives_and_syntax.txt` by:

```sh
python tools/extract_4dgl_syntax.py
```

`4dgl_colors.json` — named colour constants, also shared across all libraries — is generated
from `Resources/colors.pdf` by:

```sh
python tools/extract_4dgl_colors.py
```

The VSCode extension consumes this JSON directly (`extension/docDatabase.js`,
`extension/keywordDatabase.js`, `extension/libraryManager.js`). The active library is chosen via
the `4dgl.library` setting (or the `4DGL: Switch Internal Functions Library` command); switching
it reloads the function/constant databases without restarting the extension host.

Keep generated documentation data isolated here so it can later be reused by a language server.
