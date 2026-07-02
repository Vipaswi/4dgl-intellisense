const vscode = require("vscode");

const LANGUAGE_ID = "4dgl";
const CORE_EXTENSIONS = new Set([".4dg", ".4dgl"]);
const SUPPRESS_KEY = "4dgl.suppressLanguagePrompt";

/**
 * Registers the language detection feature.
 * Prompts the user to switch to 4dgl when a .4dg/.4dgl file is opened under
 * a different language mode. Each file URI is only prompted once per session,
 * and the user can additionally suppress the prompt for the rest of the
 * session ("Not now") or indefinitely across sessions ("Don't ask again",
 * persisted in globalState).
 */
function registerLanguageDetection(context) {
  const prompted = new Set();
  let suppressedThisSession = false;

  async function checkEditor(editor) {
    if (!editor) return;
    if (suppressedThisSession) return;
    if (context.globalState.get(SUPPRESS_KEY)) return;

    const { document } = editor;
    const ext = getExtension(document.fileName);
    if (!CORE_EXTENSIONS.has(ext)) return;
    if (document.languageId === LANGUAGE_ID) return;

    const uri = document.uri.toString();
    if (prompted.has(uri)) return;
    prompted.add(uri);

    const glob = `*${ext}`;
    const pick = await vscode.window.showInformationMessage(
      "This looks like a 4DGL file. Switch language mode?",
      "Switch",
      `Always for ${glob}`,
      "Not now",
      "Don't ask again"
    );

    if (!pick || pick === "Not now") {
      suppressedThisSession = true;
      return;
    }

    if (pick === "Don't ask again") {
      await context.globalState.update(SUPPRESS_KEY, true);
      return;
    }

    await vscode.languages.setTextDocumentLanguage(document, LANGUAGE_ID);

    if (pick === `Always for ${glob}`) {
      const config = vscode.workspace.getConfiguration();
      const associations = config.get("files.associations") || {};
      associations[glob] = LANGUAGE_ID;
      await config.update(
        "files.associations",
        associations,
        vscode.ConfigurationTarget.Global
      );
    }
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(checkEditor)
  );

  checkEditor(vscode.window.activeTextEditor);
}

function getExtension(fileName) {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

module.exports = { registerLanguageDetection };
