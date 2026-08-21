/**
 * Cases for the declaration parsing in extension/documentParser.js.
 *
 * Every symbol missed here costs autocomplete and hover an entry, and can make the
 * name diagnostics question an identifier that really is declared. Two bugs this
 * pins down, both found while building those diagnostics:
 *   - `word a, b;` recorded only `a` (the typed-declaration regex captured a single
 *     declarator per line, while the `var` one already handled a list)
 *   - `var private x;` was missed entirely (the `private` modifier wasn't allowed for)
 */

const { suite, ok, equal } = require("./_harness");
const { parseDocument } = require("../extension/documentParser");

const globals = (source) => parseDocument(source).variables;
const names = (source) => Object.keys(globals(source)).sort().join(",");

suite("comma-separated declarator lists");
equal("var takes a list", names("var a, b, c;"), "a,b,c");
equal("word takes a list", names("word a, b;"), "a,b");
equal("byte takes a list", names("byte p, q, r;"), "p,q,r");
equal("long takes a list", names("long x, y;"), "x,y");
equal("string takes a list", names("string s1, s2;"), "s1,s2");
equal("initialisers don't end the list", names("var x, y := 0, z;"), "x,y,z");

suite("the private modifier");
equal("var private", names("var private hitcounter := 100;"), "hitcounter");
equal("word private with a list", names("word private w1, w2;"), "w1,w2");

suite("types, array sizes and sigils survive");
equal("type is recorded", globals("word myWord;").myWord.type, "word");
equal("var type is recorded", globals("var v;").v.type, "var");
equal("array size", globals("string myStr[20];").myStr.arraySize, 20);
ok("array initialiser doesn't split on its commas",
  names("var arr[3] := [1, 2, 3];") === "arr" && globals("var arr[3] := [1, 2, 3];").arr.arraySize === 3);
ok("pointer sigil is stripped and recorded",
  globals("var *ptr;").ptr && globals("var *ptr;").ptr.pointer === true);
ok("address sigil is stripped and recorded",
  globals("var &addr;").addr && globals("var &addr;").addr.address === true);
ok("sigils on every item of a list",
  globals("word *p1, *p2;").p1.pointer === true && globals("word *p2, *p2;").p2.pointer === true);

suite("function-local declarations get the same treatment");
const parsed = parseDocument(`func main()
    word A, B;
    var private c;
    var d, e;
endfunc`);
equal("all locals recorded", Object.keys(parsed.functions.main.localVars).sort().join(","), "A,B,c,d,e");
equal("and none leak to global scope", Object.keys(parsed.variables).length, 0);

suite("#DATA bodies still contribute their block name");
// `word values 0x0123, 0x4567` is a data block entry, not a declaration list, but the
// leading identifier is the array name and completion wants it.
equal("data block name", names("#DATA\n    word values 0x0123, 0x4567\n#END"), "values");

suite("regressions the old code got right");
equal("single typed declaration", names("word myWord;"), "myWord");
equal("no semicolon, end of line", names("var a, b"), "a,b");
ok("a bare type keyword declares nothing", names("var") === "" && names("word") === "");
