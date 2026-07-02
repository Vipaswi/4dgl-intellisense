const vscode = require("vscode");
const keywordData = require("../data/4dgl_keywords.json");

// ── Legend ─────────────────────────────────────────────────────────────────

const TOKEN_TYPES = ["function", "variable", "parameter", "constant"];
const TOKEN_MODIFIERS = [];
const LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS);

const T_FUNCTION  = 0;
const T_VARIABLE  = 1;
const T_PARAMETER = 2;
const T_CONSTANT  = 3;

// ── Keyword filter ─────────────────────────────────────────────────────────

// Built from data/4dgl_keywords.json (the same source used for hover/completion
// and the tmLanguage grammar) so this list can't drift from what the language
// reference actually documents. Pre-processor directives (#DATA, #MODE, ...)
// are excluded here since the tokenizer only ever emits plain identifiers.
// `word`/`byte`/`long`/`string` (storage types) and `const` are kept as a
// small supplement — they're accepted by documentParser.js's declaration
// parsing but aren't covered by the flow-control/pre-processor sections this
// database is generated from.
const KEYWORDS = new Set(["word", "byte", "long", "string", "const"]);
for (const entry of Object.values(keywordData)) {
  if (entry.kind !== "keyword") continue;
  for (const name of entry.names || []) {
    if (!name.startsWith("#")) KEYWORDS.add(name.toLowerCase());
  }
}

// ── Token classification ───────────────────────────────────────────────────

/**
 * Return a token type index for `name` or -1 to skip.
 *
 * Priority:
 *  1. Keywords → skip
 *  2. Followed by '(' → function
 *  3. Known user function → function
 *  4. Known user/built-in constant, or ALL_CAPS heuristic → constant
 *  5. Parameter of the enclosing function at `lineIndex` → parameter
 *  6. Local var of the enclosing function → variable
 *  7. Global variable → variable
 *  8. Lowercase/mixed identifier → variable (catch-all for unresolved names)
 */
function classifyIdentifier(name, isCall, lineIndex, symbols) {
  if (KEYWORDS.has(name.toLowerCase())) return -1;

  if (isCall || name in symbols.functions) return T_FUNCTION;

  if (name in symbols.constants) return T_CONSTANT;

  // Heuristic: ALL_CAPS with at least one underscore or 2+ chars → constant
  if (/^[A-Z][A-Z0-9_]+$/.test(name)) return T_CONSTANT;

  // Check enclosing function scope by line number
  for (const fn of Object.values(symbols.functions)) {
    if (fn.fromInclude) continue;
    if (lineIndex > fn.startLine && lineIndex <= fn.endLine) {
      if (fn.parameters && fn.parameters.some((p) => p.name === name)) {
        return T_PARAMETER;
      }
      if (fn.localVars && name in fn.localVars) {
        return T_VARIABLE;
      }
    }
  }

  if (name in symbols.variables) return T_VARIABLE;

  // Catch-all: any remaining mixed-case / lowercase identifier
  if (/^[a-z_]/.test(name)) return T_VARIABLE;

  return -1;
}

// ── Line tokenizer ─────────────────────────────────────────────────────────

/**
 * Scan one line and emit token descriptors, respecting comment/string state.
 *
 * @param {string}  lineText
 * @param {number}  lineIndex      0-based line number in the document
 * @param {boolean} inBlockComment whether the line starts inside a block comment
 * @param {object}  symbols        from DocumentManager.getSymbolsForDocument
 * @returns {{ tokens: Array<{start,length,type}>, inBlockComment: boolean }}
 */
function tokenizeLine(lineText, lineIndex, inBlockComment, symbols) {
  const tokens = [];
  const len = lineText.length;
  let i = 0;

  while (i < len) {
    // ── Inside a block comment ─────────────────────────────────────────────
    if (inBlockComment) {
      const close = lineText.indexOf("*/", i);
      if (close === -1) return { tokens, inBlockComment: true };
      i = close + 2;
      inBlockComment = false;
      continue;
    }

    const ch  = lineText[i];
    const ch1 = lineText[i + 1];

    // Line comment → nothing more on this line
    if (ch === "/" && ch1 === "/") break;

    // Block comment open
    if (ch === "/" && ch1 === "*") {
      i += 2;
      inBlockComment = true;
      continue;
    }

    // String literal → skip contents verbatim
    if (ch === '"') {
      i++;
      while (i < len && lineText[i] !== '"' && lineText[i] !== "\n") {
        if (lineText[i] === "\\") i++;
        i++;
      }
      if (i < len && lineText[i] === '"') i++;
      continue;
    }

    // Identifier start
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      const start = i;
      i++;
      while (i < len) {
        const c = lineText[i];
        if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") ||
            (c >= "0" && c <= "9") || c === "_") {
          i++;
        } else {
          break;
        }
      }
      const name = lineText.slice(start, i);

      // Peek past whitespace to detect a '(' (call / definition)
      let j = i;
      while (j < len && lineText[j] === " ") j++;
      const isCall = lineText[j] === "(";

      const tokenType = classifyIdentifier(name, isCall, lineIndex, symbols);
      if (tokenType !== -1) {
        tokens.push({ start, length: name.length, type: tokenType });
      }
      continue;
    }

    i++;
  }

  return { tokens, inBlockComment };
}

// ── Provider factory ───────────────────────────────────────────────────────

function createSemanticTokensProvider(documentManager) {
  return {
    provideDocumentSemanticTokens(document, _cancellationToken) {
      const symbols = documentManager.getSymbolsForDocument(document.uri);
      const builder = new vscode.SemanticTokensBuilder(LEGEND);
      let inBlockComment = false;

      for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const lineText = document.lineAt(lineIndex).text;
        const result = tokenizeLine(lineText, lineIndex, inBlockComment, symbols);
        inBlockComment = result.inBlockComment;

        for (const tok of result.tokens) {
          builder.push(lineIndex, tok.start, tok.length, tok.type, 0);
        }
      }

      return builder.build();
    },
  };
}

// ── Registration ───────────────────────────────────────────────────────────

function registerSemanticTokensProvider(context, documentManager) {
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "4dgl" },
      createSemanticTokensProvider(documentManager),
      LEGEND
    )
  );
}

module.exports = { registerSemanticTokensProvider, LEGEND };
