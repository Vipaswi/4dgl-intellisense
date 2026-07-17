const vscode = require("vscode");

function createSignatureProvider(functions, documentManager) {
  return vscode.languages.registerSignatureHelpProvider(
    "4dgl",
    {
      provideSignatureHelp(document, position) {
        const call = findCurrentCall(document, position);
        if (!call) return undefined;

        // User-defined functions take priority over built-ins
        const userSymbols = documentManager.getSymbolsForDocument(document.uri);
        const userFn = userSymbols.functions[call.name];
        const builtinFn = functions[call.name];
        const fn = userFn || builtinFn;
        if (!fn) return undefined;

        const signature = new vscode.SignatureInformation(fn.signature, fn.description || undefined);
        signature.parameters = (fn.parameters || []).map(
          (param) => new vscode.ParameterInformation(param.name, param.description || undefined)
        );

        const help = new vscode.SignatureHelp();
        help.signatures = [signature];
        help.activeSignature = 0;
        help.activeParameter = resolveActiveParameterIndex(fn.parameters || [], call.activeParameter);
        return help;
      },
    },
    "(",
    ","
  );
}

// Some documented parameters cover more than one positional argument (e.g.
// gfx_Surround's "x1, y1" is one param entry for two comma-separated args), so
// a raw comma count can't be used directly as an index into fn.parameters.
function resolveActiveParameterIndex(parameters, rawArgPosition) {
  let covered = 0;
  for (let i = 0; i < parameters.length; i++) {
    const arity = (parameters[i].name.match(/,/g) || []).length + 1;
    covered += arity;
    if (rawArgPosition < covered) return i;
  }
  return Math.max(parameters.length - 1, 0);
}

function findCurrentCall(document, position) {
  const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
  let depth = 0;

  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === ")") {
      depth += 1;
      continue;
    }
    if (char !== "(") continue;
    if (depth > 0) {
      depth -= 1;
      continue;
    }

    const before = text.slice(0, index).match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (!before) return undefined;

    const argsText = text.slice(index + 1);
    return {
      name: before[1],
      activeParameter: countTopLevelCommas(argsText),
    };
  }

  return undefined;
}

function countTopLevelCommas(text) {
  let count = 0;
  let depth = 0;
  let quote = "";

  for (const char of text) {
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") { depth++; continue; }
    if (char === ")" && depth > 0) { depth--; continue; }
    if (char === "," && depth === 0) count++;
  }

  return count;
}

module.exports = {
  createSignatureProvider,
};
