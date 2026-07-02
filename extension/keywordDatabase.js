const fs = require("fs");
const path = require("path");

// Loads data/4dgl_keywords.json: a dict of sections (one per doc anchor),
// each with a `names` array of every keyword/directive spelling that
// section documents (e.g. the "while-wend" section documents both `while`
// and `wend`).
function loadKeywordDatabase(context) {
  const jsonPath = path.join(context.extensionPath, "data", "4dgl_keywords.json");
  if (!fs.existsSync(jsonPath)) {
    return {};
  }
  const raw = fs.readFileSync(jsonPath, "utf8");
  return JSON.parse(raw);
}

// Flatten sections into a name -> entry lookup for hover, keyed both by the
// exact documented spelling (e.g. "#DATA") and its lowercase form (so
// hovering "while" or "WHILE" both resolve).
function flattenKeywordNames(sections) {
  const byName = {};
  for (const entry of Object.values(sections)) {
    for (const name of entry.names || []) {
      byName[name] = entry;
      byName[name.toLowerCase()] = entry;
    }
  }
  return byName;
}

function markdownForKeyword(entry) {
  const lines = [];
  const label = entry.names && entry.names.length > 1 ? entry.names.join(" / ") : (entry.names || [])[0] || "";

  lines.push("```4dgl");
  lines.push(entry.signature || label);
  lines.push("```");

  if (entry.description) {
    lines.push("");
    lines.push(entry.description);
  }

  if (entry.parameters && entry.parameters.length > 0) {
    lines.push("");
    lines.push("**Parameters:**");
    for (const p of entry.parameters) {
      const description = p.description ? ` - ${p.description}` : "";
      lines.push(`- \`${p.name}\`${description}`);
    }
  }

  if (entry.related && entry.related.length > 0) {
    lines.push("");
    lines.push("**Related statements:**");
    for (const r of entry.related) {
      const description = r.description ? ` - ${r.description}` : "";
      lines.push(`- \`${r.name}\`${description}`);
    }
  }

  for (const note of entry.notes || []) {
    lines.push("");
    lines.push(`_Note: ${note}_`);
  }

  if (entry.examples && entry.examples.length > 0) {
    lines.push("");
    lines.push("**Example:**");
    lines.push("```4dgl");
    lines.push(entry.examples[0]);
    lines.push("```");
  }

  if (entry.category) {
    lines.push("");
    lines.push(`_${entry.category}_`);
  }

  return lines.join("\n");
}

module.exports = {
  loadKeywordDatabase,
  flattenKeywordNames,
  markdownForKeyword,
};
