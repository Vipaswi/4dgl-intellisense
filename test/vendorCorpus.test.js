/**
 * The regression test that actually matters: run every check over the ~3,270 blocks of
 * 4D-Systems-authored 4DGL in Resources/*.txt. Anything reported there is a suspected
 * false positive, because the vendor's own code is the closest thing to ground truth
 * for "code that should be accepted".
 *
 * The thresholds below are ceilings on known, catalogued residue — manual typos, OCR
 * damage, `[optional]` syntax templates, prose in code blocks, and long strings the
 * vendor PDF hard-wrapped mid-token. If a change pushes a count up, the new entry is a
 * false positive until proven otherwise; if a change pushes one down, tighten it.
 */

const fs = require("fs");
const path = require("path");
const { suite, ok } = require("./_harness");
const { validate, tokenize } = require("../extension/syntaxValidator");
const { check } = require("../extension/semanticChecks");
const { parseDocument } = require("../extension/documentParser");
// Loaded through docDatabase.js, not straight from the JSON, so the corrections in
// data/4dgl_name_corrections.json are part of what's under test.
const { loadFunctionDatabase, loadConstantDatabase } = require("../extension/docDatabase");

const ROOT = path.join(__dirname, "..");
const LIBRARIES = ["diablo16", "goldelox", "picaso", "pixxi"];
const context = { extensionPath: ROOT };

const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", name), "utf8"));
const unverified = load("4dgl_arity_unverified.json");
const database = {};
for (const library of LIBRARIES) {
  database[library] = {
    functions: loadFunctionDatabase(context, library),
    constants: loadConstantDatabase(context, library),
    unverifiedArity: new Set(unverified[library] || []),
  };
}

/** Same dependency-free <code> extraction tools/verify_arity.js uses. */
function codeBlocks(html) {
  const blocks = [];
  const re = /<code\b[^>]*>([\s\S]*?)<\/code>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const text = match[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
    if (text.trim()) blocks.push(text);
  }
  return blocks;
}

const samples = [];
for (const file of fs.readdirSync(path.join(ROOT, "Resources"))) {
  if (!file.endsWith(".txt")) continue;
  const library = LIBRARIES.find((l) => file.includes(l)) || "diablo16";
  for (const text of codeBlocks(fs.readFileSync(path.join(ROOT, "Resources", file), "utf8"))) {
    samples.push({ file, library, text });
  }
}

const options = {
  unknownDirectives: true,
  assignmentOperator: true,
  unknownFunctions: true,
  unknownConstants: true,
  argumentCount: true,
};

let structuralFlagged = 0;
let completeFlagged = 0;
let completeTotal = 0;
const semanticCounts = { "unknown-function": 0, "unknown-constant": 0, "argument-count": 0 };
const detail = { "unknown-function": new Map(), "unknown-constant": new Map(), "argument-count": new Map() };

for (const sample of samples) {
  const structural = validate(sample.text, options);
  if (structural.length > 0) structuralFlagged++;

  // "Complete-looking" = defines and closes a function, i.e. plausibly a whole program
  // rather than a syntax-table cell or a paragraph of prose.
  const looksComplete =
    /^\s*func\s+\w+\s*\(/m.test(sample.text) &&
    /^\s*endfunc\b/m.test(sample.text) &&
    sample.text.split("\n").length >= 4;
  if (looksComplete) {
    completeTotal++;
    if (structural.length > 0) completeFlagged++;
  }

  let parsed;
  try {
    parsed = parseDocument(sample.text);
  } catch {
    continue;
  }
  const inScope = new Set([...Object.keys(parsed.variables), ...Object.keys(parsed.constants)]);
  for (const fn of Object.values(parsed.functions)) {
    for (const parameter of fn.parameters || []) inScope.add(parameter.name);
    for (const local of Object.keys(fn.localVars || {})) inScope.add(local);
  }

  const db = database[sample.library];
  for (const problem of check(
    sample.text,
    {
      builtinFunctions: db.functions,
      builtinConstants: db.constants,
      userFunctions: parsed.functions,
      inScopeNames: inScope,
      allowList: new Set(),
      unverifiedArity: db.unverifiedArity,
    },
    options
  )) {
    if (!(problem.code in semanticCounts)) continue;
    semanticCounts[problem.code]++;
    detail[problem.code].set(problem.message, (detail[problem.code].get(problem.message) || 0) + 1);
  }
}

const top = (code, n = 6) =>
  [...detail[code].entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([message, count]) => `${count}x ${message}`)
    .join("\n        ");

suite(`vendor corpus (${samples.length} code blocks)`);

// Every remaining structural flag is catalogued in CLAUDE.md, "Syntax diagnostics".
ok(
  `at most 10 of ${completeTotal} complete-looking programs flagged (got ${completeFlagged})`,
  completeFlagged <= 10 && completeTotal >= 200,
  `${completeFlagged} flagged of ${completeTotal}`
);
ok(`structural flags across all blocks stay at or under 130 (got ${structuralFlagged})`, structuralFlagged <= 130);

// The near-miss rule keeps these low; most of what's left is a genuine case-sensitivity
// bug in the vendor's own example code (`pin_set` for `pin_Set`). The constant count
// is down to two manual-damage cases: `IMG_FRAME_COU NT` wrapped mid-token by the PDF,
// and a `TXT_MARGIN` row in a Revision History table.
ok(
  `unknown-function at or under 45 (got ${semanticCounts["unknown-function"]})`,
  semanticCounts["unknown-function"] <= 45,
  top("unknown-function")
);
ok(
  `unknown-constant at or under 5 (got ${semanticCounts["unknown-constant"]})`,
  semanticCounts["unknown-constant"] <= 5,
  top("unknown-constant")
);
// Nearly all of the residue here is `name()` written in a Revision History table.
ok(
  `argument-count at or under 15 (got ${semanticCounts["argument-count"]})`,
  semanticCounts["argument-count"] <= 15,
  top("argument-count")
);

suite("lexer covers everything an argument list can hold");
const tokenCount = (source) => tokenize(source).tokens.length;
ok("numbers produce tokens", tokenCount("f(5)") > tokenCount("f()"));
ok("strings produce tokens", tokenCount('f("x")') > tokenCount("f()"));
ok("char literals produce tokens", tokenCount("f('x')") > tokenCount("f()"));
