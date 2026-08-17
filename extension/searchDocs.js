/**
 * "Search Documentation" commands — fuzzy search across the active internal-functions
 * library plus user-defined functions, in a QuickPick.
 *
 * Matching is delegated entirely to VS Code's own QuickPick fuzzy filter (the same
 * subsequence-scoring matcher behind the command palette / Go to Symbol) rather than a
 * hand-rolled fuzzy algorithm: it's already the well-tested, native-speed implementation
 * for "fuzzy-match many short records while the user types", and `matchOnDescription` /
 * `matchOnDetail` let it search function descriptions and parameter text too, not just
 * the name. Item lists here run at most in the low thousands of entries, so building
 * them (or, for the repository scope, awaiting one workspace-wide file scan) fresh per
 * invocation is already fast — an index would be solving a performance problem that
 * doesn't exist at this scale.
 */

const vscode = require("vscode");

function paramSigil(p) {
  return `${p.pointer ? "*" : ""}${p.address ? "&" : ""}`;
}

function paramSummary(parameters) {
  if (!parameters || parameters.length === 0) return "";
  return parameters
    .map((p) => {
      const name = `${paramSigil(p)}${p.name}`;
      return p.description ? `${name}: ${p.description}` : name;
    })
    .join("  •  ");
}

function firstLine(text) {
  if (!text) return "";
  return text.split("\n")[0].trim();
}

function toQuickPickItem(name, fn, originLabel) {
  const originSuffix = originLabel ? ` — ${originLabel}` : "";
  return {
    label: name,
    description: `${firstLine(fn.description)}${originSuffix}`,
    detail: `${fn.signature || name}${fn.parameters && fn.parameters.length ? "  |  " + paramSummary(fn.parameters) : ""}`,
    fnName: name,
  };
}

/**
 * Build the built-in-library portion of the corpus. Reads `functions` live so it
 * always reflects whichever internal-functions library is currently active (the
 * object is mutated in place by libraryManager.js on library switch).
 */
function builtinItems(functions) {
  return Object.entries(functions).map(([name, fn]) => toQuickPickItem(name, fn, fn.category));
}

/**
 * User-defined portion. `showOrigin` always labels each item with its defining file
 * (appropriate for a repository-wide scan, where every result comes from "some file");
 * otherwise the origin is shown only for functions pulled in via #INCLUDE (appropriate
 * for the linked-functions scan, where same-file results need no extra label).
 */
function userItems(symbols, showOrigin) {
  return Object.entries(symbols.functions).map(([name, fn]) => {
    const origin = showOrigin || fn.fromInclude ? vscode.workspace.asRelativePath(fn.definedInFile) : null;
    return toQuickPickItem(name, fn, origin);
  });
}

function getActive4dglDocument() {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.languageId === "4dgl") return editor.document;
  return null;
}

function runSearch(functions, documentManager, { scope }) {
  const doc = getActive4dglDocument();

  const quickPick = vscode.window.createQuickPick();
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.placeholder =
    scope === "repository"
      ? "Search library + every 4DGL file in the workspace by name, description, or parameter..."
      : "Search library + this file's linked functions by name, description, or parameter...";
  quickPick.items = builtinItems(functions);

  quickPick.onDidAccept(async () => {
    const [selected] = quickPick.selectedItems;
    quickPick.hide();
    if (!selected) return;
    await vscode.commands.executeCommand("4dgl.revealFunction", selected.fnName, doc ? doc.uri.toString() : undefined);
  });
  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();

  if (scope === "repository") {
    quickPick.busy = true;
    documentManager.getRepositorySymbols(doc ? doc.uri : undefined).then((symbols) => {
      quickPick.items = [...userItems(symbols, true), ...quickPick.items];
      quickPick.busy = false;
    });
  } else if (doc) {
    const symbols = documentManager.getSymbolsForDocument(doc.uri);
    quickPick.items = [...userItems(symbols, false), ...quickPick.items];
  }
}

function registerSearchCommands(context, functions, documentManager) {
  context.subscriptions.push(
    vscode.commands.registerCommand("4dgl.searchDocumentation", () =>
      runSearch(functions, documentManager, { scope: "repository" })
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("4dgl.searchDocumentationLinked", () =>
      runSearch(functions, documentManager, { scope: "linked" })
    )
  );
}

module.exports = { registerSearchCommands };
