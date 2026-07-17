/**
 * Backs the clickable function-name links produced by explicit `{@link #name() Label}` tags in
 * docDatabase.js's `linkifyExplicitLinks`.
 *
 * Two pieces:
 *   - a `4dgl-func-doc:` virtual document scheme that renders a read-only doc page for a
 *     built-in function (so a link to a built-in has somewhere real to navigate to)
 *   - the `4dgl.revealFunction` command those links invoke: jump to a user-defined
 *     function's real location when possible, otherwise open the built-in's virtual doc.
 */

const vscode = require("vscode");
const { markdownForFunction } = require("./docDatabase");

const DOC_SCHEME = "4dgl-func-doc";

// Shared with definition.js: the virtual doc URI a built-in function's name resolves to,
// for both the "open reference page" command and native go-to-definition.
function builtinDocUri(name) {
  return vscode.Uri.parse(`${DOC_SCHEME}:/${encodeURIComponent(name)}.md`);
}

function createFunctionDocProvider(functions) {
  return {
    provideTextDocumentContent(uri) {
      const name = decodeURIComponent(uri.path.replace(/^\//, "").replace(/\.md$/, ""));
      const fn = functions[name];
      if (!fn) return `# ${name}\n\nNo documentation found.`;
      return `# ${name}\n\n${markdownForFunction(fn)}`;
    },
  };
}

async function openBuiltinDoc(name) {
  const uri = builtinDocUri(name);
  try {
    await vscode.commands.executeCommand("markdown.showPreview", uri);
  } catch {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  }
}

async function openUserFunction(fn) {
  const uri = vscode.Uri.file(fn.definedInFile);
  const doc = await vscode.workspace.openTextDocument(uri);
  const pos = new vscode.Position(fn.startLine, 0);
  await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
}

function registerCrossLinkSupport(context, functions, documentManager) {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DOC_SCHEME, createFunctionDocProvider(functions))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("4dgl.revealFunction", async (name, docUriString) => {
      if (docUriString) {
        const originUri = vscode.Uri.parse(docUriString);
        const symbols = documentManager.getSymbolsForDocument(originUri);
        const userFn = symbols.functions[name];
        if (userFn && userFn.definedInFile) {
          await openUserFunction(userFn);
          return;
        }
      }

      if (functions[name]) {
        await openBuiltinDoc(name);
        return;
      }

      vscode.window.showInformationMessage(`4DGL: no documentation found for "${name}".`);
    })
  );
}

module.exports = { registerCrossLinkSupport, builtinDocUri };
