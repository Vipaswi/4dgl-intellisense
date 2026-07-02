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

function markdownForFunction(fn) {
  const lines = [];
  lines.push("```4dgl");
  lines.push(fn.signature);
  lines.push("```");

  if (fn.description) {
    lines.push("");
    lines.push(fn.description);
  }

  if (fn.parameters && fn.parameters.length > 0) {
    lines.push("");
    lines.push("**Parameters:**");
    for (const param of fn.parameters) {
      const description = param.description ? ` - ${param.description}` : "";
      lines.push(`- \`${param.name}\`${description}`);
    }
  }

  if (fn.returns) {
    lines.push("");
    lines.push(`**Returns:** ${fn.returns}`);
  }

  if (fn.category) {
    lines.push("");
    lines.push(`_${fn.category}_`);
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

function markdownForUserFunction(fn) {
  const lines = [];
  lines.push("```4dgl");
  lines.push(fn.signature);
  lines.push("```");
  if (fn.parameters && fn.parameters.length > 0) {
    lines.push("");
    lines.push("**Parameters:**");
    for (const p of fn.parameters) {
      lines.push(`- \`${p.name}\``);
    }
  }
  lines.push("");
  lines.push("_User-defined function_");
  return lines.join("\n");
}

function markdownForUserVariable(name, variable) {
  const lines = [];
  lines.push("```4dgl");
  const arraySuffix = variable.arraySize !== undefined ? `[${variable.arraySize}]` : "";
  lines.push(variable.type === "var" ? `var ${name}${arraySuffix}` : `${variable.type} ${name}${arraySuffix}`);
  lines.push("```");
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
