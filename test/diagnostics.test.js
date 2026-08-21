/**
 * Cases for extension/diagnostics.js — the VS Code layer.
 *
 * Run against the fake `vscode` in _vscodeStub.js. This is where the severity bug
 * lived: `DiagnosticSeverity.Error` is 0, so a `SEVERITY[x] || Fallback` silently
 * downgraded every error to a warning, which is invisible unless a test actually
 * inspects a published diagnostic's severity.
 */

const { suite, ok, equal } = require("./_harness");
const { stub, reset, makeDocument } = require("./_vscodeStub");
const { registerDiagnostics } = require("../extension/diagnostics");

const KEY = "file://C:/proj/test.4dgl";
const BROKEN = `func main()\n    if (a)\n        x = 1;\nendfunc`;

function fresh(documents = []) {
  reset({ documents });
  return registerDiagnostics({
    subscriptions: [],
    extensionPath: require("path").join(__dirname, ".."),
  });
}

suite("publishing");
const api = fresh();
const document = makeDocument(BROKEN);
stub.fire("open", document);
const first = stub.published.get(KEY) || [];
equal("open publishes both problems", first.length, 2);
ok("an error keeps severity Error (0), not downgraded to Warning",
  first.some((d) => d.severity === 0),
  JSON.stringify(first.map((d) => ({ m: d.message, s: d.severity })))
);
ok("a warning stays a Warning (1)", first.some((d) => d.severity === 1));
ok("source is set", first.every((d) => d.source === "4DGL"));
ok("code is set", first.every((d) => typeof d.code === "string" && d.code.length > 0));

suite("document lifecycle");
stub.published.clear();
stub.fire("open", makeDocument(BROKEN, { languageId: "c", file: "C:/proj/other.c" }));
equal("a non-4dgl document is ignored", stub.published.size, 0);

stub.fire("open", document);
stub.fire("close", document);
ok("close clears the document's diagnostics", !stub.published.has(KEY));

stub.fire("change", { document });
ok("a change does not publish synchronously (debounced)", !stub.published.has(KEY));
stub.fire("save", document);
ok("save bypasses the debounce", stub.published.has(KEY));

suite("related information");
stub.published.clear();
const mismatch = makeDocument(`func main()\n    while (a)\n    endif\nendfunc`, { file: "C:/proj/rel.4dgl" });
stub.fire("open", mismatch);
const related = (stub.published.get("file://C:/proj/rel.4dgl") || [])[0];
ok("a mismatched terminator points back at the opener",
  related && related.relatedInformation && related.relatedInformation.length === 1);

suite("settings");
stub.published.clear();
stub.settings["4dgl.diagnostics.enabled"] = false;
stub.fire("open", document);
equal("enabled:false publishes nothing", stub.published.size, 0);

stub.settings["4dgl.diagnostics.enabled"] = true;
stub.settings["4dgl.diagnostics.assignmentOperator"] = false;
stub.vscode.workspace.textDocuments.push(document);
stub.fire("config", { affectsConfiguration: (section) => section === "4dgl.diagnostics" });
const filtered = stub.published.get(KEY) || [];
equal("assignmentOperator:false drops the bare-= warning", filtered.length, 1);
equal("and what remains is the error", filtered[0].severity, 0);

suite("semantic checks activate only once a symbol source arrives");
stub.published.clear();
delete stub.settings["4dgl.diagnostics.assignmentOperator"];
stub.vscode.workspace.textDocuments.length = 0;

const typo = makeDocument(`func main()\n    gfx_Lyne(1, 2, 3, 4, BLUE);\nendfunc`, { file: "C:/proj/typo.4dgl" });
const TYPO_KEY = "file://C:/proj/typo.4dgl";
const api2 = fresh();
stub.fire("open", typo);
equal("no symbol source yet: structural checks only", (stub.published.get(TYPO_KEY) || []).length, 0);

stub.vscode.workspace.textDocuments.push(typo);
api2.setSymbolSource({
  functions: { gfx_Line: { signature: "gfx_Line(x1, y1, x2, y2, colour)" } },
  constants: { BLUE: {} },
  documentManager: {
    getSymbolsForDocument: () => ({ functions: {}, variables: {}, constants: {} }),
  },
});
const semantic = stub.published.get(TYPO_KEY) || [];
equal("setSymbolSource enables the name checks and re-runs", semantic.length, 1);
ok("and the message suggests the right name", /gfx_Line/.test(semantic[0].message), semantic[0] && semantic[0].message);

suite("a failing semantic check never costs the structural ones");
stub.published.clear();
const api3 = fresh();
stub.vscode.workspace.textDocuments.length = 0;
stub.vscode.workspace.textDocuments.push(document);
api3.setSymbolSource({
  functions: {},
  constants: {},
  documentManager: {
    getSymbolsForDocument() {
      throw new Error("symbol lookup exploded");
    },
  },
});
equal("structural problems still published", (stub.published.get(KEY) || []).length, 2);
