# 4DGL Intellisense

IDE support for 4D Systems 4DGL in Visual Studio Code — hover docs, autocomplete, signature
help, and semantic highlighting for `.4dg`/`.4dgl`/`.lib`/`.inc` files, plus documentation for
your own functions.

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

## Known limitations

- Only one internal functions library is active at a time — the extension doesn't merge
  functions across libraries.
- `#include`/`#use`/`#inherit` targets must live within your project directory to resolve; the
  full 4D Systems include folder isn't bundled.

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
