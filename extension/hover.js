const vscode = require("vscode");
const {
  markdownForConstant,
  markdownForFunction,
  markdownForUserFunction,
  markdownForUserVariable,
  markdownForUserConstant,
} = require("./docDatabase");
const { flattenKeywordNames, markdownForKeyword } = require("./keywordDatabase");
const { variablesInScope } = require("./completion");

// Directives start with '#' (e.g. #DATA, #MODE), which the default word
// pattern excludes, so hovering anywhere in "#DATA" needs its own pattern.
const HOVER_WORD_PATTERN = /#?[A-Za-z_][A-Za-z0-9_]*/;

function createHoverProvider(functions, constants, keywords, documentManager) {
  const keywordsByName = flattenKeywordNames(keywords);

  return vscode.languages.registerHoverProvider("4dgl", {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position, HOVER_WORD_PATTERN);
      if (!range) return undefined;

      const word = document.getText(range);

      // Check user-defined symbols first (they override built-ins with the same name)
      const userSymbols = documentManager.getSymbolsForDocument(document.uri);

      if (userSymbols.functions[word]) {
        const md = new vscode.MarkdownString(markdownForUserFunction(userSymbols.functions[word]));
        md.isTrusted = false;
        return new vscode.Hover(md, range);
      }

      // Only hover on variables that are in scope at this cursor position
      const scopedVars = variablesInScope(userSymbols, position.line);
      if (scopedVars[word]) {
        const md = new vscode.MarkdownString(markdownForUserVariable(word, scopedVars[word]));
        md.isTrusted = false;
        return new vscode.Hover(md, range);
      }

      if (userSymbols.constants[word]) {
        const md = new vscode.MarkdownString(markdownForUserConstant(word, userSymbols.constants[word]));
        md.isTrusted = false;
        return new vscode.Hover(md, range);
      }

      // Reserved words (keywords/pre-processor directives) can't be shadowed
      const keyword = keywordsByName[word] || keywordsByName[word.toLowerCase()];
      if (keyword) {
        const md = new vscode.MarkdownString(markdownForKeyword(keyword));
        md.isTrusted = false;
        return new vscode.Hover(md, range);
      }

      // Fall back to built-in database
      const fn = functions[word];
      const constant = constants[word];
      if (!fn && !constant) return undefined;

      const md = new vscode.MarkdownString(fn ? markdownForFunction(fn) : markdownForConstant(constant, word));
      md.isTrusted = false;
      return new vscode.Hover(md, range);
    },
  });
}

module.exports = {
  createHoverProvider,
};
