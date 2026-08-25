/**
 * Name and argument-count checks for a single 4DGL source text.
 *
 * These are the checks syntaxValidator.js deliberately refuses to make, because they
 * need to know what's defined. That knowledge is incomplete and always will be, for
 * two reasons that shaped every decision in this file:
 *
 *  1. `#inherit`/`#include`/`#use` targets frequently live outside the workspace (the
 *     4D Systems include folder isn't bundled), so their symbols are invisible.
 *  2. The generated databases don't cover every callable. The manuals document real
 *     "shortcut" functions — `gfx_Clipping`, `gfx_ScreenMode`, `txt_FGcolour` — only
 *     in prose and example code, with no heading or Syntax line for the extractor to
 *     find. Measured against the vendor corpus, a plain "is this name defined?" check
 *     flags 5.66% of correct call sites.
 *
 * So the name checks here do NOT ask "is this defined?". They ask "is this a
 * misspelling of something we know?" — a name is only reported when it is close
 * enough to a known name to be a plausible typo of it, and the report names the
 * suggestion. An unrecognised name that resembles nothing is left alone, because we
 * genuinely cannot tell it from a symbol we simply can't see. On the same corpus that
 * drops the false-positive rate to 0.71% of call sites, and most of what remains is
 * a real case-sensitivity bug in the vendor's own example code (`pin_set` for
 * `pin_Set`, `sys_Getdate` for `sys_GetDate` — 4DGL is case sensitive).
 *
 * The argument-count check has no such problem: it only ever applies to a function
 * whose signature we already have, so an unresolvable include can't make it wrong.
 *
 * No `vscode` dependency — runs under plain Node.
 */

const { tokenize } = require("./syntaxValidator");
const keywordData = require("../data/4dgl_keywords.json");

// Reserved words, lowercased: never reportable as an unknown name. Built from the
// generated keyword database (the rule semanticTokens.js follows, so it can't drift
// from the reference) plus the storage/scope words and compiler pseudo-functions that
// database's section walk doesn't cover.
const RESERVED = new Set([
  "var", "word", "byte", "long", "string", "const", "private", "default",
  "argcount", "sizeof", "iterator", "main",
]);
for (const entry of Object.values(keywordData)) {
  for (const name of entry.names || []) {
    RESERVED.add(name.split(/\s+/)[0].toLowerCase().replace(/^#/, ""));
    RESERVED.add(name.split(/\s+/)[0].toLowerCase());
  }
}

// Words that are followed by `(` but aren't calls, or are calls into the compiler
// rather than the function database.
const NOT_A_CALL = new Set([
  "if", "while", "for", "switch", "case", "until", "repeat", "return", "func",
  "var", "word", "byte", "long", "string", "const", "private", "else", "break",
  "continue", "goto", "gosub", "endsub", "default", "forever", "wend", "next",
  "endif", "endfunc", "endswitch",
  // Compiler pseudo-functions: their operand is a *name*, not a value, and they are
  // not in the function database.
  "argcount", "sizeof",
]);

// `argcount(name)` / `sizeof(name)` take a bare symbol name as their operand, so
// that operand must not be treated as an unknown constant/variable reference.
const NAME_OPERAND = new Set(["argcount", "sizeof"]);

const LOOKS_LIKE_CONSTANT = /^[A-Z][A-Z0-9_]*$/;

// A few database keys aren't callable identifiers at all — extraction artefacts like
// `img_ FileSize` (a space inside the name) or the stray `16-bit Registers Memory Map`
// heading in the Goldelox manual. They can never be the right suggestion for a
// misspelling, so they're kept out of the candidate pool.
const IS_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ── Arity ──────────────────────────────────────────────────────────────────

/**
 * How many arguments a function takes, read from its documented signature string.
 *
 * The `parameters` array on a database entry is NOT usable for this: the manuals
 * group related arguments into one table row, so `gfx_Line(x1, y1, x2, y2, colour)`
 * arrives with three parameter entries for five arguments. The signature string is
 * the only faithful record.
 *
 * Returns null when the arity can't be trusted — a variadic `(...)`, an optional
 * `[arg]` (none in the current data, but don't guess), or an entry whose signature
 * lost its parentheses during extraction (`lookup16`, `disp_WrGRAM` and a handful
 * of others). null always means "don't check this call".
 */
function arityFromSignature(signature) {
  if (typeof signature !== "string") return null;

  const match = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*\(([\s\S]*)\)\s*$/.exec(signature.trim());
  if (!match) return null;

  const inner = match[1].trim();
  if (inner === "") return 0;
  if (inner.includes("...") || inner.includes("[") || inner.includes("]")) return null;

  let depth = 0;
  let count = 1;
  for (const ch of inner) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) count++;
  }
  return count;
}

// ── Near-miss matching ─────────────────────────────────────────────────────

/**
 * Optimal string alignment distance (Levenshtein plus adjacent transposition),
 * abandoned as soon as it can't finish at or under `max`. Transpositions count as
 * one edit because swapped letters are a common typo and the whole point here is
 * catching typos: it's what makes `BLEU` register as `BLUE`.
 */
function editDistanceWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let twoBack = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array(b.length + 1);
    row[0] = i;
    let bestInRow = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, twoBack[j - 2] + 1);
      }
      row[j] = value;
      if (value < bestInRow) bestInRow = value;
    }
    if (bestInRow > max) return max + 1;
    twoBack = prev;
    prev = row;
  }
  return prev[b.length];
}

/**
 * How wrong a name is allowed to be before we stop calling it a typo. Short names
 * get no budget at all: at four characters or fewer, one edit is usually a different
 * name rather than a misspelling of this one.
 */
function editBudget(name) {
  if (name.length >= 8) return 2;
  if (name.length >= 4) return 1;
  return 0;
}

/**
 * The known name `name` most plausibly misspells, or null.
 *
 * Candidates whose first character differs are skipped — a typo rarely lands on the
 * first letter, and it keeps this from scanning all ~550 names per reference. The
 * comparison is case-insensitive on that first character only, so a wrong-case name
 * (`Sys_GetTimeVar` for `sys_GetTimeVar`) is still matched; 4DGL is case sensitive,
 * so that really is an error worth reporting.
 */
function nearestKnownName(name, candidateSets) {
  const max = editBudget(name);
  if (max === 0) return null;

  const firstLower = name[0].toLowerCase();
  let best = null;
  let bestDistance = max + 1;

  for (const candidates of candidateSets) {
    for (const candidate of candidates) {
      if (candidate.length === 0 || candidate[0].toLowerCase() !== firstLower) continue;
      if (candidate === name) return null;
      const distance = editDistanceWithin(name, candidate, max);
      if (distance <= max && distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
  }

  return best === null ? null : { name: best, distance: bestDistance };
}

// ── Call-site extraction ───────────────────────────────────────────────────

/**
 * Every `name(...)` in the token stream, with its argument count.
 *
 * `argumentCount` is null when the call passes arguments through the `@`
 * argument-pointer operator (`gfx_Rectangle(@ rect+n)`), which supplies a whole
 * argument list from one expression — the syntactic count says nothing then.
 */
function findCalls(tokens) {
  const calls = [];

  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (token.type !== "word") continue;

    const open = tokens[i + 1];
    if (!(open.type === "open" && open.text === "(")) continue;

    const previous = tokens[i - 1];
    const isDefinition = previous && previous.type === "word" && previous.text.toLowerCase() === "func";
    const lower = token.text.toLowerCase();

    // Walk to the matching ')' counting top-level commas. Anything that isn't a
    // comma counts as content, so an empty list is distinguishable from a one-argument
    // one — hence the lexer's "other" token for numbers and operators.
    let depth = 0;
    let end = -1;
    let commas = 0;
    let sawContent = false;
    let usesArgPointer = false;

    for (let j = i + 1; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.type === "open") {
        depth++;
        if (depth > 1) sawContent = true;
        continue;
      }
      if (t.type === "close") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
        sawContent = true;
        continue;
      }
      if (t.type === "at") usesArgPointer = true;
      if (t.type === "comma" && depth === 1) commas++;
      else sawContent = true;
    }

    calls.push({
      name: token.text,
      token,
      isDefinition,
      isPseudo: NOT_A_CALL.has(lower),
      takesNameOperand: NAME_OPERAND.has(lower),
      openIndex: i + 1,
      closeIndex: end,
      argumentCount: end === -1 || usesArgPointer ? null : sawContent || commas > 0 ? commas + 1 : 0,
    });

    if (end !== -1 && NAME_OPERAND.has(lower)) i = end; // don't inspect the operand
  }

  return calls;
}

/** `label:` on a line of its own — a `goto`/`gosub` target, scoped to its function. */
function findLabels(tokens) {
  const labels = new Set();
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (token.type !== "word") continue;
    const next = tokens[i + 1];
    if (next.type !== "colon" || next.line !== token.line) continue;
    // `case FOO:` is not a label, and neither is a ternary's ':'.
    const previous = tokens[i - 1];
    if (previous && previous.type === "word" && previous.text.toLowerCase() === "case") continue;
    const following = tokens[i + 2];
    if (following && following.line === token.line) continue; // something follows -> not a label line
    labels.add(token.text);
  }
  return labels;
}

/** Names introduced by `#DATA` / `#CONST` blocks, which the block's `type` precedes. */
function findDataBlockNames(text) {
  const names = new Set();
  const blocks = /^[ \t]*#(?:DATA|CONST)\b([\s\S]*?)^[ \t]*#END\b/gim;
  let block;
  while ((block = blocks.exec(text)) !== null) {
    for (const line of block[1].split("\n")) {
      const entry = /^\s*(?:(?:word|byte|long|var)\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
      if (entry) names.add(entry[1]);
    }
  }
  return names;
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * `symbols`:
 *   builtinFunctions   name -> { signature, ... }   active library
 *   builtinConstants   name -> { ... }              active library (+ colours)
 *   userFunctions      name -> { parameters, signature, fromInclude?, ... }
 *   inScopeNames       Set of variable/parameter/constant names visible here
 *   allowList          Set of names the user has declared known
 *   reserved           Set of language keywords/directives (lowercased)
 *   unverifiedArity    Set of built-in names whose documented arity isn't trustworthy
 *
 * `options`:
 *   unknownFunctions   report a call that looks like a misspelled known function
 *   unknownConstants   report an ALL_CAPS reference that looks like a misspelled constant
 *   argumentCount      report a call with the wrong number of arguments
 */
function check(text, symbols, options) {
  const problems = [];
  const { tokens } = tokenize(text);

  const builtinFunctions = symbols.builtinFunctions || {};
  const builtinConstants = symbols.builtinConstants || {};
  const userFunctions = symbols.userFunctions || {};
  const inScopeNames = symbols.inScopeNames || new Set();
  const allowList = symbols.allowList || new Set();
  const reserved = symbols.reserved || RESERVED;
  const unverifiedArity = symbols.unverifiedArity || new Set();

  const labels = findLabels(tokens);
  const dataNames = findDataBlockNames(text);

  const isKnown = (name) =>
    name in builtinFunctions ||
    name in builtinConstants ||
    name in userFunctions ||
    inScopeNames.has(name) ||
    allowList.has(name) ||
    labels.has(name) ||
    dataNames.has(name) ||
    reserved.has(name.toLowerCase());

  const functionNames = [
    Object.keys(builtinFunctions).filter((n) => IS_IDENTIFIER.test(n)),
    Object.keys(userFunctions),
  ];
  const constantNames = [Object.keys(builtinConstants).filter((n) => IS_IDENTIFIER.test(n))];

  const calls = findCalls(tokens);
  const callTokens = new Set(calls.map((c) => c.token));

  for (const call of calls) {
    if (call.isDefinition || call.isPseudo) continue;

    const declared = userFunctions[call.name];
    const builtin = builtinFunctions[call.name];

    // ── Unknown function ──────────────────────────────────────────────────
    if (!declared && !builtin) {
      if (!options.unknownFunctions) continue;
      // A variable can hold a function pointer and be called through it.
      if (isKnown(call.name)) continue;

      const suggestion = nearestKnownName(call.name, functionNames);
      if (suggestion) {
        problems.push({
          code: "unknown-function",
          severity: "warning",
          message:
            `'${call.name}' is not a known function. Did you mean '${suggestion.name}'?` +
            (suggestion.name.toLowerCase() === call.name.toLowerCase()
              ? " 4DGL is case sensitive."
              : ""),
          ...rangeOf(call.token),
          fixes: [{ title: `Change to '${suggestion.name}'`, replacement: suggestion.name }],
          // Offered as a second Quick Fix, for when the suggestion is wrong because
          // the name is real but undocumented — a symbol from an #inherit target
          // outside the workspace, say. Cheaper than switching the check off.
          allowName: call.name,
        });
      }
      continue;
    }

    // ── Argument count ────────────────────────────────────────────────────
    if (!options.argumentCount) continue;
    if (call.argumentCount === null) continue; // '@' argument pointer, or unbalanced

    // A user function's arity comes from its actual `func` declaration, so it is
    // exact. A built-in's comes from its documented signature, which is right about
    // 98% of the time — the rest are listed in data/4dgl_arity_unverified.json,
    // generated by tools/verify_arity.js from the manuals' own example calls, and
    // are never checked. See that script's header for what goes wrong and why.
    const expected = declared
      ? Array.isArray(declared.parameters)
        ? declared.parameters.length
        : null
      : unverifiedArity.has(call.name)
        ? null
        : arityFromSignature(builtin.signature);
    if (expected === null) continue;

    if (call.argumentCount !== expected) {
      const where = declared ? `'${call.name}' is declared with` : `'${call.name}' takes`;
      problems.push({
        code: "argument-count",
        severity: "warning",
        message:
          `${where} ${expected} argument${expected === 1 ? "" : "s"}, ` +
          `but ${call.argumentCount} ${call.argumentCount === 1 ? "was" : "were"} passed.`,
        ...rangeOf(call.token),
      });
    }
  }

  // ── Unknown constant ────────────────────────────────────────────────────
  if (options.unknownConstants) {
    for (const token of tokens) {
      if (token.type !== "word") continue;
      if (callTokens.has(token)) continue;
      if (!LOOKS_LIKE_CONSTANT.test(token.text) || token.text.length < 2) continue;
      if (isKnown(token.text)) continue;

      const suggestion = nearestKnownName(token.text, constantNames);
      if (!suggestion) continue;

      problems.push({
        code: "unknown-constant",
        severity: "warning",
        message:
          `'${token.text}' is not a known constant. Did you mean '${suggestion.name}'?` +
          (suggestion.name.toLowerCase() === token.text.toLowerCase() ? " 4DGL is case sensitive." : ""),
        ...rangeOf(token),
        fixes: [{ title: `Change to '${suggestion.name}'`, replacement: suggestion.name }],
        allowName: token.text,
      });
    }
  }

  problems.sort((a, b) => a.line - b.line || a.character - b.character);
  return problems;
}

function rangeOf(token) {
  return {
    line: token.line,
    character: token.character,
    endLine: token.line,
    endCharacter: token.character + token.text.length,
  };
}

module.exports = { check, arityFromSignature, nearestKnownName, editDistanceWithin, findCalls };
