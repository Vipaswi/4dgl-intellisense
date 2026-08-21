const fs = require("fs");
const path = require("path");

function readJson(filePath, fallback) {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Apply data/4dgl_name_corrections.json to a freshly-loaded table.
 *
 * Some manual sections name a function one way in their heading and another way in
 * their Syntax line (`mem_free` vs `mem_Free`), some headings aren't identifiers at
 * all (`img_ FileSize`), and at least one constant table contains a plain typo
 * (`SPI_SPEER5` between `SPI_SPEED4` and `SPI_SPEED6`). None of that is fixable in an
 * extractor — the source document is what's wrong — so it's corrected here, at load,
 * which also means regenerating the databases can't silently undo it.
 *
 * Every operation is conditional, so one shared corrections file serves all four
 * libraries: a rename does nothing where the key doesn't exist, and an addition never
 * overwrites a real entry.
 */
function applyCorrections(table, corrections, kind) {
  const rules = (corrections && corrections[kind]) || {};

  for (const { from, to } of rules.rename || []) {
    if (!(from in table) || to in table) continue;
    table[to] = table[from];
    delete table[from];
  }
  for (const { name, of: source } of rules.alias || []) {
    if (name in table || !(source in table)) continue;
    table[name] = table[source];
  }
  for (const { name } of rules.drop || []) {
    delete table[name];
  }
  for (const { name, value, description } of rules.add || []) {
    if (name in table) continue;
    table[name] = { value, description, source: { confidence: "corrections" } };
  }

  return table;
}

function loadCorrections(context) {
  return readJson(path.join(context.extensionPath, "data", "4dgl_name_corrections.json"), {});
}

function loadFunctionDatabase(context, library) {
  const functions = readJson(
    path.join(context.extensionPath, "data", `4dgl_functions_${library}.json`),
    {}
  );
  return applyCorrections(functions, loadCorrections(context), "functions");
}

function loadConstantDatabase(context, library) {
  const constants = readJson(
    path.join(context.extensionPath, "data", `4dgl_constants_${library}.json`),
    {}
  );
  const colors = readJson(path.join(context.extensionPath, "data", "4dgl_colors.json"), {});

  return applyCorrections({ ...constants, ...colors }, loadCorrections(context), "constants");
}

// Javadoc-style explicit link tag: {@link #methodName() Label text}. Only text wrapped this
// way is ever turned into a link — a description merely *mentioning* another function's name
// in prose is left as plain text, so common words that happen to collide with a function name
// (e.g. a function called `TO`) don't get accidentally linked everywhere they're used.
const LINK_TAG_RE = /\{@link\s+#([A-Za-z_][A-Za-z0-9_]*)\(\)\s+([^}]+?)\s*\}/g;

/**
 * Replace `{@link #methodName() Label}` tags in `text` with a markdown link that invokes the
 * `4dgl.revealFunction` command. `docUriString` is the originating document (used to resolve
 * user-defined targets there); pass undefined when there is no document context (e.g. rendering
 * a built-in's virtual doc page, which isn't tied to any open document).
 */
function linkifyExplicitLinks(text, docUriString) {
  if (!text) return text;
  return text.replace(LINK_TAG_RE, (_match, name, label) => {
    const args = encodeURIComponent(JSON.stringify([name, docUriString || null]));
    return `[${label}](command:4dgl.revealFunction?${args})`;
  });
}

function markdownForFunction(fn, docUriString) {
  const lines = [];
  lines.push("```4dgl");
  lines.push(fn.signature);
  lines.push("```");

  if (fn.description) {
    lines.push("");
    lines.push(linkifyExplicitLinks(fn.description, docUriString));
  }

  if (fn.parameters && fn.parameters.length > 0) {
    lines.push("");
    lines.push("**Parameters:**");
    for (const param of fn.parameters) {
      const description = param.description ? ` - ${linkifyExplicitLinks(param.description, docUriString)}` : "";
      lines.push(`- \`${param.name}\`${description}`);
    }
  }

  if (fn.returns) {
    lines.push("");
    lines.push(`**Returns:** ${linkifyExplicitLinks(fn.returns, docUriString)}`);
  }

  if (fn.category) {
    lines.push("");
    lines.push(`_${fn.category}_`);
  }

  if (fn.source && fn.source.document) {
    lines.push("");
    lines.push(`_Source: \`${fn.source.document}\`_`);
  }

  return lines.join("\n");
}

function markdownForConstant(constant, name) {
  const lines = [];
  lines.push("```4dgl");
  lines.push(constant.value ? `${name} = ${constant.value}` : name);
  lines.push("```");

  if (constant.description) {
    lines.push("");
    lines.push(constant.description);
  }

  if (constant.category) {
    lines.push("");
    lines.push(`_${constant.category}_`);
  }

  if (constant.source && constant.source.confidence === "example") {
    lines.push("");
    lines.push("_Extracted from example usage._");
  }

  return lines.join("\n");
}

/**
 * `options`:
 *   - docUriString: the document being hovered/completed, so `{@link}` clicks can resolve
 *     user-defined targets there
 *   - definedInPath: a display-ready (already workspace-relativized) path string; only
 *     pass this when the function comes from an included file — omit for same-file hovers
 */
function markdownForUserFunction(fn, options) {
  const { docUriString, definedInPath } = options || {};

  const lines = [];
  lines.push("```4dgl");
  lines.push(fn.signature);
  lines.push("```");

  if (fn.description) {
    lines.push("");
    lines.push(linkifyExplicitLinks(fn.description, docUriString));
  }

  if (fn.parameters && fn.parameters.length > 0) {
    lines.push("");
    lines.push("**Parameters:**");
    for (const p of fn.parameters) {
      const description = p.description ? ` - ${linkifyExplicitLinks(p.description, docUriString)}` : "";
      const sigil = `${p.pointer ? "*" : ""}${p.address ? "&" : ""}`;
      lines.push(`- \`${sigil}${p.name}\`${description}`);
    }
  }

  if (fn.returns) {
    lines.push("");
    lines.push(`**Returns:** ${linkifyExplicitLinks(fn.returns, docUriString)}`);
  }

  if (definedInPath) {
    lines.push("");
    lines.push(`_Defined in \`${definedInPath}\`_`);
  }

  lines.push("");
  lines.push("_User-defined function_");
  return lines.join("\n");
}

function markdownForUserVariable(name, variable, docUriString) {
  const lines = [];
  lines.push("```4dgl");
  const arraySuffix = variable.arraySize !== undefined ? `[${variable.arraySize}]` : "";
  const sigil = `${variable.pointer ? "*" : ""}${variable.address ? "&" : ""}`;
  lines.push(
    variable.type === "var" ? `var ${sigil}${name}${arraySuffix}` : `${variable.type} ${sigil}${name}${arraySuffix}`
  );
  lines.push("```");

  if (variable.description) {
    lines.push("");
    lines.push(linkifyExplicitLinks(variable.description, docUriString));
  }

  lines.push("");
  lines.push("_User-defined variable_");
  return lines.join("\n");
}

function markdownForUserConstant(name, constant) {
  const lines = [];
  lines.push("```4dgl");
  lines.push(constant.value ? `const ${name} := ${constant.value}` : `const ${name}`);
  lines.push("```");
  lines.push("");
  lines.push("_User-defined constant_");
  return lines.join("\n");
}

module.exports = {
  loadConstantDatabase,
  loadFunctionDatabase,
  markdownForFunction,
  markdownForConstant,
  markdownForUserFunction,
  markdownForUserVariable,
  markdownForUserConstant,
};
