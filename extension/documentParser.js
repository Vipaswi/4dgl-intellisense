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
 * Main entry point — parse the full source text of one 4DGL file.
 */
function parseDocument(text) {
  const includes = parseIncludes(text);
  const stripped = stripComments(text);
  const { functions, variables } = parseScope(stripped);
  const constants = parseConstants(stripped);
  return { functions, variables, constants, includes };
}

module.exports = { parseDocument };
