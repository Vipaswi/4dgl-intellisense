/**
 * Cases for extension/semanticChecks.js — the name and argument-count checks.
 *
 * The important property under test is restraint. These checks can't know everything
 * that's defined (see the module header), so they only report a name that looks like a
 * misspelling of something known. A name resembling nothing must stay silent, and the
 * "silent" cases below are the ones that keep this usable on real projects.
 */

const { suite, ok, equal, codes } = require("./_harness");
const { check, arityFromSignature, editDistanceWithin, nearestKnownName } = require("../extension/semanticChecks");

const ALL = { unknownFunctions: true, unknownConstants: true, argumentCount: true };

// A small stand-in for the real databases, shaped the same way.
const BUILTIN_FUNCTIONS = {
  gfx_Line: { signature: "gfx_Line(x1, y1, x2, y2, colour)" },
  gfx_Circle: { signature: "gfx_Circle(x, y, radius, colour)" },
  media_Init: { signature: "media_Init()" },
  ABS: { signature: "ABS(value)" },
  print: { signature: "print(...)" },
  lookup16: { signature: "lookup16" }, // extraction lost the parens
  pin_Set: { signature: "pin_Set(function, pin)" },
  file_Close: { signature: "file_Close()" }, // signature the manuals contradict
};
const BUILTIN_CONSTANTS = { BLUE: {}, YELLOW: {}, LANDSCAPE: {}, TEXT_OPACITY: {} };

function run(source, extra = {}, options = ALL) {
  return check(
    source,
    {
      builtinFunctions: BUILTIN_FUNCTIONS,
      builtinConstants: BUILTIN_CONSTANTS,
      userFunctions: {},
      inScopeNames: new Set(),
      allowList: new Set(),
      unverifiedArity: new Set(["file_Close"]),
      ...extra,
    },
    options
  );
}

suite("arity read from a signature");
equal("counts every argument, not table rows", arityFromSignature("gfx_Line(x1, y1, x2, y2, colour)"), 5);
equal("empty list", arityFromSignature("media_Init()"), 0);
equal("one argument", arityFromSignature("ABS(value)"), 1);
equal("variadic is untrusted", arityFromSignature("print(...)"), null);
equal("no parens is untrusted", arityFromSignature("lookup16"), null);
equal("optional brackets are untrusted", arityFromSignature("f([a], b)"), null);
equal("nested parens don't add arguments", arityFromSignature("f(a, g(b, c))"), 2);
equal("missing signature", arityFromSignature(undefined), null);

suite("edit distance");
equal("transposition counts as one", editDistanceWithin("BLEU", "BLUE", 2), 1);
equal("substitution", editDistanceWithin("gfx_Lyne", "gfx_Line", 2), 1);
equal("gives up past the budget", editDistanceWithin("aaaa", "bbbb", 1), 2);
ok("short names get no budget", nearestKnownName("RED", ["RES"]) === null);

suite("argument count");
codes("too few to a built-in", run(`func main()\n    gfx_Line(1, 2, 3);\nendfunc`), ["argument-count"]);
codes("too many to a built-in", run(`func main()\n    ABS(1, 2);\nendfunc`), ["argument-count"]);
codes("correct count is silent", run(`func main()\n    gfx_Line(1, 2, 3, 4, BLUE);\nendfunc`), []);
codes("zero-argument call is silent", run(`func main()\n    media_Init();\nendfunc`), []);
codes("one argument counted, not zero", run(`func main()\n    ABS(5);\nendfunc`), []);
codes("string argument counted", run(`func main()\n    print("hello");\nendfunc`), []);
codes("variadic never checked", run(`func main()\n    print("a", 1, 2, 3);\nendfunc`), []);
codes("unparseable signature never checked", run(`func main()\n    lookup16(k, 1, 2, 3);\nendfunc`), []);
codes("contradicted signature never checked", run(`func main()\n    file_Close(hndl);\nendfunc`), []);
// The '@' operator supplies a whole argument list from one expression.
codes("@ argument pointer never checked", run(`func main()\n    gfx_Line(@ rect+n);\nendfunc`), []);
codes("user function arity is exact", run(
  `func main()\n    helper(1);\nendfunc`,
  { userFunctions: { helper: { parameters: [{ name: "a" }, { name: "b" }] } } }
), ["argument-count"]);
codes("user function called correctly", run(
  `func main()\n    helper(1, 2);\nendfunc`,
  { userFunctions: { helper: { parameters: [{ name: "a" }, { name: "b" }] } } }
), []);

suite("unknown function");
codes("misspelling is reported", run(`func main()\n    gfx_Lyne(1, 2, 3, 4, BLUE);\nendfunc`), ["unknown-function"]);
ok("the report names the suggestion",
  /gfx_Line/.test(run(`func main()\n    gfx_Lyne(1,2,3,4,BLUE);\nendfunc`)[0].message));
ok("wrong case is called out as case sensitivity",
  /case sensitive/.test(run(`func main()\n    Pin_Set(a, b);\nendfunc`)[0].message));
// This is the whole point: an unrecognised name that resembles nothing known may come
// from an #inherit target we can't see, or be a shortcut function the manuals only
// mention in prose (gfx_Clipping, gfx_ScreenMode, txt_FGcolour).
codes("name resembling nothing is silent", run(`func main()\n    gfx_Clipping(ON);\nendfunc`), []);
codes("user-defined function is known", run(
  `func main()\n    helper();\nendfunc`,
  { userFunctions: { helper: { parameters: [] } } }
), []);
codes("a variable can be called as a function pointer", run(
  `func main()\n    funcptr();\nendfunc`,
  { inScopeNames: new Set(["funcptr"]) }
), []);
codes("allow-listed name is silent", run(
  `func main()\n    gfx_Lyne(1, 2, 3, 4, BLUE);\nendfunc`,
  { allowList: new Set(["gfx_Lyne"]) }
), []);
codes("func definition is not a call", run(`func gfx_Lyne()\nendfunc`), []);
// `argcount`/`sizeof` take a name, not a value.
codes("argcount operand is not a call", run(`func main()\n    n := argcount(gfx_Line);\nendfunc`), []);

suite("unknown constant");
codes("misspelled colour", run(`func main()\n    gfx_Line(1, 2, 3, 4, BLEU);\nendfunc`), ["unknown-constant"]);
codes("correct constant is silent", run(`func main()\n    gfx_Line(1, 2, 3, 4, BLUE);\nendfunc`), []);
// Lower/mixed-case names are indistinguishable from variables, so they're never checked.
codes("lower-case name is never reported", run(`func main()\n    x := somethingUnknown;\nendfunc`), []);
codes("ALL_CAPS resembling nothing is silent", run(`func main()\n    x := TOUCH_STATUS;\nendfunc`), []);
codes("in-scope name is known", run(
  `func main()\n    x := MYVALUE;\nendfunc`,
  { inScopeNames: new Set(["MYVALUE"]) }
), []);
codes("#DATA block name is known", run(`#DATA\n    byte HEXVAL "0123"\n#END\nfunc main()\n    x := HEXVAL;\nendfunc`), []);
codes("goto label is known", run(`func main()\n    goto DONE;\nDONE:\n    x := 1;\nendfunc`), []);

suite("options");
codes("argumentCount:false", run(`func main()\n    gfx_Line(1);\nendfunc`, {}, { ...ALL, argumentCount: false }), []);
codes("unknownFunctions:false", run(`func main()\n    gfx_Lyne(1,2,3,4,BLUE);\nendfunc`, {}, { ...ALL, unknownFunctions: false }), []);
codes("unknownConstants:false", run(`func main()\n    gfx_Line(1,2,3,4,BLEU);\nendfunc`, {}, { ...ALL, unknownConstants: false }), []);
