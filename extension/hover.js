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

// Directives start with '#' (e.g. #DATA, #MODE) and doc-comment tags start with '@'
// (e.g. @param, {@link ...}), both of which the default word pattern excludes, so
// hovering anywhere in "#DATA" or "@param" needs its own pattern.
const HOVER_WORD_PATTERN = /[#@]?[A-Za-z_][A-Za-z0-9_]*/;

// These tags are a 4DGL Intellisense convention (Javadoc-style), not part of the 4DGL
// language itself — hovering the tag explains that rather than silently doing nothing.
const DOC_TAG_HELP = {
  "@param": "Documents a function parameter: `@param name description`.\n\n_This is a 4DGL Intellisense convention (Javadoc-style), not part of the 4DGL language itself._",
  "@return": "Documents a function's return value: `@return description`.\n\n_This is a 4DGL Intellisense convention (Javadoc-style), not part of the 4DGL language itself._",
  "@returns": "Documents a function's return value: `@returns description`.\n\n_This is a 4DGL Intellisense convention (Javadoc-style), not part of the 4DGL language itself._",
  "@link": "Links to another function from a doc comment: `{@link #methodName() Label text}`. Renders as a clickable link to that function.\n\n_This is a 4DGL Intellisense convention (Javadoc-style), not part of the 4DGL language itself._",
};

function createHoverProvider(functions, constants, keywords, documentManager) {
  const keywordsByName = flattenKeywordNames(keywords);

  return vscode.languages.registerHoverProvider("4dgl", {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position, HOVER_WORD_PATTERN);
      if (!range) return undefined;

      const word = document.getText(range);

      // Doc-comment tags (@param, @return(s), @link) can't collide with any real
      // identifier — '@' never appears in 4DGL code — so this is safe to check first.
      if (DOC_TAG_HELP[word]) {
        const md = new vscode.MarkdownString(DOC_TAG_HELP[word]);
        md.isTrusted = false;
        return new vscode.Hover(md, range);
      }

      // Check user-defined symbols first (they override built-ins with the same name)
      const userSymbols = documentManager.getSymbolsForDocument(document.uri);

      if (userSymbols.functions[word]) {
        const fn = userSymbols.functions[word];
        const definedInPath = fn.fromInclude ? vscode.workspace.asRelativePath(fn.definedInFile) : undefined;
        const doc = markdownForUserFunction(fn, {
          docUriString: document.uri.toString(),
          definedInPath,
        });
        const md = new vscode.MarkdownString(doc);
        md.isTrusted = { enabledCommands: ["4dgl.revealFunction"] };
        return new vscode.Hover(md, range);
      }

      // Only hover on variables that are in scope at this cursor position
      const scopedVars = variablesInScope(userSymbols, position.line);
      if (scopedVars[word]) {
        const md = new vscode.MarkdownString(
          markdownForUserVariable(word, scopedVars[word], document.uri.toString())
        );
        md.isTrusted = { enabledCommands: ["4dgl.revealFunction"] };
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

      const md = new vscode.MarkdownString(
        fn ? markdownForFunction(fn, document.uri.toString()) : markdownForConstant(constant, word)
      );
      md.isTrusted = fn ? { enabledCommands: ["4dgl.revealFunction"] } : false;
      return new vscode.Hover(md, range);
    },
  });
}

module.exports = {
  createHoverProvider,
};
