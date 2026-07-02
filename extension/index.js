const { loadConstantDatabase, loadFunctionDatabase } = require("./docDatabase");
const { loadKeywordDatabase } = require("./keywordDatabase");
const { createHoverProvider } = require("./hover");
const { createCompletionProvider } = require("./completion");
const { createSignatureProvider } = require("./signature");
const { DocumentManager } = require("./documentManager");
const { registerLanguageDetection } = require("./languageDetection");
const { registerSemanticTokensProvider } = require("./semanticTokens");
const { ensureLibrarySelected, registerLibrarySwitching } = require("./libraryManager");

async function activate(context) {
  registerLanguageDetection(context);

  const library = (await ensureLibrarySelected(context)) || "diablo16";

  const functions = loadFunctionDatabase(context, library);
  const constants = loadConstantDatabase(context, library);
  const keywords = loadKeywordDatabase(context);

  const documentManager = new DocumentManager();
  documentManager.activate(context);

  context.subscriptions.push(createHoverProvider(functions, constants, keywords, documentManager));
  context.subscriptions.push(createCompletionProvider(functions, constants, keywords, documentManager));
  context.subscriptions.push(createSignatureProvider(functions, documentManager));
  registerSemanticTokensProvider(context, documentManager);
  registerLibrarySwitching(context, functions, constants);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
