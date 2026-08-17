const vscode = require("vscode");
const {
  markdownForConstant,
  markdownForFunction,
  markdownForUserFunction,
  markdownForUserVariable,
  markdownForUserConstant,
} = require("./docDatabase");
const { markdownForKeyword } = require("./keywordDatabase");

/**
 * Given the merged symbol table and a cursor line, return the variables that are
 * in scope at that position:
 *   - Always: global variables from the current file (symbols.variables)
 *   - If inside a function: also that function's localVars and parameters
 *
 * Only functions from the current file are considered for scope (fromInclude ones
 * have line numbers belonging to a different file and must be skipped).
 */
function variablesInScope(symbols, cursorLine) {
  const vars = { ...symbols.variables };

  for (const fn of Object.values(symbols.functions)) {
    if (fn.fromInclude) continue;
    if (fn.startLine === undefined || fn.endLine === undefined) continue;
    if (cursorLine <= fn.startLine || cursorLine >= fn.endLine) continue;

    // Cursor is inside this function — add its locals and parameters
    for (const [name, v] of Object.entries(fn.localVars || {})) {
      vars[name] = v;
    }
    for (const param of fn.parameters || []) {
      if (!(param.name in vars)) {
        vars[param.name] = {
          type: "var",
          userDefined: true,
          description: param.description,
          pointer: param.pointer,
          address: param.address,
        };
      }
    }
    break; // functions don't nest in 4DGL
  }

  return vars;
}

function createCompletionProvider(functions, constants, keywords, documentManager) {
  // Static built-in items (same for every document)
  const builtinFunctionItems = Object.entries(functions).map(([name, fn]) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
    item.detail = fn.signature;
    const doc = new vscode.MarkdownString(markdownForFunction(fn));
    doc.isTrusted = { enabledCommands: ["4dgl.revealFunction"] };
    item.documentation = doc;
    item.insertText = name;
    item.sortText = `1_${name.toLowerCase()}`;
    return item;
  });

  const builtinConstantItems = Object.entries(constants).map(([name, constant]) => {
    // Colour constants get CompletionItemKind.Color so VS Code's suggest widget
    // renders a swatch instead of the usual constant icon. VS Code only detects
    // this when `detail` is *exactly* a CSS color string (anchored regex, no
    // surrounding text) - see suggestWidgetRenderer.ts's ColorExtractor.
    const isColor = Boolean(constant.cssHex);
    const item = new vscode.CompletionItem(
      name,
      isColor ? vscode.CompletionItemKind.Color : vscode.CompletionItemKind.Constant
    );
    item.detail = isColor ? constant.cssHex : constant.value ? `${name} = ${constant.value}` : name;
    item.documentation = new vscode.MarkdownString(markdownForConstant(constant, name));
    item.insertText = name;
    item.sortText = `2_${name.toLowerCase()}`;
    return item;
  });

  const builtinKeywordItems = [];
  for (const entry of Object.values(keywords)) {
    const kind = entry.kind === "function" ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Keyword;
    for (const name of entry.names || []) {
      const item = new vscode.CompletionItem(name, kind);
      item.detail = entry.signature || name;
      item.documentation = new vscode.MarkdownString(markdownForKeyword(entry));
      item.insertText = name;
      item.sortText = `1_${name.toLowerCase()}`;
      builtinKeywordItems.push(item);
    }
  }

  return vscode.languages.registerCompletionItemProvider(
    "4dgl",
    {
      provideCompletionItems(document, position) {
        const userSymbols = documentManager.getSymbolsForDocument(document.uri);
        const cursorLine = position.line;

        const userFunctionItems = Object.entries(userSymbols.functions).map(([name, fn]) => {
          const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
          item.detail = fn.signature;
          const definedInPath = fn.fromInclude ? vscode.workspace.asRelativePath(fn.definedInFile) : undefined;
          const doc = new vscode.MarkdownString(
            markdownForUserFunction(fn, {
              docUriString: document.uri.toString(),
              definedInPath,
            })
          );
          doc.isTrusted = { enabledCommands: ["4dgl.revealFunction"] };
          item.documentation = doc;
          item.insertText = name;
          item.sortText = `0_${name.toLowerCase()}`;
          return item;
        });

        const scopedVars = variablesInScope(userSymbols, cursorLine);
        const userVariableItems = Object.entries(scopedVars).map(([name, v]) => {
          const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
          const sigil = `${v.pointer ? "*" : ""}${v.address ? "&" : ""}`;
          item.detail = v.type === "var" ? `var ${sigil}${name}` : `${v.type} ${sigil}${name}`;
          const doc = new vscode.MarkdownString(markdownForUserVariable(name, v, document.uri.toString()));
          doc.isTrusted = { enabledCommands: ["4dgl.revealFunction"] };
          item.documentation = doc;
          item.insertText = name;
          item.sortText = `0_${name.toLowerCase()}`;
          return item;
        });

        const userConstantItems = Object.entries(userSymbols.constants).map(([name, c]) => {
          const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Constant);
          item.detail = c.value ? `const ${name} := ${c.value}` : `const ${name}`;
          item.documentation = new vscode.MarkdownString(markdownForUserConstant(name, c));
          item.insertText = name;
          item.sortText = `0_${name.toLowerCase()}`;
          return item;
        });

        return [
          ...userFunctionItems,
          ...userVariableItems,
          ...userConstantItems,
          ...builtinFunctionItems,
          ...builtinConstantItems,
          ...builtinKeywordItems,
        ];
      },
    },
    // Trigger characters — covers built-in prefixes, common identifier starters,
    // and '#' for pre-processor directives (#DATA, #MODE, ...)
    "_", "#",
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
    "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"
  );
}

module.exports = {
  createCompletionProvider,
  variablesInScope,
};
