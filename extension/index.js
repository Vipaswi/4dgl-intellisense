const { loadConstantDatabase, loadFunctionDatabase } = require("./docDatabase");
const { loadKeywordDatabase } = require("./keywordDatabase");
const { createHoverProvider } = require("./hover");
const { createCompletionProvider } = require("./completion");
const { createSignatureProvider } = require("./signature");
const { DocumentManager } = require("./documentManager");
const { registerLanguageDetection } = require("./languageDetection");
const { registerSemanticTokensProvider } = require("./semanticTokens");
const { ensureLibrarySelected, registerLibrarySwitching } = require("./libraryManager");
const { registerCrossLinkSupport } = require("./crossLink");
const { createDefinitionProvider } = require("./definition");
const { registerSearchCommands } = require("./searchDocs");
const { registerDiagnostics } = require("./diagnostics");

async function activate(context) {
  registerLanguageDetection(context);

  // Registered before the library prompt below, not after. `ensureLibrarySelected`
  // awaits an interactive QuickPick on first run, and anything registered after it
  // silently never registers at all while that prompt sits unanswered. Structural
  // syntax diagnostics don't need the library, so they start working immediately; the
  // name and argument-count checks do, and are switched on by setSymbolSource below.
  const diagnostics = registerDiagnostics(context);

  const library = (await ensureLibrarySelected(context)) || "diablo16";

  const functions = loadFunctionDatabase(context, library);
  const constants = loadConstantDatabase(context, library);
  const keywords = loadKeywordDatabase(context);

  const documentManager = new DocumentManager();
  documentManager.activate(context);

  context.subscriptions.push(createHoverProvider(functions, constants, keywords, documentManager));
  context.subscriptions.push(createCompletionProvider(functions, constants, keywords, documentManager));
  context.subscriptions.push(createSignatureProvider(functions, documentManager));
  context.subscriptions.push(createDefinitionProvider(functions, documentManager));
  registerSemanticTokensProvider(context, documentManager);
  registerLibrarySwitching(context, functions, constants);
  registerCrossLinkSupport(context, functions, documentManager);
  registerSearchCommands(context, functions, documentManager);

  // `functions`/`constants` are passed by reference; a library switch mutates them in
  // place rather than reassigning (see libraryManager.js), so the checks follow along.
  diagnostics.setSymbolSource({ functions, constants, documentManager });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
