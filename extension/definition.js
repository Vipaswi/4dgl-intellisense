const vscode = require("vscode");
const { builtinDocUri } = require("./crossLink");

/**
 * Native Ctrl/Cmd+click "go to definition" for function calls in source, distinct from the
 * command-link cross-linking inside hover/completion markdown (crossLink.js): a user-defined
 * function jumps to its real file/line, a built-in opens its read-only reference page (the
 * same virtual doc crossLink.js's links already navigate to).
 */
function createDefinitionProvider(functions, documentManager) {
  return vscode.languages.registerDefinitionProvider("4dgl", {
    provideDefinition(document, position) {
      const range = document.getWordRangeAtPosition(position);
      if (!range) return undefined;
      const word = document.getText(range);

      const userSymbols = documentManager.getSymbolsForDocument(document.uri);
      const userFn = userSymbols.functions[word];
      if (userFn && userFn.definedInFile) {
        const pos = new vscode.Position(userFn.startLine, 0);
        return new vscode.Location(vscode.Uri.file(userFn.definedInFile), pos);
      }

      if (functions[word]) {
        return new vscode.Location(builtinDocUri(word), new vscode.Position(0, 0));
      }

      return undefined;
    },
  });
}

module.exports = { createDefinitionProvider };
