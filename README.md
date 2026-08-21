# 4DGL Intellisense

IDE support for 4D Systems 4DGL in Visual Studio Code — hover docs, autocomplete, signature
help, semantic highlighting, and error checking for `.4dg`/`.4dgl`/`.lib`/`.inc` files, plus
documentation for your own functions.

> This is an independent, community-built extension and is not affiliated with, endorsed by, or
> maintained by 4D Systems. Function names, constants, and reference text are used with
> permission — see [Licensing](#licensing--attribution) below.

## Features

### Built-in function &amp; constant reference

Hover any built-in function or constant for its signature, description, parameters, return
value, and category — pulled directly from the 4D Systems manuals. Start typing to get
autocomplete, and get live parameter hints as you type inside a call.

```4dgl
gfx_Line(10, 10, 100, 100, BLUE);
```

Hovering `gfx_Line` shows its full signature and description; hovering `BLUE` shows a colour
swatch and hex value; placing the cursor inside the `(...)` shows signature help for the current
parameter.

### Multiple display chip libraries

4D Systems ships several display chips (Diablo16, Goldelox, Picaso, Pixxi), each with its own
function/constant set. Pick the one your project targets with the **4DGL: Switch Internal
Functions Library** command (or the `4dgl.library` setting) — you'll be prompted automatically
the first time the extension activates. Switching applies immediately, no reload required.
Colour constants and language keywords/directives are shared and always available regardless of
which library is active.

### Document your own functions

Write a `//` or `/* */` comment directly above a `func` and it becomes that function's
description everywhere it's referenced — hover, autocomplete, and signature help. Javadoc-style
`@param` and `@return` tags document individual parameters and the return value:

```4dgl
// Adds two numbers together
// @param a the first value
// @param b the second value
// @return the sum of a and b
func addTwo(a, b):
  return a + b;
endfunc
```

Multi-line `/** ... */` block comments work the same way, including a leading `*` on each line.
`@param`/`@return`/`@link` are syntax-highlighted distinctly from regular comment text, and
hovering the tag itself explains what it does (they're a 4DGL Intellisense convention, not part
of the 4DGL language).

Your comment's formatting is preserved — line breaks, blank-line paragraph breaks, and lists all
render as written instead of collapsing into one run-on line. `@param`/`@return` are single-line
by default; a continuation line only extends the tag's text if it's indented by at least one
space, Javadoc-style — an unindented line ends the tag:

```4dgl
// @param a the first line of a's description.
//   This continues a's description because it's indented.
// @param b a plain one-line description.
```

### Cross-linked documentation

Reference another function from a doc comment with a Javadoc-style `{@link}` tag and it renders
as a clickable link — click it and you jump straight to that function's definition (or, for a
built-in, a read-only reference page for it):

```4dgl
// Adds two numbers together. See also {@link #subtractTwo() subtractTwo}.
// @param a the first value
// @param b the second value
// @return the sum of a and b
func addTwo(a, b):
  return a + b;
endfunc
```

The tag is `{@link #methodName() Label text}` — `methodName` is the function being linked to
(no parentheses arguments, just `()`), and the label is the text shown in the link, which can be
multiple words. Only text wrapped in an explicit `{@link}` tag becomes a link — a description
that merely *mentions* another function's name in prose is left as plain text, so nothing gets
linked by accident just because a word in your sentence happens to match a function name.

The same target resolution powers native code navigation, too: Ctrl+click (Cmd+click on macOS)
any function call in your code to jump to it — your own functions take you to their definition,
built-ins open their reference page.

### Multi-file projects

Functions, variables, and constants defined in files pulled in via `#include`, `#use`, or
`#inherit` are visible from the including file, resolved automatically (both relative paths and
bare filenames matched across your workspace). Hovering a function that comes from another file
shows a **Defined in `<file>`** line so you always know where it actually lives.

### Search documentation

Two commands fuzzy-search function names, descriptions, and parameter names/descriptions across
the active library plus your own code, in a quick-pick list. Selecting a result jumps straight to
its definition (your own functions) or opens its reference page (built-ins):

- **4DGL: Search Documentation (Library + Repository)** (`Ctrl+Alt+D` / `Cmd+Alt+D` on macOS) —
  searches the active library plus every function defined anywhere in the workspace that's
  classified as a 4DGL file: any `.4dg`/`.4dgl`/`.lib`/`.inc` file, any file you've manually
  associated with the `4dgl` language (via the `files.associations` setting or "Change Language
  Mode"), and any file currently open under the 4DGL language for the session. Reachability
  through `#include`/`#use`/`#inherit` doesn't matter here — every classified file in the repo is
  included, whether or not the open file actually uses it.
- **4DGL: Search Documentation (Library + Linked Functions)** (`Ctrl+Alt+Shift+D` /
  `Cmd+Alt+Shift+D` on macOS) — searches the active library plus only the functions actually
  reachable from the open file's `#include`/`#use`/`#inherit` chain.

### Syntax error highlighting

Structural mistakes are underlined as you type and explained on mouse-over (and listed in the
Problems panel), so a missing `endfunc` doesn't cost you a Workshop4 compile round-trip:

```4dgl
func drawFrame()
    while (n < 20)      // 'endif' does not close 'while' — expected 'wend'
        n++;
    endif
endfunc
```

What's checked:

- **Block structure** — `func`/`endfunc`, `if`/`endif`, `while`/`wend`, `for`/`next`,
  `switch`/`endswitch`, `repeat`/`until`/`forever`, `#DATA`/`#CONST`/`#END`, `#IF`/`#ENDIF`:
  unclosed blocks, block terminators that don't match what's open, and terminators with nothing
  open. Errors point at the line that opened the construct — the line you have to go fix.
- **Delimiters** — unbalanced or mismatched `(`/`)` and `[`/`]`, and `{`/`}`, which 4DGL never
  uses.
- **Literals** — unterminated strings and unterminated `/* */` comments.
- **Misplaced keywords** — `else` with no `if`, `case` outside a `switch`, `break`/`continue`
  outside a loop or switch, `return`/`endsub` outside a function body.
- **Operators and directives** — a bare `=` (4DGL assigns with `:=` and compares with `==`), and
  pre-processor directives the language reference doesn't document.

Every documented single-line form is understood, so none of these are flagged:
`if (c) x; else y;`, `while (c) x;`, `for (i:=0; i<n; i++) x;`, `repeat x; until (c);`, an
`else if (...)` chain closed by one `endif`, and a `#IF`/`#ELSE` pair that opens a block in one
branch and closes it in the other.

This is a structural check only — it deliberately doesn't resolve names or evaluate pre-processor
conditions, so it never reports an unknown function or constant. That keeps it quiet on real
projects, where vendor `#inherit` targets often live outside the workspace. Turn the whole thing
off with `4dgl.diagnostics.enabled`, or silence just the bare-`=` and unknown-directive warnings
individually — see [Configuration](#configuration).

### Name and argument checks

Beyond structure, calls are checked against the active library and your own code:

```4dgl
gfx_Lyne(0, 0, 100, 100, BLUE);   // 'gfx_Lyne' is not a known function. Did you mean 'gfx_Line'?
gfx_Line(0, 0, 100, 100, BLEU);   // 'BLEU' is not a known constant. Did you mean 'BLUE'?
Pin_Set(PIN_OUT, PA1);            // Did you mean 'pin_Set'? 4DGL is case sensitive.
gfx_Circle(63, 63, rad);          // 'gfx_Circle' takes 4 arguments, but 3 were passed.
```

**Your own functions count as known names, including ones reached through
`#include`/`#use`/`#inherit`** — the same transitive include chain that hover and autocomplete
use. A typo of a function defined in an inherited file is caught and suggested just like a
built-in, and its argument count is checked exactly, from the real `func` declaration. The
requirement is that the include *resolves*: relative to the including file, or by filename
somewhere in the workspace. A target outside your project (the unbundled 4D Systems include
folder, typically) is invisible, and then neither its names nor typos of them are known.

**Names are only reported when they look like a misspelling of something known**, and the report
names the suggestion. A name that resembles nothing recognised is left alone on purpose — the
extension can't see symbols from an `#inherit` target outside your project, and the 4D Systems
manuals document real shortcut functions (`gfx_Clipping`, `gfx_ScreenMode`, `txt_FGcolour`) only
in prose, with no entry for the extractor to find. Asking "is this defined?" would flag 5.7% of
the vendor's own example calls; asking "is this a typo?" brings that to 0.7%, and most of what
remains is a genuine case-sensitivity bug in their examples. Only ALL_CAPS references are checked
as constants, since a lower-case name can't be told apart from a variable.

**Argument counts** are exact for your own functions, taken from the `func` declaration. For
built-ins the count comes from the documented signature, with two safeguards: calls using the `@`
argument-pointer operator are never checked (it supplies a whole argument list from one
expression), and neither are the ~2% of functions whose documented signature the manuals' own
example code contradicts — variadic ones written as if fixed (`lookup8`), ones missing an argument
from their Syntax line (`file_Close`), and ones with a second lvalue form (`pokeW(addr) := value`).
That list is generated by `npm run verify-arity`, not guessed at.

If your project uses a name the manuals don't document, add it to `4dgl.diagnostics.knownNames`
and it will never be reported. Each check can also be turned off individually — see
[Configuration](#configuration).

If a suggestion is ever *wrong* — pointing at a misspelling rather than away from one — that's a
bug in the extracted data, not a judgement call, and worth
[reporting](https://github.com/Vipaswi/4dgl-intellisense/issues). A few are already corrected in
`data/4dgl_name_corrections.json`: several 4D Systems manual sections name a function one way in
their heading and another in their Syntax line, and at least one constant table contains a plain
typo.

### Semantic highlighting

Keywords, pre-processor directives, and built-in functions/constants are semantically
highlighted according to your color theme, on top of the bundled syntax grammar.

## Getting started

1. Install the extension from the VS Code Marketplace (or a `.vsix` — see
   [CONTRIBUTING.md](CONTRIBUTING.md) for building one yourself).
2. Open a `.4dg` or `.4dgl` file. If it isn't already recognized, the extension will offer to
   switch its language mode for you.
3. Pick your target library (Diablo16, Goldelox, Picaso, or Pixxi) when prompted, or set it any
   time via **4DGL: Switch Internal Functions Library**.

### Configuration

| Setting | Description |
|---|---|
| `4dgl.library` | The internal functions library used for hover docs, completion, and signature help (`diablo16`, `goldelox`, `picaso`, or `pixxi`). Leave unset to be prompted on first use. |
| `4dgl.diagnostics.enabled` | Highlight syntax errors in the editor. Default `true`. |
| `4dgl.diagnostics.unknownDirectives` | Warn about a pre-processor directive the 4DGL reference doesn't document. Directives your file redefines with `#constant #alias $#REAL` are recognized. Default `true`. |
| `4dgl.diagnostics.assignmentOperator` | Warn about a bare `=`, which is not a 4DGL operator. Default `true`. |
| `4dgl.diagnostics.unknownFunctions` | Warn when a call looks like a misspelling of a known function. Default `true`. |
| `4dgl.diagnostics.unknownConstants` | Warn when an ALL_CAPS reference looks like a misspelling of a known constant. Default `true`. |
| `4dgl.diagnostics.argumentCount` | Warn when a call passes the wrong number of arguments. Default `true`. |
| `4dgl.diagnostics.knownNames` | Extra names to treat as defined, so they are never reported as unknown. Default `[]`. |

### Keyboard shortcuts

| Command | Default (Win/Linux) | Default (macOS) |
|---|---|---|
| 4DGL: Search Documentation (Library + Repository) | `Ctrl+Alt+D` | `Cmd+Alt+D` |
| 4DGL: Search Documentation (Library + Linked Functions) | `Ctrl+Alt+Shift+D` | `Cmd+Alt+Shift+D` |

These are defaults, not fixed — change either one from **Preferences: Open Keyboard Shortcuts**
(`Ctrl+K Ctrl+S` / `Cmd+K Cmd+S`), searching for the command name and recording your own key
combination. That's standard VS Code behavior for any contributed command: keybindings live in
Keyboard Shortcuts / `keybindings.json`, not in `settings.json`, so there's no `4dgl.*` setting for
this — VS Code doesn't support an extension binding a key combination read from a configuration
value at runtime.

## Known limitations

- Only one internal functions library is active at a time — the extension doesn't merge
  functions across libraries.
- `#include`/`#use`/`#inherit` targets must live within your project directory to resolve; the
  full 4D Systems include folder isn't bundled.
- Diagnostics are not the Workshop4 compiler, in either direction. There are no type checks, and
  an unrecognised name is only questioned when it resembles a known one, so a clean Problems panel
  doesn't guarantee a clean build.

## Licensing &amp; attribution

This extension is released under the [MIT License](LICENSE).

4DGL language information, function names, constants, and reference material remain the
intellectual property of 4D Systems. Their inclusion in this project is used with permission from
4D Systems for the purpose of providing editor tooling for the 4DGL programming language. See
[NOTICE.md](NOTICE.md) for full details.

## Contributing

Want to build from source, regenerate the documentation database, or run the extension locally?
See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and feature requests are welcome at
[github.com/Vipaswi/4dgl-intellisense/issues](https://github.com/Vipaswi/4dgl-intellisense/issues).
