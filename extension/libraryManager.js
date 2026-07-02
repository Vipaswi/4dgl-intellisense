const vscode = require("vscode");
const { loadFunctionDatabase, loadConstantDatabase } = require("./docDatabase");

const CONFIG_SECTION = "4dgl";
const CONFIG_KEY = "library";
const LIBRARIES = ["diablo16", "goldelox", "picaso", "pixxi"];

function getActiveLibrary() {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).get(CONFIG_KEY);
}

async function promptForLibrary(context) {
  const picked = await vscode.window.showQuickPick(LIBRARIES, {
    placeHolder: "Which 4DGL internal functions library does your project target?",
    ignoreFocusOut: true,
  });
  if (!picked) return undefined;

  let target = vscode.ConfigurationTarget.Global;
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const scope = await vscode.window.showQuickPick(
      [
        { label: "Just this workspace", target: vscode.ConfigurationTarget.Workspace },
        { label: "All projects (global)", target: vscode.ConfigurationTarget.Global },
      ],
      { placeHolder: "Apply this library selection to..." }
    );
    if (!scope) return undefined;
    target = scope.target;
  }

  await vscode.workspace.getConfiguration(CONFIG_SECTION).update(CONFIG_KEY, picked, target);
  return picked;
}

async function ensureLibrarySelected(context) {
  const existing = getActiveLibrary();
  if (existing) return existing;
  return promptForLibrary(context);
}

function replaceContents(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function registerLibrarySwitching(context, functions, constants) {
  context.subscriptions.push(
    vscode.commands.registerCommand("4dgl.switchLibrary", async () => {
      const picked = await promptForLibrary(context);
      if (picked) {
        vscode.window.showInformationMessage(`4DGL: now using the ${picked} internal functions library.`);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_KEY}`)) return;
      const library = getActiveLibrary();
      if (!library) return;

      replaceContents(functions, loadFunctionDatabase(context, library));
      replaceContents(constants, loadConstantDatabase(context, library));
    })
  );
}

module.exports = {
  LIBRARIES,
  getActiveLibrary,
  promptForLibrary,
  ensureLibrarySelected,
  registerLibrarySwitching,
};
