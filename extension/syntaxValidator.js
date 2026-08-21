/**
 * Structural syntax validation for a single 4DGL source text.
 *
 * This is deliberately NOT a parser for the whole language (the extension is
 * parser-free by design — see CLAUDE.md). It is a lexer plus a block-structure
 * state machine, which is enough to catch the class of mistake that actually costs
 * a Workshop4 compile round-trip: an unclosed `func`, a `while` closed with
 * `endif`, a missing `)`, a runaway string or block comment, an `else` with no
 * `if`, a `{` typed out of C habit.
 *
 * Everything reported here is a *local* structural fact. Nothing is reported that
 * would need name resolution, type information, or preprocessor evaluation, because
 * those all produce false positives in real projects — vendor `#inherit` targets are
 * frequently outside the workspace, so their symbols simply aren't visible to us.
 *
 * No `vscode` dependency — this module runs under plain Node, so it can be exercised
 * with `node -e` the same way `docDatabase.js`/`keywordDatabase.js` can.
 *
 * validate(text, options) returns, sorted by position:
 *   [ {
 *       code, severity: "error" | "warning", message,
 *       line, character, endLine, endCharacter,        // 0-based, end-exclusive
 *       related?: [ { line, character, endLine, endCharacter, message } ]
 *   } ]
 */

const keywordData = require("../data/4dgl_keywords.json");

// ── Language tables ────────────────────────────────────────────────────────

// Keys are lowercased. 4DGL itself is case sensitive, but matching loosely here
// only ever means we *don't* report something, and Workshop4 accepts directives in
// either case (documentParser.js matches #INCLUDE/#USE case-insensitively too).
//
//   closers   — every keyword that can legally terminate the block
//   condition — "required": a parenthesised condition must follow the keyword
//               "optional": may or may not have one (the expressionless `switch`)
//               "none":     takes no condition
//   oneLiner  — true for the constructs with a documented single-statement form
//               that needs no closer at all (`if (c) s;`, `while (c) s;`,
//               `for (i; c; u) s;` — see "Language Flow Control" in
//               Resources/directives_and_syntax.txt)
//   kind      — coarse class, used for `break`/`continue`/`case`/`else` context
const OPENERS = {
  func:     { display: "func",   closers: ["endfunc"],          condition: "none",     kind: "func" },
  if:       { display: "if",     closers: ["endif"],            condition: "required", kind: "if",   oneLiner: true },
  while:    { display: "while",  closers: ["wend"],             condition: "required", kind: "loop", oneLiner: true },
  for:      { display: "for",    closers: ["next"],             condition: "required", kind: "loop", oneLiner: true },
  switch:   { display: "switch", closers: ["endswitch"],        condition: "optional", kind: "switch" },
  repeat:   { display: "repeat", closers: ["until", "forever"], condition: "none",     kind: "loop" },
  "#data":  { display: "#DATA",  closers: ["#end"],             condition: "none",     kind: "data" },
  "#const": { display: "#CONST", closers: ["#end"],             condition: "none",     kind: "data" },
};

const CLOSERS = {
  endfunc: "endfunc",
  endif: "endif",
  wend: "wend",
  next: "next",
  endswitch: "endswitch",
  until: "until",
  forever: "forever",
  "#end": "#END",
};

// Keywords that are only legal inside a particular enclosing block.
//
//   divides — the keyword splits its enclosing block into parts, so anything opened
//             in an earlier part and left open is a missing closer. `endsub` and
//             `return` divide nothing and may sit at any depth.
//
// `default` is deliberately absent. Although it is part of the switch construct, it
// is also a legal `goto` label name, and the vendor's own sample code uses it as one
// ("Example 4DGL Code" in the Goldelox manual has `goto default;` / `default:`
// outside any switch), so requiring a switch around it reports working code.
const CONTEXTUAL = {
  else:   { display: "else",   requires: ["if"],     inside: "an 'if' block",   divides: true },
  case:   { display: "case",   requires: ["switch"], inside: "a 'switch' block", divides: true },
  endsub: { display: "endsub", requires: ["func"],   inside: "a function body",  divides: false },
  return: { display: "return", requires: ["func"],   inside: "a function body", divides: false },
};

// `break`/`continue` need a loop or a switch, but the search must not cross a
// function boundary — hence separate handling from CONTEXTUAL.
const LOOP_ESCAPES = new Set(["break", "continue"]);

// Conditional-compilation directives are tracked on their own stack, NOT alongside
// the code blocks above. They are orthogonal to block structure: a `#IF`/`#ELSE`
// pair may legitimately open a construct in one branch and its counterpart in the
// other, and an `#ENDIF` may fall in the middle of a block that opened before it
// and closes after it. Interleaving the two would report both idioms as errors.
const COND_OPENERS = { "#if": "#IF", "#ifnot": "#IFNOT" };
const COND_ELSE = "#else";
const COND_CLOSER = "#endif";

// Pre-processor directives documented in Resources/directives_and_syntax.txt.
// Built from the generated keyword database so this can't drift from the reference
// (the rule semanticTokens.js follows), plus the two directives that database's
// section walk doesn't cover: `#include` (an alias of `#inherit`, already accepted
// by documentParser.js) and `#platform` (only ever shown inline in the `#inherit`
// example).
const KNOWN_DIRECTIVES = new Set(["#include", "#platform"]);
for (const entry of Object.values(keywordData)) {
  for (const name of entry.names || []) {
    // "#IF EXISTS" / "#IF USING" are documented as a single name, but only the
    // leading directive word is ever a token.
    if (name.startsWith("#")) KNOWN_DIRECTIVES.add(name.split(/\s+/)[0].toLowerCase());
  }
}

const BRACKET_PAIRS = { "(": ")", "[": "]" };

// ── Lexer ──────────────────────────────────────────────────────────────────

/**
 * Scan `text` into the tokens the block machine cares about — words, directives,
 * brackets, braces, `;`, and a bare `=` — skipping comments, string literals and
 * character literals, and reporting the lexical errors found on the way
 * (unterminated block comment / unterminated string).
 *
 * Returns:
 *   tokens      { type, text, line, character }, where type is one of
 *               "word" | "directive" | "ref" | "open" | "close" | "brace" | "semi" | "equals".
 *               "ref" is a `$#DIRECTIVE` reference inside a `#constant` alias
 *               definition: it names a directive without invoking it, so the
 *               machine must not treat it as one.
 *   problems    lexical errors
 *   brokenLines lines whose tail could not be scanned (unterminated string), so
 *               structural claims about what they left open aren't trustworthy
 *   truncated   true if the file ends inside a block comment, i.e. an unknown
 *               amount of source was never seen
 */
function tokenize(text) {
  const tokens = [];
  const problems = [];
  const brokenLines = new Set();
  const lines = text.split("\n");

  let inBlockComment = false;
  let commentStart = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].replace(/\r$/, "");
    const len = line.length;
    let i = 0;

    while (i < len) {
      if (inBlockComment) {
        const close = line.indexOf("*/", i);
        if (close === -1) break;
        i = close + 2;
        inBlockComment = false;
        continue;
      }

      const ch = line[i];
      const ch1 = line[i + 1];

      if (ch === "/" && ch1 === "/") break;
      if (ch === "/" && ch1 === "*") {
        inBlockComment = true;
        commentStart = { line: lineIndex, character: i };
        i += 2;
        continue;
      }

      // String literal — a 4DGL string literal does not span lines.
      if (ch === '"') {
        let j = i + 1;
        let closed = false;
        while (j < len) {
          if (line[j] === "\\") {
            j += 2;
            continue;
          }
          if (line[j] === '"') {
            closed = true;
            j++;
            break;
          }
          j++;
        }
        if (!closed) {
          problems.push({
            code: "unterminated-string",
            severity: "error",
            message: "Unterminated string literal — a 4DGL string must be closed on the same line.",
            line: lineIndex,
            character: i,
            endLine: lineIndex,
            endCharacter: len,
          });
          brokenLines.add(lineIndex);
          break;
        }
        // Emitted so an argument list containing only a string isn't mistaken for an
        // empty one. `text` keeps the quotes, which is what stops a string such as
        // "endif" from ever matching a structural keyword in the block machine.
        tokens.push({ type: "literal", text: line.slice(i, j), line: lineIndex, character: i });
        i = j;
        continue;
      }

      // Character literal ('4', '\n'). Only consumed when it really is one, so a
      // stray apostrophe can't swallow the rest of the file.
      if (ch === "'") {
        const charLiteral = /^'(?:\\.|[^'\\])'/.exec(line.slice(i));
        if (charLiteral) {
          tokens.push({ type: "literal", text: charLiteral[0], line: lineIndex, character: i });
          i += charLiteral[0].length;
        } else {
          i++;
        }
        continue;
      }

      // Identifier / keyword
      if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
        let j = i + 1;
        while (j < len && /[A-Za-z0-9_]/.test(line[j])) j++;
        tokens.push({ type: "word", text: line.slice(i, j), line: lineIndex, character: i });
        i = j;
        continue;
      }

      // A pre-processor directive, or a `$#DIRECTIVE` reference inside a
      // `#constant #alias $#REAL` redefinition (see "Redefining Pre-Processor
      // Directives"), which names a directive rather than invoking it.
      if (ch === "#") {
        let j = i + 1;
        while (j < len && /[A-Za-z0-9_]/.test(line[j])) j++;
        if (j > i + 1) {
          tokens.push({
            type: i > 0 && line[i - 1] === "$" ? "ref" : "directive",
            text: line.slice(i, j),
            line: lineIndex,
            character: i,
          });
        }
        i = j;
        continue;
      }

      if (ch === "(" || ch === "[") {
        tokens.push({ type: "open", text: ch, line: lineIndex, character: i });
        i++;
        continue;
      }
      if (ch === ")" || ch === "]") {
        tokens.push({ type: "close", text: ch, line: lineIndex, character: i });
        i++;
        continue;
      }
      if (ch === "{" || ch === "}") {
        tokens.push({ type: "brace", text: ch, line: lineIndex, character: i });
        i++;
        continue;
      }
      if (ch === ";") {
        tokens.push({ type: "semi", text: ch, line: lineIndex, character: i });
        i++;
        continue;
      }

      // The three below are emitted for semanticChecks.js (argument splitting,
      // the `@` argument-pointer operator, and `label:` detection). The block
      // machine ignores them — none is a structural keyword.
      if (ch === ",") {
        tokens.push({ type: "comma", text: ch, line: lineIndex, character: i });
        i++;
        continue;
      }
      if (ch === "@") {
        tokens.push({ type: "at", text: ch, line: lineIndex, character: i });
        i++;
        continue;
      }
      // A ':' but not the ':' of ':=' — that one is an assignment, not a label.
      if (ch === ":" && ch1 !== "=") {
        tokens.push({ type: "colon", text: ch, line: lineIndex, character: i });
        i++;
        continue;
      }

      // A bare `=`: not part of `:=`, `==`, `!=`, `<=`, `>=`, or any compound
      // assignment (`+= -= *= /= %= &= |= ^=`, `<<= >>=`).
      if (ch === "=") {
        const prev = i > 0 ? line[i - 1] : "";
        if (ch1 !== "=" && !":!<>=+-*/%&|^".includes(prev)) {
          tokens.push({ type: "equals", text: "=", line: lineIndex, character: i });
        }
        i++;
        continue;
      }

      // Anything else that isn't whitespace — a number, an operator, a sigil. The
      // block machine ignores these (none is a structural keyword), but
      // semanticChecks.js needs them: without a token for `5`, the argument list of
      // `ABS(5)` looks empty and the call reads as taking no arguments.
      if (!/\s/.test(ch)) {
        tokens.push({ type: "other", text: ch, line: lineIndex, character: i });
      }
      i++;
    }
  }

  if (inBlockComment) {
    problems.push({
      code: "unterminated-comment",
      severity: "error",
      message: "Unterminated block comment — this '/*' is never closed.",
      line: commentStart.line,
      character: commentStart.character,
      endLine: commentStart.line,
      endCharacter: commentStart.character + 2,
    });
  }

  return { tokens, problems, brokenLines, truncated: inBlockComment };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function tokenRange(token) {
  return {
    line: token.line,
    character: token.character,
    endLine: token.line,
    endCharacter: token.character + token.text.length,
  };
}

function expectationOf(entry) {
  return entry.closers.map((c) => `'${CLOSERS[c]}'`).join(" or ");
}

/** Index of the matching ')' for the '(' at tokens[openIndex], or -1. */
function findMatchingParen(tokens, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "open" && token.text === "(") depth++;
    else if (token.type === "close" && token.text === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Decide whether an `if`/`while`/`for` whose condition closes at `closeIndex` is
 * the documented single-line form, which needs no closer. It is, if something
 * follows the condition on the same line — unless what follows includes this
 * construct's own closer, i.e. the whole block was written on one line
 * (`if (a) x; endif`), which is still the block form.
 *
 * A brace doesn't count as something following: `if (c) {` is the C habit, not a
 * single-line 4DGL statement, and reading it as one turns the one misplaced `{`
 * into a cascade of "orphan endif" / "unexpected endfunc" further down.
 */
function isOneLiner(tokens, closeIndex, entry) {
  const line = tokens[closeIndex].line;
  let sawStatement = false;
  for (let i = closeIndex + 1; i < tokens.length && tokens[i].line === line; i++) {
    if (tokens[i].type === "brace") continue;
    sawStatement = true;
    if (entry.closers.includes(tokens[i].text.toLowerCase())) return false;
  }
  return sawStatement;
}

/** Nearest stack entry of one of `kinds`; optionally give up at a `func` boundary. */
function findEnclosing(stack, kinds, stopAtFunc) {
  for (let k = stack.length - 1; k >= 0; k--) {
    if (kinds.includes(stack[k].kind)) return k;
    if (stopAtFunc && stack[k].kind === "func") return -1;
  }
  return -1;
}

/**
 * Directive names a file has redefined with `#constant #alias $#REAL` (see
 * "Redefining Pre-Processor Directives" — the documented way to write `#ifdef`,
 * `#define`, `#include` and friends). Maps alias → the directive it stands for, so
 * an aliased `#ifdef` opens a block exactly as `#IF` does.
 */
function collectDirectiveAliases(text) {
  const aliases = new Map();
  const re = /^[ \t]*#constant[ \t]+(#[A-Za-z_][A-Za-z0-9_]*)[ \t]+\$(#[A-Za-z_][A-Za-z0-9_]*)/gim;
  let match;
  while ((match = re.exec(text)) !== null) {
    aliases.set(match[1].toLowerCase(), match[2].toLowerCase());
  }
  return aliases;
}

// ── Block-structure machine ────────────────────────────────────────────────

function analyze(text, lexed, options) {
  const { tokens, brokenLines, truncated } = lexed;
  const problems = [];

  const stack = []; // code + data blocks
  const conditionals = []; // #IF / #IFNOT
  const brackets = [];

  let forHeaderNext = false;
  // Single-line `if`/`while`/`for` forms never land on the stack, so remember which
  // line they were on: an `else` (or a `break`/`continue`) on that same line is
  // part of the construct, not an orphan.
  let oneLinerIfLine = -1;
  let oneLinerLoopLine = -1;
  // Set when an `else` is immediately followed by `if` on the same line: that `if`
  // continues the same block rather than opening a new one. See below.
  let elseIfChain = null;

  const aliases = collectDirectiveAliases(text);
  const known = new Set(KNOWN_DIRECTIVES);
  for (const alias of aliases.keys()) known.add(alias);

  // `fixes` is an optional list of { title, replacement } describing a mechanical
  // edit to the reported range. codeActions.js turns each into a Quick Fix; nothing
  // here depends on them, so a check that has no safe automatic repair just omits it.
  const report = (code, severity, message, range, related, fixes) => {
    problems.push({ code, severity, message, ...range, related, fixes });
  };

  const reportUnclosedBracket = (bracket, before) => {
    // The tail of a line with an unterminated string was never scanned, so a
    // bracket it left open is a consequence of that error, not a separate one.
    if (brokenLines.has(bracket.line)) return;
    report(
      "unclosed-bracket",
      "error",
      `Unclosed '${bracket.text}' — expected '${BRACKET_PAIRS[bracket.text]}'${before ? ` before ${before}` : ""}.`,
      tokenRange(bracket)
    );
  };

  const flushBrackets = (before) => {
    while (brackets.length) reportUnclosedBracket(brackets.pop(), before);
  };

  /** Pop and report every block left open above `floor`, innermost first. */
  const unwindTo = (floor, becauseOf) => {
    while (stack.length > floor) {
      const entry = stack.pop();
      report(
        "unclosed-block",
        "error",
        `Unclosed '${entry.display}' — expected ${expectationOf(entry)}${becauseOf ? ` before ${becauseOf}` : ""}.`,
        tokenRange(entry.token)
      );
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const isLastOnLine = i + 1 >= tokens.length || tokens[i + 1].line !== token.line;

    // ── Brackets, braces, statement ends, operators ───────────────────────
    if (token.type === "open") {
      brackets.push({ ...token, forHeader: forHeaderNext });
      forHeaderNext = false;
      continue;
    }
    if (token.type === "close") {
      if (brackets.length === 0) {
        report(
          "unmatched-bracket",
          "error",
          `Unmatched '${token.text}' — there is no '${token.text === ")" ? "(" : "["}' for it to close.`,
          tokenRange(token)
        );
      } else {
        const open = brackets.pop();
        if (BRACKET_PAIRS[open.text] !== token.text) {
          report(
            "mismatched-bracket",
            "error",
            `Mismatched bracket — the '${open.text}' opened on line ${open.line + 1} is closed by '${token.text}'.`,
            tokenRange(token),
            [{ ...tokenRange(open), message: `'${open.text}' opened here.` }]
          );
        }
      }
      continue;
    }
    if (token.type === "brace") {
      report(
        "unexpected-brace",
        "error",
        `Unexpected '${token.text}' — 4DGL delimits blocks with keywords (func/endfunc, if/endif, while/wend, …), not braces.`,
        tokenRange(token),
        undefined,
        [{ title: `Remove '${token.text}'`, replacement: "" }]
      );
      continue;
    }
    if (token.type === "semi") {
      // A ';' ends the statement, so a bracket opened on this line and still open
      // is a missing closer. `for (init; cond; update)` headers legitimately hold
      // a ';' inside their parens, so that one '(' is exempt.
      if (isLastOnLine) {
        while (
          brackets.length &&
          brackets[brackets.length - 1].line === token.line &&
          !brackets[brackets.length - 1].forHeader
        ) {
          reportUnclosedBracket(brackets.pop(), `the ';' on line ${token.line + 1}`);
        }
      }
      continue;
    }
    if (token.type === "equals") {
      if (options.assignmentOperator) {
        report(
          "bare-equals",
          "warning",
          "'=' is not a 4DGL operator — use ':=' to assign, or '==' to compare.",
          tokenRange(token),
          undefined,
          [
            { title: "Change to ':=' (assign)", replacement: ":=" },
            { title: "Change to '==' (compare)", replacement: "==" },
          ]
        );
      }
      continue;
    }
    if (token.type === "ref") continue;

    // ── Directives ────────────────────────────────────────────────────────
    let word = token.text.toLowerCase();

    if (token.type === "directive") {
      // In `#constant #alias $#REAL` the second token *defines* a directive name,
      // it does not use one.
      const previous = tokens[i - 1];
      if (previous && previous.type === "directive" && previous.text.toLowerCase() === "#constant") continue;

      if (!known.has(word) && !(word in OPENERS) && !(word in CLOSERS) && !(word in COND_OPENERS)) {
        if (options.unknownDirectives) {
          report("unknown-directive", "warning", `Unknown pre-processor directive '${token.text}'.`, tokenRange(token));
        }
        continue;
      }
      // An aliased directive behaves as whatever it was defined to stand for.
      word = aliases.get(word) || word;
    }

    const isStructural =
      word in OPENERS ||
      word in CLOSERS ||
      word in CONTEXTUAL ||
      word in COND_OPENERS ||
      word === COND_ELSE ||
      word === COND_CLOSER ||
      LOOP_ESCAPES.has(word);
    if (!isStructural) continue;

    // A structural keyword can never appear inside a bracketed expression, so
    // anything still open at this point is a missing closing bracket.
    flushBrackets(`'${token.text}'`);

    // ── Conditional compilation ───────────────────────────────────────────
    // These only ever touch `conditionals`. The one effect on `stack` is that
    // `#ELSE` rewinds it to what it was at the `#IF`, so blocks the first branch
    // opened don't leak into the second.
    if (word in COND_OPENERS) {
      conditionals.push({
        token,
        display: COND_OPENERS[word],
        stackSnapshot: stack.slice(),
        bracketDepth: brackets.length,
      });
      continue;
    }
    if (word === COND_ELSE) {
      if (conditionals.length === 0) {
        report(
          "orphan-keyword",
          "error",
          "'#ELSE' is only valid inside an '#IF'/'#IFNOT' block.",
          tokenRange(token)
        );
        continue;
      }
      const open = conditionals[conditionals.length - 1];
      stack.length = 0;
      stack.push(...open.stackSnapshot);
      brackets.length = Math.min(brackets.length, open.bracketDepth);
      continue;
    }
    if (word === COND_CLOSER) {
      if (conditionals.length === 0) {
        report(
          "unexpected-block-end",
          "error",
          "Unexpected '#ENDIF' — no '#IF' or '#IFNOT' is open here.",
          tokenRange(token)
        );
      } else {
        conditionals.pop();
      }
      continue;
    }

    // ── Block closers ─────────────────────────────────────────────────────
    if (word in CLOSERS) {
      const display = CLOSERS[word];
      let match = -1;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].closers.includes(word)) {
          match = k;
          break;
        }
      }

      if (match !== -1) {
        unwindTo(match + 1, `'${display}'`);
        stack.pop();
      } else if (stack.length > 0) {
        const top = stack[stack.length - 1];
        report(
          "mismatched-block-end",
          "error",
          `'${display}' does not close '${top.display}' — expected ${expectationOf(top)}.`,
          tokenRange(token),
          [{ ...tokenRange(top.token), message: `'${top.display}' opened here.` }],
          // One option per legal terminator, so `repeat` offers both 'until' and
          // 'forever' rather than the machine picking for you.
          top.closers.map((closer) => ({
            title: `Change to '${CLOSERS[closer]}'`,
            replacement: CLOSERS[closer],
          }))
        );
        stack.pop();
      } else {
        report("unexpected-block-end", "error", `Unexpected '${display}' — no block is open here.`, tokenRange(token));
      }
      continue;
    }

    // ── Contextual keywords ───────────────────────────────────────────────
    if (LOOP_ESCAPES.has(word)) {
      if (token.line !== oneLinerLoopLine && findEnclosing(stack, ["loop", "switch"], true) === -1) {
        report(
          "orphan-keyword",
          "error",
          `'${token.text}' is only valid inside a 'while'/'for'/'repeat' loop or a 'switch' block.`,
          tokenRange(token)
        );
      }
      continue;
    }

    if (word in CONTEXTUAL) {
      const rule = CONTEXTUAL[word];
      // The single-line `if (c) s; else s;` form has no block to be inside of.
      if (word === "else" && token.line === oneLinerIfLine) continue;

      const at = findEnclosing(stack, rule.requires, rule.requires[0] !== "func");
      if (at === -1) {
        report("orphan-keyword", "error", `'${rule.display}' is only valid inside ${rule.inside}.`, tokenRange(token));
        continue;
      }

      if (rule.divides) unwindTo(at + 1, `'${rule.display}'`);

      if (word === "else") {
        if (stack[at].seenElse) {
          report(
            "duplicate-else",
            "error",
            "Duplicate 'else' — an 'if' block can only have one.",
            tokenRange(token),
            [{ ...tokenRange(stack[at].token), message: "'if' opened here." }]
          );
        }
        stack[at].seenElse = true;

        // `else if (…)` on one line chains another branch onto this same block —
        // the whole chain is closed by one `endif`, not one per branch. (4DGL has
        // no `elseif` keyword; the chain is spelled as two words.)
        const next = tokens[i + 1];
        if (next && next.type === "word" && next.text.toLowerCase() === "if" && next.line === token.line) {
          elseIfChain = { tokenIndex: i + 1, stackIndex: at };
        }
      }
      continue;
    }

    // ── Block openers ─────────────────────────────────────────────────────
    const entry = OPENERS[word];

    // The `if` of an `else if (…)` chain: still validate its condition, but it
    // continues the block the `else` belongs to instead of opening a new one, and
    // it re-arms that block to accept a further `else`.
    const chained = elseIfChain !== null && elseIfChain.tokenIndex === i;
    if (chained) {
      stack[elseIfChain.stackIndex].seenElse = false;
      elseIfChain = null;
    }

    if (word === "func") {
      const enclosing = findEnclosing(stack, ["func"], false);
      if (enclosing !== -1) {
        // 4DGL has no nested functions, so an open one here means its `endfunc` is
        // missing. Reporting *that* points at the line which actually needs fixing.
        unwindTo(enclosing + 1, `'func' on line ${token.line + 1}`);
        const outer = stack.pop();
        report(
          "unclosed-block",
          "error",
          `Unclosed '${outer.display}' — expected 'endfunc' before the next 'func' on line ${token.line + 1}.`,
          tokenRange(outer.token)
        );
      }

      const name = tokens[i + 1];
      const paren = tokens[i + 2];
      const wellFormed =
        name && name.type === "word" && name.line === token.line &&
        paren && paren.type === "open" && paren.text === "(" && paren.line === token.line;
      if (!wellFormed) {
        report(
          "malformed-func",
          "error",
          "Expected a function name and a parameter list after 'func' — 'func name(...)'.",
          tokenRange(token)
        );
      }
    }

    if (entry.condition !== "none") {
      const paren = tokens[i + 1];
      const hasCondition = paren && paren.type === "open" && paren.text === "(" && paren.line === token.line;

      if (!hasCondition) {
        if (entry.condition === "required") {
          report(
            "missing-condition",
            "error",
            `Expected a parenthesised condition after '${entry.display}' — '${entry.display} (…)'.`,
            tokenRange(token)
          );
        }
      } else {
        if (word === "for") forHeaderNext = true;
        const close = findMatchingParen(tokens, i + 1);
        if (close !== -1 && entry.oneLiner && isOneLiner(tokens, close, entry)) {
          // Single-statement form — there is no closer to look for.
          if (entry.kind === "if") oneLinerIfLine = token.line;
          if (entry.kind === "loop") oneLinerLoopLine = token.line;
          continue;
        }
      }
    }

    if (chained) continue;
    stack.push({ ...entry, token, bracketDepth: brackets.length });
  }

  // An unterminated block comment swallowed an unknown amount of the file, so what
  // it appears to have left open says nothing useful — report only the comment.
  if (!truncated) {
    flushBrackets("the end of the file");
    unwindTo(0, "the end of the file");
    for (const open of conditionals) {
      report(
        "unclosed-block",
        "error",
        `Unclosed '${open.display}' — expected '#ENDIF' before the end of the file.`,
        tokenRange(open.token)
      );
    }
  }

  return problems;
}

// ── Entry point ────────────────────────────────────────────────────────────

/**
 * `options`:
 *   - unknownDirectives  (default true) report a `#foo` that isn't a documented directive
 *   - assignmentOperator (default true) report a bare `=` (4DGL uses `:=` / `==`)
 */
function validate(text, options) {
  const opts = {
    unknownDirectives: (options && options.unknownDirectives) !== false,
    assignmentOperator: (options && options.assignmentOperator) !== false,
  };

  const lexed = tokenize(text);
  const all = lexed.problems.concat(analyze(text, lexed, opts));

  all.sort((a, b) => a.line - b.line || a.character - b.character);
  return all;
}

// `tokenize` is exported for semanticChecks.js, which needs the same view of the
// source (comments and literals already skipped). Keep one lexer, not two.
module.exports = { validate, tokenize };
