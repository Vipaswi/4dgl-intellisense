/**
 * Publishes the problems found by syntaxValidator.js (structure) and
 * semanticChecks.js (names and argument counts) as VS Code diagnostics: a squiggle in
 * the editor, an entry in the Problems panel, and — since VS Code renders diagnostics
 * in the hover for whatever range they cover — the message on mouse-over, alongside
 * any docs the hover provider already shows.
 *
 * Structural validation is per-document and purely local, so it runs from the moment
 * the extension activates. The name and argument-count checks need the function and
 * constant databases for the active library, which aren't loaded until the user has
 * answered the library prompt — so they switch on later, via `setSymbolSource`. That
 * split is deliberate: registration happens before the prompt is awaited (see the
 * comment in index.js), and nothing here may depend on that await having finished.
 *
 * Edits are debounced. Mid-typing a document is transiently full of unclosed
 * everything, and a short delay keeps squiggles from flickering under the cursor.
 */

const vscode = require("vscode");
const path = require("path");
const { validate } = require("./syntaxValidator");
const { check } = require("./semanticChecks");

const LANGUAGE_ID = "4dgl";
const CONFIG_SECTION = "4dgl.diagnostics";
const DEBOUNCE_MS = 400;

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
};

function readOptions() {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const bool = (key) => config.get(key) !== false;
  return {
    enabled: bool("enabled"),
    unknownDirectives: bool("unknownDirectives"),
    assignmentOperator: bool("assignmentOperator"),
    unknownFunctions: bool("unknownFunctions"),
    unknownConstants: bool("unknownConstants"),
    argumentCount: bool("argumentCount"),
    knownNames: config.get("knownNames") || [],
  };
}

function toRange(problem) {
  return new vscode.Range(problem.line, problem.character, problem.endLine, problem.endCharacter);
}

function toDiagnostic(document, problem) {
  // `DiagnosticSeverity.Error` is 0, so this must not fall back with `||`.
  const severity = problem.severity in SEVERITY ? SEVERITY[problem.severity] : vscode.DiagnosticSeverity.Warning;
  const diagnostic = new vscode.Diagnostic(toRange(problem), problem.message, severity);
  diagnostic.source = "4DGL";
  diagnostic.code = problem.code;

  if (problem.related && problem.related.length > 0) {
    diagnostic.relatedInformation = problem.related.map(
      (related) =>
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(document.uri, toRange(related)),
          related.message
        )
    );
  }

  return diagnostic;
}

/**
 * Every user-defined name that could legitimately be referenced in this document.
 *
 * Deliberately the union across all functions rather than the set visible at each
 * cursor position: a local of one function won't be reported as unknown inside
 * another. That's less precise than `variablesInScope`, and precision in that
 * direction only ever adds false positives, which is not the trade this feature makes.
 */
function collectInScopeNames(symbols) {
  const names = new Set();
  for (const name of Object.keys(symbols.variables || {})) names.add(name);
  for (const name of Object.keys(symbols.constants || {})) names.add(name);
  for (const fn of Object.values(symbols.functions || {})) {
    for (const parameter of fn.parameters || []) names.add(parameter.name);
    for (const local of Object.keys(fn.localVars || {})) names.add(local);
  }
  return names;
}

function registerDiagnostics(context) {
  const collection = vscode.languages.createDiagnosticCollection(LANGUAGE_ID);
  context.subscriptions.push(collection);

  const timers = new Map(); // uri string → debounce timer
  // Populated by setSymbolSource once the active library is known. While it's empty,
  // only the structural checks run.
  const symbolSource = {};

  // Cached per library: this is consulted on every revalidation, which is every
  // debounced keystroke. Loaded lazily so a missing or not-yet-generated data file
  // can't break activation.
  const arityCache = new Map();
  const unverifiedArityFor = (library) => {
    if (!arityCache.has(library)) {
      let names = [];
      try {
        names = require(path.join(context.extensionPath, "data", "4dgl_arity_unverified.json"))[library] || [];
      } catch {
        names = [];
      }
      arityCache.set(library, new Set(names));
    }
    return arityCache.get(library);
  };

  const cancelPending = (document) => {
    const key = document.uri.toString();
    const timer = timers.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.delete(key);
    }
  };

  const refresh = (document) => {
    if (document.languageId !== LANGUAGE_ID) return;
    const options = readOptions();
    if (!options.enabled) {
      collection.delete(document.uri);
      return;
    }

    const text = document.getText();
    const problems = validate(text, options);

    const wantsSemantic = options.unknownFunctions || options.unknownConstants || options.argumentCount;
    if (wantsSemantic && symbolSource.documentManager) {
      try {
        const symbols = symbolSource.documentManager.getSymbolsForDocument(document.uri);
        const library = vscode.workspace.getConfiguration("4dgl").get("library") || "diablo16";
        problems.push(
          ...check(
            text,
            {
              builtinFunctions: symbolSource.functions,
              builtinConstants: symbolSource.constants,
              userFunctions: symbols.functions,
              inScopeNames: collectInScopeNames(symbols),
              allowList: new Set(options.knownNames),
              unverifiedArity: unverifiedArityFor(library),
            },
            options
          )
        );
      } catch {
        // A semantic check failing must never cost the user their structural
        // diagnostics, which are the ones that always work.
      }
    }

    problems.sort((a, b) => a.line - b.line || a.character - b.character);
    collection.set(
      document.uri,
      problems.map((problem) => toDiagnostic(document, problem))
    );
  };

  const refreshSoon = (document) => {
    if (document.languageId !== LANGUAGE_ID) return;
    const key = document.uri.toString();
    cancelPending(document);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        refresh(document);
      }, DEBOUNCE_MS)
    );
  };

  const refreshAllOpen = () => {
    for (const document of vscode.workspace.textDocuments) refresh(document);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((event) => refreshSoon(event.document)),
    // A save is a natural "I'm done typing" checkpoint — validate immediately
    // rather than waiting out the debounce.
    vscode.workspace.onDidSaveTextDocument((document) => {
      cancelPending(document);
      refresh(document);
    }),
    // Deletes unconditionally, without the languageId guard the others have:
    // switching a file's language mode (languageDetection.js does exactly that)
    // fires close-then-open, and on the way *out* of 4dgl the close event already
    // carries the new languageId. Guarding here would leave stale squiggles behind.
    vscode.workspace.onDidCloseTextDocument((document) => {
      cancelPending(document);
      collection.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      // `4dgl.library` matters too: it changes which functions and constants exist,
      // and so which names are unknown.
      if (event.affectsConfiguration(CONFIG_SECTION) || event.affectsConfiguration("4dgl.library")) {
        if (!readOptions().enabled) collection.clear();
        refreshAllOpen();
      }
    }),
    // Timers hold a document reference and a pending publish; make sure neither
    // outlives deactivation.
    new vscode.Disposable(() => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    })
  );

  refreshAllOpen();

  return {
    /**
     * Hand over the databases and document manager once the active library has been
     * resolved, enabling the name and argument-count checks and re-running every
     * open document. The objects are kept by reference on purpose: switching library
     * mutates them in place (see libraryManager.js's replaceContents), so this keeps
     * working across a switch with no re-registration.
     */
    setSymbolSource(source) {
      Object.assign(symbolSource, source);
      refreshAllOpen();
    },
  };
}

module.exports = { registerDiagnostics };
