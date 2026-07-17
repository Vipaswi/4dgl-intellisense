/**
 * Parses a single 4DGL source text and returns symbols defined in it.
 *
 * Returned shape:
 *   {
 *     functions: { [name]: { signature, parameters: [{name}], userDefined: true,
 *                            startLine, endLine, localVars: { [name]: {type,...} } } },
 *     variables: { [name]: { type, userDefined: true } },   // GLOBAL only
 *     constants: { [name]: { value, userDefined: true } },
 *     includes:  [ relativePathString, ... ]   // from #INCLUDE / #USE, NOT #IF EXISTS
 *   }
 *
 * variables contains only declarations at file (global) scope.
 * Declarations inside a function body are stored in that function's localVars.
 */

// Remove line and block comments, preserving newlines so line numbers stay valid.
// String literals are passed through unchanged so their contents don't confuse patterns.
function stripComments(text) {
  let result = "";
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    const ch1 = text[i + 1];

    // Line comment
    if (ch === "/" && ch1 === "/") {
      while (i < len && text[i] !== "\n") i++;
      continue;
    }

    // Block comment — replace body with spaces, keep newlines
    if (ch === "/" && ch1 === "*") {
      i += 2;
      while (i < len) {
        if (text[i] === "*" && text[i + 1] === "/") {
          i += 2;
          break;
        }
        result += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    // String literal — copy verbatim (contents must not be parsed for symbols)
    if (ch === '"') {
      result += text[i++];
      while (i < len && text[i] !== '"' && text[i] !== "\n") {
        if (text[i] === "\\") result += text[i++]; // escape char
        result += text[i++];
      }
      if (i < len && text[i] === '"') result += text[i++];
      continue;
    }

    result += text[i++];
  }

  return result;
}

/**
 * Collect #INCLUDE / #USE paths, skipping anything inside #IF EXISTS … #ENDIF blocks.
 * Other conditional blocks (#IF, #IFDEF …) are NOT skipped because we do not have a
 * preprocessor to evaluate them and it is safer to include those files.
 */
function parseIncludes(text) {
  const lines = text.split("\n");
  const includes = [];
  let ifExistsDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track #IF EXISTS nesting
    if (/^#IF\s+EXISTS\b/i.test(trimmed)) {
      ifExistsDepth++;
      continue;
    }
    if (/^#ENDIF\b/i.test(trimmed)) {
      if (ifExistsDepth > 0) ifExistsDepth--;
      continue;
    }

    if (ifExistsDepth > 0) continue;

    const m = /^#(?:INCLUDE|USE|INHERIT)\s+"([^"]+)"/i.exec(trimmed);
    if (m) includes.push(m[1]);
  }

  return includes;
}

/**
 * Parse variable declarations from an arbitrary text snippet.
 * Used for both global-scope text and function-body text.
 *
 *   var x, y := 0, z;
 *   word myWord;
 *   byte myByte;
 *   long myLong;
 *   string myStr[20];
 */
function parseVariablesFromText(text) {
  const variables = {};

  const varRe = /^\s*var\s+(.+?)(?:;|$)/gm;
  let m;
  while ((m = varRe.exec(text)) !== null) {
    for (const decl of m[1].split(",")) {
      const withoutInit = decl.trim().split(/\s*:=/)[0].trim();
      const arrayMatch = withoutInit.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*(\d+)\s*\]$/);
      if (arrayMatch) {
        variables[arrayMatch[1]] = { type: "var", arraySize: parseInt(arrayMatch[2], 10), userDefined: true };
      } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(withoutInit)) {
        variables[withoutInit] = { type: "var", userDefined: true };
      }
    }
  }

  const typedRe = /^\s*(word|byte|long|string)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[\s*(\d+)\s*\])?\s*(?::=\s*.*?)?\s*;?/gm;
  while ((m = typedRe.exec(text)) !== null) {
    const entry = { type: m[1], userDefined: true };
    if (m[3] !== undefined) entry.arraySize = parseInt(m[3], 10);
    variables[m[2]] = entry;
  }

  return variables;
}

/**
 * Parse constant declarations:
 *   const NAME := value;
 *   #constant NAME value
 *   #CONST
 *     NAME value
 *     NAME value
 *   #END
 */
function parseConstants(stripped) {
  const constants = {};

  const constRe = /^\s*const\s+([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.+?)(?:;|$)/gm;
  let m;
  while ((m = constRe.exec(stripped)) !== null) {
    constants[m[1]] = { value: m[2].trim(), userDefined: true };
  }

  const hashRe = /^\s*#constant\s+([A-Za-z_][A-Za-z0-9_]*)\s+(\S+)/gm;
  while ((m = hashRe.exec(stripped)) !== null) {
    constants[m[1]] = { value: m[2], userDefined: true };
  }

  // #CONST ... #END block: each non-empty line inside is `NAME value` or `NAME := value`
  const blockRe = /^\s*#CONST\b([^]*?)^\s*#END\b/gim;
  while ((m = blockRe.exec(stripped)) !== null) {
    for (const line of m[1].split("\n")) {
      const entry = /^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*:=\s*|\s+)(\S+)/.exec(line);
      if (entry) constants[entry[1]] = { value: entry[2].replace(/;$/, ""), userDefined: true };
    }
  }

  return constants;
}

/**
 * Scope-aware parse of functions and variables.
 *
 * Processes the file line-by-line tracking whether we are inside a function body.
 * - Lines inside a `func … endfunc` block contribute to that function's localVars.
 * - Lines outside any function contribute to the global variables map.
 * - Each function entry records startLine / endLine (0-based) for position checks.
 */
function parseScope(stripped) {
  const lines = stripped.split("\n");
  const functions = {};
  const globalLines = [];

  const funcStartRe = /^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/;
  const endFuncRe = /^\s*endfunc\b/i;

  let currentName = null;
  let bodyLines = [];
  let funcStartLine = -1;
  let params = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (currentName === null) {
      const m = funcStartRe.exec(line);
      if (m) {
        currentName = m[1];
        funcStartLine = i;
        const rawParams = m[2].trim();
        params = rawParams
          ? rawParams
              .split(",")
              .map((p) => {
                const pname = p.trim().replace(/^(?:var|word|byte|long|string)\s+/i, "").trim();
                return { name: pname };
              })
              .filter((p) => p.name)
          : [];
        bodyLines = [];
      } else {
        globalLines.push(line);
      }
    } else {
      if (endFuncRe.test(line)) {
        const localVars = parseVariablesFromText(bodyLines.join("\n"));
        // Parameters are their own thing — remove any name collision with localVars
        for (const p of params) delete localVars[p.name];

        functions[currentName] = {
          signature: `func ${currentName}(${params.map((p) => p.name).join(", ")})`,
          parameters: params,
          userDefined: true,
          startLine: funcStartLine,
          endLine: i,
          localVars,
        };
        currentName = null;
        bodyLines = [];
        params = [];
      } else {
        bodyLines.push(line);
      }
    }
  }

  const variables = parseVariablesFromText(globalLines.join("\n"));
  return { functions, variables };
}

/**
 * Find comment blocks in the raw (unstripped) source and index them by the line
 * immediately following the block — the only position that matters, since a doc
 * comment must sit directly above the `func` line it documents (no blank line
 * between) to be attributed to it.
 *
 *   // consecutive whole-line comments are merged into one block
 *   // like this
 *   func foo():
 *
 *   /* a block comment, single- or multi-line *\/
 *   func bar():
 */
function extractDocComments(rawText) {
  const lines = rawText.split("\n");
  const byNextLine = {};
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith("/*")) {
      const startLine = i;
      const raw = [lines[i]];
      while (!lines[i].includes("*/") && i < lines.length - 1) {
        i++;
        raw.push(lines[i]);
      }
      byNextLine[startLine + (raw.length)] = { raw: raw.join("\n"), kind: "block" };
      i++;
      continue;
    }

    if (trimmed.startsWith("//")) {
      const startLine = i;
      const raw = [];
      while (i < lines.length && lines[i].trim().startsWith("//")) {
        raw.push(lines[i]);
        i++;
      }
      byNextLine[startLine + raw.length] = { raw: raw.join("\n"), kind: "line" };
      continue;
    }

    i++;
  }

  return byNextLine;
}

// Strip comment delimiters (and, for block comments, a leading `*` on interior
// lines — the common `/** ... * @param x ... */` javadoc shape) so only the
// prose/tag text remains.
function stripCommentMarkers(raw, kind) {
  if (kind === "line") {
    return raw
      .split("\n")
      .map((l) => l.replace(/^\s*\/\/\s?/, ""))
      .join("\n");
  }

  let body = raw.trim().replace(/^\/\*+/, "").replace(/\*+\/$/, "");
  return body
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, ""))
    .join("\n")
    .trim();
}

/**
 * Parse javadoc-style tags out of cleaned comment text:
 *   @param name description...
 *   @return(s) description...
 * Everything else accumulates into the free-text description.
 *
 * Line breaks are preserved (not flattened to spaces) so structure the author wrote — separate
 * sentences, a bullet list, blank-line-separated paragraphs — survives into the rendered hover
 * instead of collapsing into one run-on line.
 *
 * `@param`/`@return(s)` are single-line by default: the tag's text is whatever follows it on
 * that same line. A tag's text only continues onto the next line if that line is indented (at
 * least one leading space after comment-marker stripping) — a blank line or a line that isn't
 * indented ends the tag. This mirrors Javadoc's "first line starts the description, indented
 * continuation lines extend it" convention.
 */
function parseJavadocText(cleaned) {
  const params = {};
  let returns;
  const descriptionParagraphs = [];

  let currentTag = null; // { type: "param", name } | { type: "returns" } | null
  let currentLines = [];

  const flush = () => {
    const text = currentLines.join("\n").trim();
    currentLines = [];
    if (!text) return;
    if (currentTag === null) descriptionParagraphs.push(text);
    else if (currentTag.type === "param") params[currentTag.name] = text;
    else if (currentTag.type === "returns") returns = text;
  };

  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    // Parameter names may be pointers (4DGL's `*name` "use variable as pointer" syntax,
    // e.g. `func f(*vState)`), so the tag must accept a leading `*` too.
    const paramMatch = /^\s*@param\s+(\*?[A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(line);
    const returnMatch = /^\s*@returns?\b\s*(.*)$/.exec(line);

    if (paramMatch) {
      flush();
      currentTag = { type: "param", name: paramMatch[1] };
      currentLines = [paramMatch[2].trim()];
      continue;
    }
    if (returnMatch) {
      flush();
      currentTag = { type: "returns" };
      currentLines = [returnMatch[1].trim()];
      continue;
    }

    const isBlank = line.trim() === "";

    if (currentTag !== null) {
      if (!isBlank && /^\s/.test(line)) {
        // Indented — continuation of the current tag's text.
        currentLines.push(line.trim());
        continue;
      }
      // Blank line or a dedented line ends the tag.
      flush();
      currentTag = null;
      if (isBlank) continue; // paragraph break, nothing carries over
      currentLines.push(line.trim()); // dedented line starts the next description paragraph
      continue;
    }

    // Plain description mode: blank line = paragraph break, otherwise keep accumulating.
    if (isBlank) {
      flush();
      continue;
    }
    currentLines.push(line.trim());
  }
  flush();

  return { description: descriptionParagraphs.join("\n\n").trim(), params, returns };
}

/**
 * Main entry point — parse the full source text of one 4DGL file.
 */
function parseDocument(text) {
  const includes = parseIncludes(text);
  const stripped = stripComments(text);
  const { functions, variables } = parseScope(stripped);
  const constants = parseConstants(stripped);

  const docComments = extractDocComments(text);
  for (const fn of Object.values(functions)) {
    const comment = docComments[fn.startLine];
    if (!comment) continue;

    const cleaned = stripCommentMarkers(comment.raw, comment.kind);
    const { description, params, returns } = parseJavadocText(cleaned);

    if (description) fn.description = description;
    if (returns) fn.returns = returns;
    for (const param of fn.parameters) {
      if (params[param.name]) param.description = params[param.name];
    }
  }

  return { functions, variables, constants, includes };
}

module.exports = { parseDocument };
