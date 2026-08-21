/**
 * A fake `vscode` module, so the parts of extension/ that import it can be exercised
 * under plain Node.
 *
 * `vscode` is not an npm package — the extension host injects it at runtime, and
 * there is nothing to install that would make `require("vscode")` resolve outside
 * VS Code. The trick is to put a module into `require.cache` under the bare
 * specifier and teach the resolver that the specifier maps to itself.
 *
 * Anything the extension touches that isn't modelled here is served by a
 * self-creating Proxy (callable, constructable, and recursively accessible), so a
 * test doesn't have to predict the whole API surface. What matters — diagnostics,
 * configuration, and the workspace events — is real.
 */

const Module = require("module");

function autoStub(name) {
  const target = function () {};
  return new Proxy(target, {
    get(object, property) {
      if (property === "then") return undefined; // must not look like a promise
      if (property === Symbol.iterator) return undefined;
      if (property === Symbol.toPrimitive || property === "toString") return () => `<stub ${name}>`;
      if (!(property in object)) object[property] = autoStub(`${name}.${String(property)}`);
      return object[property];
    },
    apply: () => autoStub(`${name}()`),
    construct: () => autoStub(`new ${name}`),
  });
}

function proxied(object, name) {
  return new Proxy(object, {
    get(target, property) {
      if (!(property in target)) target[property] = autoStub(`${name}.${String(property)}`);
      return target[property];
    },
  });
}

/**
 * `settings` maps a full setting id ("4dgl.diagnostics.enabled") to its value;
 * anything absent reads as undefined, which every caller in extension/ treats as
 * "use the default".
 */
function createStub({ settings = {}, documents = [], showQuickPick } = {}) {
  const handlers = {};
  const listen = (event) => (fn) => {
    (handlers[event] = handlers[event] || []).push(fn);
    return { dispose() {} };
  };

  const published = new Map();

  const api = {
    // Real values: DiagnosticSeverity.Error being 0 is load-bearing.
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Range: class {
      constructor(line, character, endLine, endCharacter) {
        Object.assign(this, { line, character, endLine, endCharacter });
      }
    },
    Position: class {
      constructor(line, character) {
        Object.assign(this, { line, character });
      }
    },
    Location: class {
      constructor(uri, range) {
        Object.assign(this, { uri, range });
      }
    },
    Diagnostic: class {
      constructor(range, message, severity) {
        Object.assign(this, { range, message, severity });
      }
    },
    DiagnosticRelatedInformation: class {
      constructor(location, message) {
        Object.assign(this, { location, message });
      }
    },
    Disposable: class {
      constructor(callOnDispose) {
        this.dispose = callOnDispose || (() => {});
      }
    },
    languages: {
      createDiagnosticCollection: (name) => ({
        name,
        set: (uri, diagnostics) => published.set(uri.toString(), diagnostics),
        delete: (uri) => published.delete(uri.toString()),
        clear: () => published.clear(),
        dispose() {},
      }),
    },
    workspace: {
      textDocuments: documents,
      workspaceFolders: [{ uri: { fsPath: "C:/proj" } }],
      getConfiguration: (section) => ({
        get: (key) => settings[`${section}.${key}`],
        update: async (key, value) => {
          settings[`${section}.${key}`] = value;
        },
      }),
      findFiles: async () => [],
      createFileSystemWatcher: () => ({
        onDidCreate() {},
        onDidDelete() {},
        onDidChange() {},
        dispose() {},
      }),
      asRelativePath: (value) => String(value),
      onDidOpenTextDocument: listen("open"),
      onDidChangeTextDocument: listen("change"),
      onDidSaveTextDocument: listen("save"),
      onDidCloseTextDocument: listen("close"),
      onDidChangeConfiguration: listen("config"),
    },
    window: {
      activeTextEditor: documents[0] ? { document: documents[0] } : undefined,
      onDidChangeActiveTextEditor: listen("editor"),
      showInformationMessage: async () => undefined,
      showQuickPick: showQuickPick || (async () => undefined),
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
  };

  for (const namespace of ["languages", "workspace", "window", "commands", "env", "extensions"]) {
    api[namespace] = proxied(api[namespace] || {}, namespace);
  }

  return {
    vscode: proxied(api, "vscode"),
    published,
    settings,
    fire: (event, argument) => (handlers[event] || []).forEach((fn) => fn(argument)),
  };
}

/** Install `stub` as the `vscode` module for every subsequent require. */
function install(stub) {
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === "vscode") return "vscode";
    return original.call(this, request, ...rest);
  };
  require.cache.vscode = { id: "vscode", filename: "vscode", loaded: true, exports: stub };
}

/** A minimal stand-in for a TextDocument. */
function makeDocument(text, { languageId = "4dgl", file = "C:/proj/test.4dgl" } = {}) {
  return {
    languageId,
    fileName: file,
    uri: { fsPath: file, toString: () => `file://${file}` },
    getText: () => text,
  };
}

// One shared stub for the whole run, installed on first require.
//
// This has to be a singleton. Node caches modules, so the first test file to require
// extension/diagnostics.js fixes the `vscode` binding that module closes over; a
// second stub installed later would be ignored by the already-loaded code, and its
// diagnostic collection would stay mysteriously empty. Tests share this one and call
// `reset` between scenarios instead.
const stub = createStub();
install(stub.vscode);

/** Clear published diagnostics, settings, and the open-document list. */
function reset({ settings = {}, documents = [] } = {}) {
  stub.published.clear();
  for (const key of Object.keys(stub.settings)) delete stub.settings[key];
  Object.assign(stub.settings, settings);
  stub.vscode.workspace.textDocuments.length = 0;
  stub.vscode.workspace.textDocuments.push(...documents);
}

module.exports = { stub, reset, makeDocument, createStub, install };
