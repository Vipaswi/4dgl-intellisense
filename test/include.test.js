/**
 * Does the name/arity checking see functions that arrive through `#inherit`?
 *
 * It should: DocumentManager.getSymbolsForDocument returns the transitive closure of
 * the include chain, and diagnostics.js feeds that whole set to semanticChecks.js as
 * `userFunctions` — which is both the "known names" set and the pool of candidates a
 * misspelling can be matched against.
 *
 * The condition is that the include actually *resolves*. DocumentManager tries the
 * path relative to the including file, then a workspace-wide lookup by basename. A
 * target outside the workspace — the unbundled 4D Systems include folder, typically —
 * resolves to nothing, and its functions are then invisible: calling them is not
 * flagged (they aren't reported as unknown, since they resemble nothing known) but a
 * typo of one isn't caught either. The last case below pins that down.
 */

const fs = require("fs");
const path = require("path");
const { suite, ok, equal } = require("./_harness");
require("./_vscodeStub"); // installs the stub `vscode` before documentManager loads

const { DocumentManager } = require("../extension/documentManager");
const { check } = require("../extension/semanticChecks");
const { loadFunctionDatabase, loadConstantDatabase } = require("../extension/docDatabase");

const ROOT = path.join(__dirname, "..");
const LIBRARY = "diablo16";
const load = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", name), "utf8"));

const context = { extensionPath: ROOT };
const functions = loadFunctionDatabase(context, LIBRARY);
const constants = loadConstantDatabase(context, LIBRARY);
const unverifiedArity = new Set(load("4dgl_arity_unverified.json")[LIBRARY] || []);

const mainPath = path.join(__dirname, "fixtures", "include", "main.4dgl");
const text = fs.readFileSync(mainPath, "utf8");
const lines = text.split("\n");

const manager = new DocumentManager();
const symbols = manager.getSymbolsForDocument({ fsPath: mainPath });

suite("include chain resolution");
ok("the inherited file's functions are visible",
  "helper_DrawFrame" in symbols.functions && "helper_Reset" in symbols.functions,
  `got: ${Object.keys(symbols.functions).join(", ") || "none"}`);
ok("and are marked as coming from an include",
  symbols.functions.helper_DrawFrame && symbols.functions.helper_DrawFrame.fromInclude === true);
equal("with their real parameter list, so arity is exact",
  symbols.functions.helper_DrawFrame.parameters.length, 2);

const inScope = new Set([...Object.keys(symbols.variables), ...Object.keys(symbols.constants)]);
for (const fn of Object.values(symbols.functions)) {
  for (const parameter of fn.parameters || []) inScope.add(parameter.name);
  for (const local of Object.keys(fn.localVars || {})) inScope.add(local);
}

const options = { unknownFunctions: true, unknownConstants: true, argumentCount: true };
const problems = check(
  text,
  {
    builtinFunctions: functions,
    builtinConstants: constants,
    userFunctions: symbols.functions,
    inScopeNames: inScope,
    allowList: new Set(),
    unverifiedArity,
  },
  options
);

const at = (fragment) => problems.filter((p) => (lines[p.line] || "").includes(fragment));

suite("checks against inherited symbols");
ok("a correct call into the inherited file is silent", at("helper_Reset();").length === 0,
  at("helper_Reset();").map((p) => p.message).join("; "));
ok("a correctly-arity'd inherited call is silent", at("helper_DrawFrame(10, 20);").length === 0,
  at("helper_DrawFrame(10, 20);").map((p) => p.message).join("; "));

const typo = at("helper_DrawFram(10, 20);");
equal("a typo of an inherited function is caught", typo.length, 1);
ok("and the suggestion names the inherited function",
  typo[0] && /helper_DrawFrame/.test(typo[0].message), typo[0] && typo[0].message);

const arity = at("helper_DrawFrame(10);");
equal("wrong arity on an inherited function is caught", arity.length, 1);
ok("and it reports the declared count",
  arity[0] && /2 arguments/.test(arity[0].message), arity[0] && arity[0].message);

suite("what an unresolvable include costs");
// Same file, but with no symbol source for the inherited file: this is what a project
// inheriting the unbundled 4D Systems folder looks like.
const blind = check(
  text,
  {
    builtinFunctions: functions,
    builtinConstants: constants,
    userFunctions: {}, // the include resolved to nothing
    inScopeNames: new Set(),
    allowList: new Set(),
    unverifiedArity,
  },
  options
);
equal("correct calls into an unseen file are still not flagged", blind.length, 0);
ok("but the typo goes unnoticed too — nothing to compare against",
  blind.filter((p) => (lines[p.line] || "").includes("helper_DrawFram(")).length === 0);

suite("a name resembling nothing is left alone either way");
ok("unresolvable-looking call is silent",
  at("unrelated_ThingFromNowhere();").length === 0,
  at("unrelated_ThingFromNowhere();").map((p) => p.message).join("; "));
