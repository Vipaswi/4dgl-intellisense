# Changelog

## 1.0.1

- Comments directly above a `func` (`//` lines or a `/* */` block) are now picked up as that
  function's documentation, and are shown in its hover, autocomplete, and signature help.
- Added javadoc-style `@param name ...` and `@return ...` tags inside those comments to document
  individual parameters and the return value.
- Added an explicit `{@link #methodName() Label text}` doc tag: only text wrapped in this tag
  becomes a clickable link (to a function you wrote, or a read-only reference page for a
  built-in) — a description merely mentioning another function's name in prose is never linked
  automatically.
- Added go-to-definition: Ctrl/Cmd+click any function call in code to jump straight to it (your
  own functions) or open its reference page (built-ins), no need to hover first.
- Hovering a function pulled in from another file (via `#include`/`#use`/`#inherit`) now shows a
  "Defined in `<file>`" line; built-in functions show which 4D Systems manual they came from.
- Fixed `@param` descriptions not showing up when hovering the parameter itself inside the
  function body (they previously only appeared in the function's own hover/signature help).
- Fixed `@param` not recognizing pointer parameters (4DGL's `*name` "use variable as pointer"
  syntax, e.g. `func f(*vState)`) — a `@param *vState ...` tag now merges correctly instead of
  falling through as plain description text.
- `@param`, `@return`/`@returns`, and `@link` are now syntax-highlighted distinctly from regular
  comment text, and hovering the tag explains what it does — these are a 4DGL Intellisense
  convention, not part of the 4DGL language itself.
- Doc comment formatting (line breaks, blank-line paragraphs, lists) is now preserved in the
  rendered documentation instead of being flattened into a single line. `@param`/`@return` stay
  single-line unless a continuation line is indented by at least one space, Javadoc-style.

## 1.0.0

Now supports Diablo16, Pixxi, Goldelox, and Picaso internal functions and constants. Pick the
active library via the `4dgl.library` setting or the "4DGL: Switch Internal Functions Library"
command; switching reloads hover, completion, and signature help immediately.

Fixed the "this looks like a 4DGL file, switch?" prompt not appearing for `.4dg`/`.4dgl` files
opened under another language mode. It also now offers "Not now" and "Don't ask again" to
suppress it for the session or indefinitely.