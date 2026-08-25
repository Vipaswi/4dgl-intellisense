/**
 * Quick Fixes for the diagnostics published by diagnostics.js.
 *
 * Every fix offered here is one the check already knows: when a name check says
 * "did you mean 'gfx_Line'?" it has the replacement in hand, so there is no reason
 * to make the user retype it. The checks attach a `fixes` list to the problems they
 * report and this module turns each entry into a `CodeAction`; a check with no safe
 * mechanical repair simply attaches nothing. Nothing is inferred here — in
 * particular no fix is invented for an unclosed block, because there is no way to
 * know where the missing terminator belongs.
 *
 * Problems are matched back to their diagnostics through the cache diagnostics.js
 * keeps, rather than by reading data off the `vscode.Diagnostic` objects. Extra
 * properties hung on a Diagnostic are not guaranteed to survive the round trip
 * through a DiagnosticCollection, so the cache is the reliable side.
 */

const vscode = require("vscode");

const LANGUAGE_ID = "4dgl";
const ADD_KNOWN_NAME_COMMAND = "4dgl.addKnownName";

function createCodeActionProvider(getProblems) {
  return {
    provideCodeActions(document, _range, context) {
      const problems = getProblems(document.uri);
      if (!problems || problems.length === 0) return [];

      const actions = [];
      for (const diagnostic of context.diagnostics) {
        if (diagnostic.source !== "4DGL") continue;

        // Same code at the same start position — a diagnostic and its problem are
        // one-to-one, so this can't mis-pair them.
        const problem = problems.find(
          (candidate) =>
            candidate.code === diagnostic.code &&
            candidate.line === diagnostic.range.start.line &&
            candidate.character === diagnostic.range.start.character
        );
        if (!problem) continue;

        for (const [index, fix] of (problem.fixes || []).entries()) {
          const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, diagnostic.range, fix.replacement);
          action.diagnostics = [diagnostic];
          // Only the first is preferred, so `Ctrl+.` then Enter takes the obvious
          // option while the alternatives (':=' vs '==', 'until' vs 'forever') stay
          // one keystroke away.
          action.isPreferred = index === 0;
          actions.push(action);
        }

        // For a name the checks got wrong because it's real but undocumented.
        if (problem.allowName) {
          const action = new vscode.CodeAction(
            `Add '${problem.allowName}' to 4dgl.diagnostics.knownNames`,
            vscode.CodeActionKind.QuickFix
          );
          action.command = {
            command: ADD_KNOWN_NAME_COMMAND,
            title: "Add to known names",
            arguments: [problem.allowName],
          };
          action.diagnostics = [diagnostic];
          actions.push(action);
        }
      }

      return actions;
    },
  };
}

/**
 * Append `name` to `4dgl.diagnostics.knownNames`, preferring workspace scope so the
 * exemption travels with the project it belongs to rather than following the user
 * to unrelated ones.
 */
async function addKnownName(name) {
  if (typeof name !== "string" || name.length === 0) return;

  const config = vscode.workspace.getConfiguration("4dgl.diagnostics");
  const current = config.get("knownNames") || [];
  if (current.includes(name)) return;

  const hasWorkspace = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0;
  await config.update(
    "knownNames",
    [...current, name],
    hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
  );
}

function registerCodeActions(context, getProblems) {
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: LANGUAGE_ID },
      createCodeActionProvider(getProblems),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    // Deliberately not listed in package.json's `contributes.commands`: it takes an
    // argument and only makes sense from the Quick Fix above, so it has no business
    // in the Command Palette.
    vscode.commands.registerCommand(ADD_KNOWN_NAME_COMMAND, addKnownName)
  );
}

module.exports = { registerCodeActions, createCodeActionProvider, addKnownName };
