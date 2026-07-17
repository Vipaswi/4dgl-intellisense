const fs = require("fs");
const path = require("path");

function loadFunctionDatabase(context, library) {
  const jsonPath = path.join(context.extensionPath, "data", `4dgl_functions_${library}.json`);
  const raw = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, "utf8") : "{}";
  return JSON.parse(raw);
}

function loadConstantDatabase(context, library) {
  const jsonPath = path.join(context.extensionPath, "data", `4dgl_constants_${library}.json`);
  const constants = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : {};

  const colorsPath = path.join(context.extensionPath, "data", "4dgl_colors.json");
  const colors = fs.existsSync(colorsPath) ? JSON.parse(fs.readFileSync(colorsPath, "utf8")) : {};

  return { ...constants, ...colors };
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
      lines.push(`- \`${p.name}\`${description}`);
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
  lines.push(variable.type === "var" ? `var ${name}${arraySuffix}` : `${variable.type} ${name}${arraySuffix}`);
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
