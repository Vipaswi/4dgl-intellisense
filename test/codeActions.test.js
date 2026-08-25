/**
 * Cases for extension/codeActions.js — the Quick Fixes.
 *
 * Two properties matter here. First, a fix must produce the edit it advertises: the
 * point of "did you mean 'gfx_Line'?" is that you don't retype it. Second, no fix may
 * be invented — there is deliberately none for an unclosed block, because nothing can
 * know where the missing terminator belongs, and a confidently wrong edit is worse
 * than no lightbulb at all.
 */

const { suite, ok, equal } = require("./_harness");
const { stub, reset, makeDocument } = require("./_vscodeStub");
const { createCodeActionProvider, addKnownName } = require("../extension/codeActions");
const { validate } = require("../extension/syntaxValidator");
const { check } = require("../extension/semanticChecks");

const vscode = stub.vscode;

/** Stand in for what diagnostics.js publishes: the problems plus their diagnostics. */
function analyse(source, extraProblems = []) {
  const problems = [...validate(source), ...extraProblems].sort(
    (a, b) => a.line - b.line || a.character - b.character
  );
  const diagnostics = problems.map((problem) => {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(problem.line, problem.character, problem.endLine, problem.endCharacter),
      problem.message,
      problem.severity === "error" ? 0 : 1
    );
    diagnostic.source = "4DGL";
    diagnostic.code = problem.code;
    return diagnostic;
  });
  return { problems, diagnostics };
}

function actionsFor(source, extraProblems = []) {
  const { problems, diagnostics } = analyse(source, extraProblems);
  const document = makeDocument(source);
  const provider = createCodeActionProvider(() => problems);
  return {
    problems,
    actions: provider.provideCodeActions(document, new vscode.Range(0, 0, 0, 0), { diagnostics }) || [],
  };
}

const titles = (actions) => actions.map((a) => a.title);
/** The replacement text a CodeAction's WorkspaceEdit carries, via the stub's recorder. */
const replacement = (action) => action.edit.replacements[0].text;

suite("name fixes");
const nameProblem = check(
  `func main()\n    gfx_Lyne(1, 2, 3, 4, BLUE);\nendfunc`,
  { builtinFunctions: { gfx_Line: { signature: "gfx_Line(a, b, c, d, e)" } }, builtinConstants: { BLUE: {} } },
  { unknownFunctions: true, unknownConstants: true, argumentCount: true }
);
equal("the check produced one problem", nameProblem.length, 1);
const nameResult = actionsFor(`func main()\n    gfx_Lyne(1, 2, 3, 4, BLUE);\nendfunc`, nameProblem);
ok("offers the rename", titles(nameResult.actions).includes("Change to 'gfx_Line'"),
  JSON.stringify(titles(nameResult.actions)));
ok("and offers to allow-list the name instead",
  titles(nameResult.actions).some((t) => /knownNames/.test(t)), JSON.stringify(titles(nameResult.actions)));
equal("the rename edit inserts the suggestion", replacement(nameResult.actions[0]), "gfx_Line");
ok("the rename is the preferred action", nameResult.actions[0].isPreferred === true);
ok("actions carry their diagnostic, so they show as Quick Fixes",
  nameResult.actions.every((a) => a.diagnostics && a.diagnostics.length === 1));

suite("bare '=' offers both operators");
const equals = actionsFor(`func main()\n    x = 1;\nendfunc`);
equal("two actions", equals.actions.length, 2);
ok("assign first, and preferred",
  equals.actions[0].title === "Change to ':=' (assign)" && equals.actions[0].isPreferred === true);
equal("assign replacement", replacement(equals.actions[0]), ":=");
ok("compare second, not preferred",
  equals.actions[1].title === "Change to '==' (compare)" && equals.actions[1].isPreferred === false);
equal("compare replacement", replacement(equals.actions[1]), "==");

suite("mismatched terminator offers what the open block expects");
const wrongEnd = actionsFor(`func main()\n    while (a)\n    endif\nendfunc`);
equal("one action", wrongEnd.actions.length, 1);
equal("swaps endif for wend", replacement(wrongEnd.actions[0]), "wend");
// `repeat` is closed by either, so both are offered rather than one being guessed.
const repeatEnd = actionsFor(`func main()\n    repeat\n    endif\nendfunc`);
equal("repeat offers two terminators", repeatEnd.actions.length, 2);
ok("both until and forever", titles(repeatEnd.actions).join(",") === "Change to 'until',Change to 'forever'",
  JSON.stringify(titles(repeatEnd.actions)));

suite("braces offer removal");
const brace = actionsFor(`func main()\n    if (a) {\n    endif\nendfunc`);
ok("offers to remove it", titles(brace.actions).includes("Remove '{'"), JSON.stringify(titles(brace.actions)));
equal("by replacing with nothing", replacement(brace.actions[0]), "");

suite("no fix is invented where none is safe");
for (const [label, source] of [
  ["unclosed block", `func main()\n    if (a)\n        x := 1;\nendfunc`],
  ["unclosed bracket", `func main()\n    gfx_Line(1, 2, 3;\nendfunc`],
  ["orphan keyword", `func main()\n    break;\nendfunc`],
  ["missing condition", `func main()\n    if a > b\n        x := 1;\n    endif\nendfunc`],
]) {
  const result = actionsFor(source);
  ok(`${label}: diagnostic reported but no Quick Fix`,
    result.problems.length > 0 && result.actions.length === 0,
    `${result.problems.length} problems, ${result.actions.length} actions`);
}

suite("provider is quiet when it has nothing to say");
const cleanDoc = makeDocument(`func main()\n    x := 1;\nendfunc`);
const emptyProvider = createCodeActionProvider(() => undefined);
equal("no cached problems -> no actions",
  (emptyProvider.provideCodeActions(cleanDoc, new vscode.Range(0, 0, 0, 0), { diagnostics: [] }) || []).length, 0);
const foreign = createCodeActionProvider(() => nameProblem);
const foreignDiagnostic = new vscode.Diagnostic(new vscode.Range(1, 4, 1, 12), "something else", 1);
foreignDiagnostic.source = "eslint";
equal("another extension's diagnostic is ignored",
  (foreign.provideCodeActions(cleanDoc, new vscode.Range(0, 0, 0, 0), { diagnostics: [foreignDiagnostic] }) || []).length, 0);

suite("adding a known name");
module.exports = (async () => {
  reset({ settings: {} });
  await addKnownName("gfx_Lyne");
  equal("appended to the setting",
    JSON.stringify(stub.settings["4dgl.diagnostics.knownNames"]), JSON.stringify(["gfx_Lyne"]));
  await addKnownName("gfx_Lyne");
  equal("adding twice does not duplicate",
    JSON.stringify(stub.settings["4dgl.diagnostics.knownNames"]), JSON.stringify(["gfx_Lyne"]));
  await addKnownName("");
  equal("an empty name is ignored",
    JSON.stringify(stub.settings["4dgl.diagnostics.knownNames"]), JSON.stringify(["gfx_Lyne"]));
})();
