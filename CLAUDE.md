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
The one thing that reads the source token-by-token is `extension/syntaxValidator.js`, and it is
still not a parser: it is a lexer plus a block-structure stack machine, with no expression
grammar, no name resolution, and no pre-processor evaluation. `extension/semanticChecks.js` is
the one place that does consult the symbol databases, for name and argument-count diagnostics,
and it is built around how *incomplete* that knowledge is. Keep both that way — see
"Syntax diagnostics" and "Name and arity diagnostics" below for why.

## Data pipeline (read this before touching `data/*.json`)

JSON databases under `data/` are **generated**, not hand-edited — with exactly one exception,
`data/4dgl_name_corrections.json`, described at the end of this section. Function/constant data is
per-library; keywords and colors are shared:

| File | Generator | Source |
|---|---|---|
| `data/4dgl_functions_<library>.json` (diablo16/goldelox/picaso/pixxi) | `tools/extract_4dgl_docs.py` | `Resources/<library>_internal_functions.txt` |
| `data/4dgl_constants_<library>.json` (diablo16/goldelox/picaso/pixxi) | `tools/extract_4dgl_constants.py` | `Resources/<library>_internal_functions.txt` |
| `data/4dgl_keywords.json` | `tools/extract_4dgl_syntax.py` | `Resources/directives_and_syntax.txt` |
| `data/4dgl_colors.json` | `tools/extract_4dgl_colors.py` | `Resources/colors.pdf` |
| `data/4dgl_arity_unverified.json` | `tools/verify_arity.js` | every `Resources/*.txt` (cross-checks the other outputs) |
| `data/4dgl_name_corrections.json` | **hand-maintained**, evidence from `tools/audit_names.js` | — |

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

### The one hand-maintained file: `data/4dgl_name_corrections.json`

Some of the source manuals are themselves wrong, and no extractor can produce a correct name from
an incorrect document. This file fixes those cases, and `extension/docDatabase.js` applies it at
load time — not baked into the generated JSON, so regenerating can never silently undo it. Every
operation is conditional (a rename is a no-op where the key doesn't exist, an addition never
overwrites), so one shared file serves all four libraries.

Run `node tools/audit_names.js` to produce the evidence for an entry; **don't add one it can't
justify.** It reports three classes:

- **Keys that aren't identifiers.** Definitely wrong, since nothing can call them: `img_ FileSize`
  (a stray space in the heading), `gfx_Dot()` (parens in the heading),
  `com_Mode(Databits, parity, Stopbits, comport)` (the whole signature used as the name), and four
  Goldelox document headings (`Display Modules`, `Programming Tools`, the two register memory maps)
  that aren't functions at all.
- **Case-only disagreement between the heading and the entry's own Syntax line**, decided by how
  often each spelling appears in the manuals' example code — 4DGL is case sensitive, so the
  spelling the vendor actually compiles is the real one. `mem_free` loses 0–10 to `mem_Free`, and
  `mem_alloc` 0–3 to `mem_Alloc`. Where it's a genuine tie (`sys_GetDate`/`sys_Getdate`,
  `sys_PmmC`/`sys_Pmmc`, `pin_HI`/`pin_Hi` — one example use each) **both spellings are registered
  as aliases** rather than picking a winner, so neither gets reported as a misspelling of the other.
  Note this is *not* the deliberate multi-variant aliasing (`I2C2_Ack` documented under
  `I2C1_Ack`); those differ by more than case and the audit filters them out.
- **Constant family outliers.** `SPI_SPEER5` sits between `SPI_SPEED4` and `SPI_SPEED6` in the
  vendor's own SPI speed table, with 15 other `SPI_SPEED*` members and zero uses anywhere. A plain
  typo in the source.

The `add` list is the narrow exception to all of this, for constants documented **only** in
argument-description prose — `TRANSPARENT` and `OPAQUE` appear as "mode TRANSPARENT or OPAQUE
(0 or 1)" in `gfx_FillPattern`'s and `txt_Set`'s argument tables, never as a name/value row, so
`extract_4dgl_constants.py` has nothing to match. This is **not** a general fix for that
extraction gap: a sweep of the corpus found ~300 distinct ALL_CAPS names unaccounted for
(`TOUCH_STATUS`, `FONT2`, `FILE_READ`, the `[HEX4]`/`[DEC2Z]` putnum specifier families, ...).
Those stay missing, which costs nothing for diagnostics — the near-miss rule stays silent on a
name resembling nothing known — but does mean hover and completion don't know them either. Closing
it properly means teaching `extract_4dgl_constants.py` to read "X or Y" argument prose and the
specifier tables it currently skips.

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
node tools/verify_arity.js             # last: it reads the function databases above
node tools/audit_names.js              # review: does anything need a new corrections entry?
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
- **`activate()` awaits an interactive prompt partway through, so registration order is
  load-bearing.** `ensureLibrarySelected` shows a QuickPick when `4dgl.library` isn't set (and a
  second one for the config scope after a pick), and `activate` `await`s it. While that prompt sits
  unanswered, *nothing* below that line has registered — the feature just appears not to exist, with
  no error anywhere. Escaping the prompt is handled (it resolves `undefined` and activation
  continues), but leaving it open is not. This is exactly how syntax diagnostics looked broken on a
  first run. Register anything that doesn't need the library — `registerDiagnostics`,
  `registerLanguageDetection` — *above* the await, and if you add a feature that genuinely does need
  it, expect it to be dead until the user answers.
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
- **Bash heredocs mangle content on this setup**: a quoted heredoc (`<<'EOF'`) is supposed to pass
  its body through literally, but backslash sequences get collapsed before the interpreter sees
  them (`\\P` arrived as `\P`, `\\n` became a real newline mid-word) and a long body can fail
  outright with `unexpected EOF while looking for matching`. Both were hit while adding
  `syntaxValidator.js`. Use `Write`/`Edit` for any new file or any content containing backslashes,
  and reserve heredocs for short, backslash-free snippets.

## Syntax diagnostics

`extension/syntaxValidator.js` (pure logic, no `vscode` import — runs under plain Node) turns
source text into `{code, severity, message, line, character, endLine, endCharacter, related}`
records; `extension/diagnostics.js` is the thin VS Code layer that debounces edits and publishes
them to a `DiagnosticCollection`. Squiggle, Problems-panel entry, and hover text all come from
that one collection — there is no diagnostics-specific hover code, VS Code renders diagnostics
in the hover for free alongside whatever `hover.js` returns.

**The design constraint is false positives, not coverage.** A checker that flags working code
gets switched off, and then it catches nothing. So: nothing is reported that needs name
resolution, type information, or pre-processor evaluation. In particular there is deliberately no
"unknown function/constant" check — the extension can't see symbols from `#inherit` targets
outside the workspace (README calls this out as a known limitation), so that check would fire
constantly on real projects. Don't add it without solving that first.

The regression check for this is the vendor manuals themselves: `Resources/*.txt` hold ~3,270
`<code>` blocks of 4D Systems-authored 4DGL. Extract them with BeautifulSoup and run the
validator over every one; of the ~209 that look like complete programs (they define and close at
least one `func`), 199 must come back with zero diagnostics. The 10 that don't are all accounted
for: four are manual typos or OCR damage (`funclist[1]: = baa;`, `hit"ounter++`,
`gfx_ LedDigits value ,`, `img_SequentialRead(55, p) p);`), two are syntax templates using
`[optional]` meta-brackets, one is a truncated excerpt, and three are long string literals that
the vendor *PDF* hard-wrapped mid-token — the wraps are a typesetting artifact preserved by the
mkdocs export, not evidence that 4DGL strings span lines. Re-run this after touching the
validator; a new entry in that list is a false positive until proven otherwise.

### Language facts the reference doesn't state plainly

These were all found by running the validator against the vendor corpus, and every one of them
was a false positive first:

- **`else if (...)` is a chain, not a nested `if`.** A whole `if / else if / else if / else`
  chain is closed by a *single* `endif` — see "Example 4DGL Code" in the Goldelox manual, which
  has a four-branch chain with one `endif`. 4DGL has no `elseif` keyword (CLAUDE.md already noted
  that); the chain is spelled as two words. The validator detects it as "`else` immediately
  followed by `if` on the same line" and continues the existing block instead of pushing a new
  one. A genuinely nested if has to be written with the `if` on the *next* line.
- **`default` is a legal `goto` label name.** The same Goldelox sample contains `goto default;`
  and a bare `default:` outside any switch, so `default` cannot be required to sit inside a
  `switch` even though it is part of the switch construct. `case` can be, and is.
- **`if`/`while`/`for` have single-statement forms with no closer** (`if (c) s;`), and the block
  form can also be written entirely on one line (`if (c) s; endif`). The validator distinguishes
  them by looking at what follows the condition's `)` on that line: nothing → block form;
  the construct's own closer → block form; anything else → single-statement form. A `{` is
  explicitly excluded from "anything else", because reading `if (c) {` as a one-liner turns one
  misplaced brace into a cascade of orphan-`endif` errors below it.
- **`#IF`/`#ELSE`/`#ENDIF` are orthogonal to block structure**, so they get their own stack. A
  `#IF`/`#ELSE` pair may open a construct in one branch and its counterpart in the other, and an
  `#ENDIF` may fall in the middle of a block that opened before it and closes after it. `#ELSE`
  rewinds the *code* stack to what it was at the `#IF` (silently, no error) so branch one's opens
  don't leak into branch two; `#ENDIF` doesn't touch the code stack at all.
- **`#constant #alias $#REAL` redefines a directive name** ("Redefining Pre-Processor
  Directives"), which is how a file gets `#ifdef`/`#define`/`#include`. The validator collects
  those aliases per file and resolves an aliased directive to what it stands for, so an aliased
  `#ifdef` opens a block exactly as `#IF` does. The `$#REAL` token *names* a directive without
  invoking it, hence the separate `"ref"` token type — lex it as a directive and it opens a
  phantom block.
- **Braces never appear in 4DGL.** Zero of the ~3,270 vendor code blocks contain `{` or `}`
  outside a string, and the "Identifiers" section lists both as characters an identifier may not
  contain. Flagging them is safe and catches the C reflex.
- **A bare `=` is almost certainly always wrong** (`:=` assigns, `==` compares). Every bare `=`
  in the corpus is in prose, compiler output, a formula, or a known manual typo — none in real
  4DGL. It's still only a *warning*, and individually switchable
  (`4dgl.diagnostics.assignmentOperator`), because the reference never says so outright.

## Name and arity diagnostics

`extension/semanticChecks.js` holds the two checks that need to know what's defined: "is this
name a typo" and "does this call have the right number of arguments". It shares
`syntaxValidator.js`'s lexer via the exported `tokenize` — don't grow a second one.

**The databases are incomplete, and no amount of extractor work fixes it.** Two independent
reasons, both measured against the vendor corpus:

- `#inherit`/`#include`/`#use` targets routinely live outside the workspace (the 4D Systems
  include folder isn't bundled — README lists this as a known limitation), so their symbols are
  invisible.
- The manuals document real callables **only in prose**. `gfx_Clipping`, `gfx_ScreenMode`,
  `txt_FGcolour`, `gfx_ObjectColour` and friends appear in example code and in sentences like
  "or the shortcut `gfx_Clipping(ON)`", with no heading and no Syntax line for
  `extract_4dgl_docs.py` to find. There is nothing to extract; inventing entries from prose
  mentions is the heuristic guessing the pipeline section warns against.

So the name checks **do not ask "is this defined?"** — that question flags 5.66% of correct call
sites in the vendor's own code (261 of 4,610). They ask "is this a misspelling of something
known?", via a bounded optimal-string-alignment distance, and stay silent on anything that
resembles nothing. That drops it to 0.71%, and most of the residue is a genuine case-sensitivity
bug in 4D Systems' examples (`pin_set` for `pin_Set`, `sys_Getdate` for `sys_GetDate`,
`mem_Free` for `mem_free`). If you are tempted to "improve" this into a real definedness check,
re-read those numbers first.

Details worth not rediscovering:

- **Transpositions count as one edit.** Plain Levenshtein scores `BLEU`→`BLUE` as 2, which the
  budget for a 4-character name won't allow, so the single most common colour typo goes unnoticed
  without it.
- **Names of four characters or fewer get no budget at all.** One edit on a short name is usually
  a different name, not a misspelling of this one.
- **Only ALL_CAPS references are checked as constants.** A lower-case or mixed-case identifier is
  indistinguishable from a variable, and `documentParser.js` has known gaps in declaration
  parsing (`var private x;` is missed entirely, and `byte a, b;` only records `a`), so anything
  broader turns those gaps into user-visible warnings.
- **Candidate names are filtered to valid identifiers.** A few database keys aren't callable at
  all — `img_ FileSize` has a space in it, and the Goldelox function file contains headings like
  `16-bit Registers Memory Map`. They can never be the right suggestion.
- **Arity comes from `signature`, never from `parameters.length`.** The manuals group related
  arguments into one table row, so `gfx_Line(x1, y1, x2, y2, colour)` arrives with three
  `parameters` entries for five arguments. `arityFromSignature` returns null — meaning "don't
  check" — for a variadic `(...)`, an `[optional]` argument, or an entry whose parentheses were
  lost in extraction (`lookup16`, `disp_WrGRAM`).
- **A call using the `@` argument-pointer operator is never arity-checked.** `gfx_Rectangle(@ rect+n)`
  supplies a whole argument list from one expression, so the syntactic count means nothing.
- **`data/4dgl_arity_unverified.json` retires the signatures the manuals contradict.** Generated
  by `tools/verify_arity.js` (`npm run verify-arity`), which counts the arity of every call in
  every `<code>` block and compares it against the signature. 29 of ~1,300 functions disagree:
  variadic ones written as fixed (`lookup8`, `lookup16`), ones missing an argument from their
  Syntax line (`file_Close`, `I2C2_AckPoll`), ones with a second lvalue form
  (`pokeW(addr) := value`), and genuine per-library differences with examples cross-contaminated
  between manuals (`spi_Init`). Without this the check produced 245 findings on vendor code;
  with it, 10 — and all 10 are `name()` written in a Revision History table. The script measures
  agreement rather than rewriting signatures, because choosing which source is right would be
  guessing, and `data/*.json` is generated, not hand-edited.
- **A bare `name()` in the manuals is usually prose**, not a zero-argument call ("use
  `gfx_MoveTo()` to set the origin"). `verify_arity.js` only counts it as evidence when the line
  also has a `;` or `:=`, which keeps 10 functions checkable while still catching the real
  zero-argument call in `val := disp_ReadWord();`.
- **The lexer must emit a token for every kind of argument.** Numbers, operators, strings and
  char literals were originally skipped, which made `ABS(5)` and `putstr("Tom")` look like
  zero-argument calls — 115 false positives from `putstr` alone. Hence the `"other"` and
  `"literal"` token types. A literal's `text` keeps its quotes, which is what stops a string
  such as `"endif"` from ever matching a structural keyword in the block machine.
- **Included files are first-class here.** `diagnostics.js` passes
  `documentManager.getSymbolsForDocument(uri).functions` — the transitive `#include`/`#use`/
  `#inherit` closure, not just the open file — as `userFunctions`, so inherited functions are both
  known names and candidates a misspelling can match, with exact arity from their real `func`
  declaration. `test/include.test.js` and `test/fixtures/include/` pin this down, including the
  negative case: when the include doesn't resolve, correct calls stay unflagged (they resemble
  nothing known) but typos of those functions go unnoticed too.
- **In-scope names are the union across all functions**, not the set visible at a cursor
  (`completion.js`'s `variablesInScope` does the precise thing). A local of one function won't be
  reported inside another. That's deliberate: precision in that direction only adds false
  positives.

### Gotchas in the VS Code layer

- **`vscode.DiagnosticSeverity.Error` is `0`**, so `SEVERITY[x] || Fallback` silently downgrades
  every error to a warning. `diagnostics.js` uses an `in` check instead. This bug is invisible
  without actually inspecting a published diagnostic's severity.
- **`require("vscode")` never resolves outside the extension host.** `vscode` is not an npm
  package — the host injects it at runtime, and there is nothing to install that would change
  this (`@types/vscode` is types only, and this repo has no build step or `node_modules` to put
  them in). So `node -e "require('./extension/diagnostics.js')"` failing with
  `Cannot find module 'vscode'` is the expected outcome, not a broken setup. Of the 16 files in
  `extension/`, 11 require it directly and `index.js` pulls those in transitively, so only
  `syntaxValidator.js`, `documentParser.js`, `docDatabase.js` and `keywordDatabase.js` load
  standalone. To exercise a host-only module under plain Node, stub the module before requiring
  it — assign a fake into `require.cache["vscode"]` and patch `Module._resolveFilename` to map
  the bare specifier `"vscode"` to itself. That is how the `DiagnosticSeverity.Error === 0` bug
  above was caught; a stub only needs the handful of classes the module actually touches
  (`Diagnostic`, `Range`, `Location`, `DiagnosticRelatedInformation`, `Disposable`,
  `DiagnosticSeverity`, plus `languages.createDiagnosticCollection` and the `workspace.onDid*`
  event registrars, each returning `{dispose(){}}`).
- **Node is on PATH** (v24, via nvm for Windows) as of 2026-08-21. Earlier notes in this file
  said it wasn't and pointed at an Adobe-bundled `node.exe`; that workaround is no longer needed.

## Testing changes

Run `npm test` first — `test/run.js`, no dependencies, ~126 checks. It covers the validator and
the semantic checks as units, `diagnostics.js` and `index.js`'s `activate()` against the stub
`vscode` module in `test/_vscodeStub.js`, the annotated fixture in
`test/fixtures/diagnostics-demo.4dgl`, and a sweep of every check over all ~3,270 vendor code
samples. The corpus thresholds in `test/vendorCorpus.test.js` are ceilings on catalogued residue:
a count going **up** means a new false positive, and a count going **down** means tighten it.

The stub is a singleton on purpose. Node caches modules, so the first test file to require
`diagnostics.js` fixes the `vscode` binding it closes over; a second stub installed later is
silently ignored and its diagnostic collection stays mysteriously empty.

For anything the tests can't reach, verify by hand:

1. Open this folder in VSCode, press `F5` to launch an Extension Development Host. This depends on
   `.vscode/launch.json` (an `extensionHost` config) being present — `.gitignore` deliberately
   un-ignores that one file out of `.vscode/`, because without it `F5` tries to debug the active
   editor instead and prompts to install a debugger for the `.4dgl` file. Reload the dev-host
   window (`Ctrl+R`) after editing `extension/`; there's no build step, but the host caches the
   loaded module.
2. Open a `.4dgl`/`.4dg` test file and check hover, `Ctrl+Space` completion, and syntax highlighting
   for both built-ins (e.g. `gfx_Line`, `ABS`) and the newer keyword/directive coverage (`private`,
   `#DATA`, `wend`, `forever`, `endswitch`, `gosub`, `sizeof`, `#MODE`, `#STACK`, `#inherit`).
3. For diagnostics, open `test/fixtures/diagnostics-demo.4dgl` — it is both the assertion in
   `test/fixture.test.js` and the thing to eyeball, with every check exercised in its lower half
   and every clean construct they could trip over in its upper half. Two rules when extending it:
   anchor an annotation on the line the diagnostic actually points at (the opener for an unclosed
   block, the offending terminator for a mismatch), and keep each broken construct in its own
   `func` — two broken blocks side by side change which reading the error recovery picks, so they
   mask each other.

To poke at a single module without VSCode, `node -e` and `require()` it directly.
`syntaxValidator.js`, `semanticChecks.js`, `documentParser.js`, `docDatabase.js` and
`keywordDatabase.js` are the ones that load standalone; everything else in `extension/` needs the
stub (see the `require("vscode")` gotcha above).
