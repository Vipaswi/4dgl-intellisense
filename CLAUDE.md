# CLAUDE.md

Guidance for future Claude Code instances working in this repo.

## What this project is

A VSCode extension (`extension/`, plain JS, no build step) giving IDE support for 4D Systems
4DGL: hover docs, completion, signature help, and semantic highlighting. 4D Systems ships several
display chips (Diablo16, Goldelox, Picaso, Pixxi), each with its own internal-functions manual and
largely non-overlapping function/constant set (a cross-library comparison found only 18 functions
common to all four; diablo16=551 functions/359 constants, goldelox=132/114, picaso=258/182,
pixxi=364/239 after extraction). The extension supports exactly one active library at a time,
chosen via the `4dgl.library` setting (or the `4DGL: Switch Internal Functions Library` command)
— see `extension/libraryManager.js`. Colour constants and language keywords/directives are
library-agnostic and always loaded regardless of which internal functions library is active.

It is intentionally parser-free (Phase 1) — all IDE features are backed by JSON databases
generated offline from the vendor manuals, plus a lightweight regex-based symbol scanner
(`extension/documentParser.js`) for user-defined functions/variables/constants in the open file.

## Data pipeline (read this before touching `data/*.json`)

JSON databases under `data/` are **generated**, not hand-edited. Function/constant data is
per-library; keywords and colors are shared:

| File | Generator | Source |
|---|---|---|
| `data/4dgl_functions_<library>.json` (diablo16/goldelox/picaso/pixxi) | `tools/extract_4dgl_docs.py` | `Resources/<library>_internal_functions.txt` |
| `data/4dgl_constants_<library>.json` (diablo16/goldelox/picaso/pixxi) | `tools/extract_4dgl_constants.py` | `Resources/<library>_internal_functions.txt` |
| `data/4dgl_keywords.json` | `tools/extract_4dgl_syntax.py` | `Resources/directives_and_syntax.txt` |
| `data/4dgl_colors.json` | `tools/extract_4dgl_colors.py` | `Resources/colors.pdf` |

The `.txt` files are **pure-HTML mkdocs exports** of the vendor PDFs, not HTML-escaped PDF text.
They have a very regular shape: an `<article>` whose direct children are a flat sequence of
`<h1>`–`<h4>` (with stable `id` anchors), `<p>` prose, real `<table>` elements, `<div
class="admonition">` callouts, and `<div class="highlight"><pre><code>` Pygments-tagged code
blocks — and this shape is identical across all four `*_internal_functions.txt` manuals, so the
same extractor code handles all of them; only the `--source`/`--library`/`--output` differ per
run (see `tools/extract_all_libraries.py`, which regenerates all four in one shot). **Always
prefer parsing these HTML files over the PDFs** — PDF text extraction (the original approach,
still in git history) merged unrelated table content into function descriptions and had no
reliable way to distinguish a real documented constant from a variable name that merely appeared
in an example snippet. The PDFs are kept in `Resources/` for reference only; nothing is generated
from them anymore.

`data/4dgl_colors.json` is the one exception to "prefer HTML over PDF": `colors.pdf` (4D Systems
app note 4D-AN-00043) has no HTML mkdocs export, but unlike the manual PDFs above it has a
genuine text layer, so `tools/extract_4dgl_colors.py` reads it directly with `pdfplumber`
(`page.extract_text()` + a `NAME 0xHEXVALUE` regex) rather than OCR or image rendering. It's merged
into the runtime constant lookup at load time by `extension/docDatabase.js`'s
`loadConstantDatabase()`, not merged into `4dgl_constants_<library>.json` on disk, since it comes
from an unrelated source document and is shared across all libraries. It also synthesizes two
aggregate lookup entries, `COLOR` and `COLOUR`, whose "description" is a markdown table of every
named colour + hex value — so hovering or completing the bare word `COLOR`/`COLOUR` shows the
full reference list.

`tools/_html_extract_utils.py` holds the shared traversal helpers (`load_article_children`,
`section_body`, `clean_text`, `extract_code_blocks`, `extract_notes`, `table_rows`). The three
HTML-based extractors import from it — extend it rather than re-deriving HTML-walking logic in a
new script. `tools/extract_4dgl_colors.py` doesn't use it (its source is a PDF, not HTML).

To regenerate everything after editing an extractor or re-fetching a manual:

```sh
python -m pip install beautifulsoup4 pdfplumber   # one-time
python tools/extract_all_libraries.py   # all 4 internal-functions libraries
python tools/extract_4dgl_syntax.py
python tools/extract_4dgl_colors.py
```

Diff the output before committing — these scripts are heuristic (header-keyword column
classification, prose range regexes) and a source-doc change can shift results in ways worth a
quick sanity check (`git diff --stat data/`, spot-check a few entries).

## Known quirks / gotchas discovered while building this

- **Python invocation on this machine**: use `python`, not `python3` (the `python3` shim on PATH
  is a Windows Store alias stub that fails). `py` also works.
- **Multi-variant function docs**: some manual sections document several callables under one
  heading with an "X or Y or Z" Syntax line (e.g. `COM_TX_pin` documents `COM1_TX_pin`,
  `COM2_TX_pin`, `COM3_TX_pin`; same pattern for `I2C1_*`/`I2C2_*`/`I2C3_*`, `SPI1_*`/`SPI2_*`/`SPI3_*`,
  `disp_BlitPixelsFromCOM0..3`). `extract_4dgl_docs.py`'s `expand_signature_aliases()` registers the
  entry under each real callable name and drops the non-callable heading name — if you touch that
  function, re-check `COM1_TX_pin` and friends still resolve.
- **Blank `<th>` constant tables**: several constant tables (e.g. `WIDGET_F_FLASH` flags) render
  with empty `<th>` cells (no header text at all), so `extract_4dgl_constants.py` falls back to a
  positional guess (`[name, value, description]` for 3 columns). A few blank-header tables are
  actually "specifier family" tables (e.g. `BIN`/`BIN1`.../`BINZ`/`BINZB` putnum format tokens)
  where every column is itself a valid symbol, not name/value/description — these are detected and
  skipped (see the `startswith` guard in `extract_table_constants`) rather than emitting nonsense
  pairs. If constants extraction seems to fabricate garbage, check whether a new blank-header table
  needs a similar carve-out.
- **`const NAME := value;`** (bare, no `#`) is accepted by `documentParser.js` and kept as a
  keyword in `syntaxes/4dgl.tmLanguage.json` / `semanticTokens.js`, but it is **not** documented
  anywhere in `directives_and_syntax.txt` (only `#constant`/`#CONST...#END` are). This predates the
  HTML-extraction work and was left alone rather than removed — flag it if you find authoritative
  documentation one way or the other.
- **Directive hover/completion**: pre-processor directives start with `#`, which the default VSCode
  word-boundary regex excludes. `hover.js` uses a custom word pattern (`/#?[A-Za-z_][A-Za-z0-9_]*/`)
  so hovering anywhere in `#DATA` resolves; `completion.js` adds `#` as a trigger character.
- **`semanticTokens.js` KEYWORDS must not drift from `data/4dgl_keywords.json`** — it used to be a
  hand-maintained set that had invented non-existent 4DGL keywords (`elseif`, `to`, `step`, `mod`,
  `xor`, `shl`, `shr`, `println`) while missing real ones. It's now built from the generated keyword
  database at require-time (plus a small hard-coded supplement for `word`/`byte`/`long`/`string`/`const`,
  which aren't covered by the syntax-reference sections the generator walks). Don't hand-add tokens
  back to that file — add them to the extractor/registry in `extract_4dgl_syntax.py` instead, or to
  the small supplement set with a comment explaining why.
- **Live library switching mutates in place**: `extension/index.js` creates the hover/completion/
  signature providers once, closing over the `functions`/`constants` plain objects returned by
  `loadFunctionDatabase`/`loadConstantDatabase`. `extension/libraryManager.js`'s
  `onDidChangeConfiguration` handler therefore does **not** reassign those variables when the
  active library changes (the providers would keep the stale reference) — it clears every key on
  the existing object and `Object.assign`s the new library's data into the same object
  (`replaceContents`), so the change is visible to `hover.js`/`completion.js`/`signature.js`
  immediately with no need to re-register providers or reload the window.
- **`activationEvents` used to be `onLanguage:4dgl` only**, meaning the extension activated only
  after VS Code had already assigned a document the `4dgl` language — which meant
  `registerLanguageDetection`'s "this looks like a 4DGL file, switch?" prompt (whose entire job is
  to fix the case where the language *isn't* already `4dgl`) could never actually run. Fixed by
  switching to `onStartupFinished`. If you see this prompt regress to never firing again, check
  `activationEvents` first.
- **Pointer/address sigils (`*name`, `&name`) must be stripped before an identifier is stored**:
  `documentParser.js`'s `stripSigils()` is the one place this happens, for function parameters and
  for `var`/`word`/`byte`/`long`/`string` declarations at both global and local scope — it returns
  `{name, pointer, address}` with the sigil(s) removed from `name`. Everything downstream
  (`completion.js`, `semanticTokens.js`, `signature.js`) keys off the bare `name`; reintroducing a
  raw `p.trim()` (or similar) anywhere in that path will silently break autocomplete for
  pointer-declared identifiers again — that was the original bug. `fn.signature` and the hover
  markdown in `docDatabase.js` reconstruct the sigil for display (`sigilPrefix()` in
  `documentParser.js`, inline `${p.pointer?"*":""}${p.address?"&":""}` in `docDatabase.js`/
  `searchDocs.js`) — remember the display side too when adding a new place that renders a param.
- **Search command keybindings are plain `contributes.keybindings` defaults, not
  settings-driven**: `4dgl.searchDocumentation`/`4dgl.searchDocumentationLinked`
  (`extension/searchDocs.js`) ship default keybindings in `package.json`, but VS Code has no API
  for an extension to bind a key combination read from a configuration value at runtime —
  keybindings are declarative only. Users already rebind them the normal VS Code way (Keyboard
  Shortcuts editor / `keybindings.json`) with zero extra code from this extension; don't build a
  `4dgl.*` setting that claims to "control" the shortcut, since setting it wouldn't actually change
  what key triggers the command.
- **`DocumentManager.getRepositorySymbols()` vs `getSymbolsForDocument()`**: the former (backing
  the repository-wide search command) unions every function from every 4DGL-classified file in the
  workspace — "classified" meaning matches `GLOB_PATTERN`, or is mapped to the `4dgl` language via
  the `files.associations` setting, or is a currently open document with `languageId === "4dgl"` —
  independent of `#include` reachability. `getSymbolsForDocument` is the pre-existing transitive
  include-chain closure. Don't conflate them; `getRepositorySymbols` intentionally ignores
  reachability, which is the whole point of the command it backs.
- **Edit tool + smart quotes**: this repo's source docs are full of curly quotes / en-dashes. The
  `Edit` tool's old_string/new_string matching can silently fail against text containing them
  (mismatch reported even though the file "looks" identical in a terminal — it's usually a
  console-rendering artifact, not real corruption; verify with a byte-level read before assuming the
  file is broken). When in doubt, rewrite the whole file with `Write` instead of chasing an `Edit`
  mismatch on a line with non-ASCII punctuation.

## Testing changes

There's no automated test suite. To verify extension changes:

1. Open this folder in VSCode, press `F5` to launch an Extension Development Host.
2. Open a `.4dgl`/`.4dg` test file and check hover, `Ctrl+Space` completion, and syntax highlighting
   for both built-ins (e.g. `gfx_Line`, `ABS`) and the newer keyword/directive coverage (`private`,
   `#DATA`, `wend`, `forever`, `endswitch`, `gosub`, `sizeof`, `#MODE`, `#STACK`, `#inherit`).

To sanity-check just the data layer without VSCode, `node -e` and `require()` the extension modules
directly — `docDatabase.js` and `keywordDatabase.js` only depend on `fs`/`path`, not `vscode`, so
they run under plain Node (see git history / PR description for example one-liners used during
development).
