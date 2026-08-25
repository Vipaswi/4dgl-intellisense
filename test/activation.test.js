/**
 * Cases for extension/index.js's activate().
 *
 * `activate` awaits an interactive QuickPick partway through — `ensureLibrarySelected`
 * prompts for the internal-functions library on first run. Anything registered after
 * that await silently never registers while the prompt sits unanswered, with no error
 * anywhere: the feature just appears not to exist. Syntax diagnostics shipped with
 * exactly that bug. The third case below is the regression test for it.
 */

const path = require("path");
const { suite, ok, equal } = require("./_harness");
const { stub, reset, makeDocument } = require("./_vscodeStub");

const BROKEN = `func main()\n    while (a)\n    endif\nendfunc`;
const KEY = "file://C:/proj/test.4dgl";

const document = makeDocument(BROKEN);

const { activate } = require("../extension/index.js");

const context = () => ({
  subscriptions: [],
  extensionPath: path.join(__dirname, ".."),
  globalState: { get: () => undefined, update: async () => {} },
});

/**
 * `quickPick` is what showQuickPick does: "pending" leaves the prompt open forever,
 * "escape" resolves undefined (what pressing Esc does), "pick" chooses the first item.
 */
async function scenario({ library, quickPick }) {
  reset({ documents: [document] });
  if (library) stub.settings["4dgl.library"] = library;

  stub.vscode.window.showQuickPick = async (items) => {
    if (quickPick === "pending") return new Promise(() => {});
    if (quickPick === "escape") return undefined;
    return items[0];
  };

  const outcome = await Promise.race([
    activate(context()).then(() => "resolved", (error) => `threw: ${error.message}`),
    new Promise((resolve) => setTimeout(() => resolve("still pending"), 250)),
  ]);
  return { outcome, published: stub.published.get(KEY) || [] };
}

module.exports = (async () => {
  suite("activate(): library already chosen");
  let result = await scenario({ library: "diablo16", quickPick: "pending" });
  equal("activate completes", result.outcome, "resolved");
  equal("the open document gets diagnostics", result.published.length, 1);

  suite("activate(): first run, prompt dismissed with Escape");
  result = await scenario({ library: null, quickPick: "escape" });
  equal("activate completes", result.outcome, "resolved");
  equal("diagnostics still published", result.published.length, 1);

  suite("activate(): first run, prompt left open");
  result = await scenario({ library: null, quickPick: "pending" });
  equal("activate is blocked on the prompt, as expected", result.outcome, "still pending");
  ok(
    "diagnostics are published anyway (registered before the await)",
    result.published.length === 1,
    result.published.length === 0 ? "none — registerDiagnostics ran too late again" : ""
  );
})();
