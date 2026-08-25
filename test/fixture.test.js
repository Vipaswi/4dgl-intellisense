/**
 * Checks test/fixtures/diagnostics-demo.4dgl against its own annotations.
 *
 * Every line the fixture expects a problem on carries a trailing `// ERROR`,
 * `// WARN`, `// NAME` or `// ARGS` comment; every other line must come back clean.
 * The fixture doubles as the thing to eyeball in an Extension Development Host, so
 * its top half is deliberately full of correct code that the checks could trip over.
 *
 * Two things to keep in mind when editing it:
 *   - anchor an annotation on the line the diagnostic actually points at (the opener
 *     for an unclosed block, the offending terminator for a mismatch)
 *   - keep each broken construct in its own `func`; two side by side change which
 *     reading the error recovery picks, and mask each other
 */

const fs = require("fs");
const path = require("path");
const { suite, ok } = require("./_harness");
const { validate } = require("../extension/syntaxValidator");
const { check } = require("../extension/semanticChecks");
const { parseDocument } = require("../extension/documentParser");
const { loadFunctionDatabase, loadConstantDatabase } = require("../extension/docDatabase");

const ROOT = path.join(__dirname, "..");
const LIBRARY = "diablo16";

const file = path.join(__dirname, "fixtures", "diagnostics-demo.4dgl");
const text = fs.readFileSync(file, "utf8");
const lines = text.split("\n");

const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", name), "utf8"));
const context = { extensionPath: ROOT };
const functions = loadFunctionDatabase(context, LIBRARY);
const constants = loadConstantDatabase(context, LIBRARY);
const unverified = new Set(load("4dgl_arity_unverified.json")[LIBRARY] || []);

const parsed = parseDocument(text);
const inScope = new Set([...Object.keys(parsed.variables), ...Object.keys(parsed.constants)]);
for (const fn of Object.values(parsed.functions)) {
  for (const parameter of fn.parameters || []) inScope.add(parameter.name);
  for (const local of Object.keys(fn.localVars || {})) inScope.add(local);
}

const options = {
  unknownDirectives: true,
  assignmentOperator: true,
  unknownFunctions: true,
  unknownConstants: true,
  argumentCount: true,
};

const problems = [
  ...validate(text, options),
  ...check(
    text,
    {
      builtinFunctions: functions,
      builtinConstants: constants,
      userFunctions: parsed.functions,
      inScopeNames: inScope,
      allowList: new Set(),
      unverifiedArity: unverified,
    },
    options
  ),
];

// The banner at the top of the fixture explains the convention; it isn't an expectation.
const ANNOTATION = /\/\/\s*(ERROR|WARN|NAME|ARGS)\b/;
const expected = new Set();
lines.forEach((line, index) => {
  if (ANNOTATION.test(line) && !/should squiggle/.test(line)) expected.add(index);
});

const reported = new Map();
for (const problem of problems) {
  if (!reported.has(problem.line)) reported.set(problem.line, []);
  reported.get(problem.line).push(problem);
}

suite("fixture: annotated lines are reported");
const missed = [...expected].filter((line) => !reported.has(line));
ok(
  `all ${expected.size} annotated lines produce a diagnostic`,
  missed.length === 0,
  missed.map((line) => `line ${line + 1}: ${lines[line].trim()}`).join("\n        ")
);

suite("fixture: nothing else is reported");
const unexpected = [...reported.keys()].filter((line) => !expected.has(line));
ok(
  "no diagnostic on an unannotated line",
  unexpected.length === 0,
  unexpected
    .map((line) => `line ${line + 1}: ${lines[line].trim()}\n            ${reported.get(line).map((p) => `[${p.code}] ${p.message}`).join("\n            ")}`)
    .join("\n        ")
);
