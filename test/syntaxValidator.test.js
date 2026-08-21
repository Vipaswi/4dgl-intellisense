/**
 * Cases for extension/syntaxValidator.js.
 *
 * The "clean" half matters more than the "reports" half: this feature's whole design
 * constraint is that it must not flag working code (see CLAUDE.md, "Syntax
 * diagnostics"). Every clean case below is a construct the vendor manuals actually
 * use, and several were false positives before the validator learned about them.
 */

const { suite, ok, codes } = require("./_harness");
const { validate } = require("../extension/syntaxValidator");

function clean(label, source) {
  const problems = validate(source);
  return ok(
    label,
    problems.length === 0,
    problems.map((p) => `${p.line + 1}:${p.character + 1} [${p.code}] ${p.message}`).join("; ")
  );
}

suite("clean: single-line and block forms");
clean("multi-line if", `func main()\n    if (a > b)\n        x := 1;\n    endif\nendfunc`);
clean("single-line if", `func main()\n    if (a > b) x := 1;\nendfunc`);
clean("single-line if-else", `func main()\n    if (a) x := 1; else x := 2;\nendfunc`);
clean("whole if on one line", `func main()\n    if (a) x := 1; endif\nendfunc`);
clean("single-line while", `func main()\n    while (i < val) myVar := myVar * i++;\nendfunc`);
clean("single-line for", `func main()\n    for (n := 5; n < 15; n++) myfunc();\nendfunc`);
clean("for header split over lines", `func main()\n    for (n := 5;\n         n < 15;\n         n++)\n        myfunc();\n    next\nendfunc`);
clean("repeat/until on one line", `func main()\n    repeat i++; until(i >= 5);\nendfunc`);
clean("repeat forever", `func main()\n    repeat forever\nendfunc`);
clean("nested while-wend", `func main()\n    while (a)\n        while (b)\n            f();\n        wend\n    wend\nendfunc`);

suite("clean: language facts the reference doesn't state plainly");
// A whole if/else-if/else chain is closed by ONE endif. See "Example 4DGL Code" in
// the Goldelox manual, which has a four-branch chain with a single endif.
clean("else-if chain, one endif",
  `func main()\n    if (n == 1)\n        a();\n    else if (n == 2)\n        b();\n    else if (n == 3)\n        c();\n    else\n        d();\n    endif\nendfunc`);
clean("else-if chain containing a loop",
  `func main()\n    if (n == 1)\n        while (b)\n            f();\n        wend\n    else if (n == 2)\n        g();\n    else\n        h();\n    endif\nendfunc`);
clean("single-line else-if chain", `func main()\n    if (a) x(); else if (b) y(); else z();\nendfunc`);
// 'default' is a legal goto label: the same Goldelox sample has `goto default;` and a
// bare `default:` outside any switch.
clean("'default' as a goto label", `func main()\n    goto default;\ndefault:\n    x := 1;\nendfunc`);
// #IF/#ELSE may open a construct in one branch and its counterpart in the other.
clean("#IF/#ELSE splitting a block",
  `func main()\n#IF FOO\n    if (a)\n#ELSE\n    if (b)\n#ENDIF\n        x := 1;\n    endif\nendfunc`);
clean("#IF USING wrapping a whole func", `#IF USING tom\nfunc tom() putstr("Tom"); endfunc\n#ENDIF\n#USE tom`);
// `#constant #alias $#REAL` redefines a directive name.
clean("directive aliases", `#constant #ifdef $#IF EXISTS\n#ifdef FOO\n#ENDIF`);
clean("#DATA block", `#DATA\n    word values 0x0123, 0x4567\n    byte hexval "0123456789ABCDEF"\n#END\nfunc main()\n    ch := hexval[0];\nendfunc`);

suite("clean: expressions that look structural but aren't");
clean("ternary colon is not a label", `func main()\n    r := (k > j) ? k : j;\nendfunc`);
clean("format specifier brackets", `func main()\n    print([STR] msg, "it's fine", '4');\nendfunc`);
clean("compound assignment operators", `func main()\n    k += 1; k -= 1; k *= 2; k /= 2; k %= 3; k &= 1; k |= 1; k ^= 1;\nendfunc`);
clean("comparison operators", `func main()\n    if (k == 1 && k != 2 && k <= 3 && k >= 0) x := 1;\nendfunc`);
clean("apostrophes in comment and string", `func main()\n    // don't panic\n    print("it's fine");\nendfunc`);
clean("switch with expression", `func main()\n    switch (n)\n        case 1:\n        case 2:\n            break;\n        default:\n            break;\n    endswitch\nendfunc`);
clean("expressionless switch", `func main()\n    switch\n        case (n < 0)\n            break;\n        default:\n            break;\n    endswitch\nendfunc`);
clean("gosub/endsub", `func f()\n    gosub mysub;\n    return;\n\nmysub:\n    print("hi");\nendsub;\nendfunc`);

suite("reports: block structure");
codes("unclosed func", validate(`func main()\n    x := 1;`), ["unclosed-block"]);
codes("missing wend", validate(`func main()\n    while (a)\n        x := 1;\nendfunc`), ["unclosed-block"]);
codes("while closed by endif", validate(`func main()\n    while (a)\n        x := 1;\n    endif\nendfunc`), ["mismatched-block-end"]);
codes("stray endif", validate(`func main()\n    x := 1;\nendfunc\nendif`), ["unexpected-block-end"]);
codes("next func before endfunc", validate(`func a()\n    x := 1;\nfunc b()\n    y := 2;\nendfunc`), ["unclosed-block"]);
codes("#DATA without #END", validate(`#DATA\n    word v 1, 2\nfunc main()\nendfunc`), ["unclosed-block"]);
codes("#IF without #ENDIF", validate(`#IF FOO\nfunc main()\nendfunc`), ["unclosed-block"]);
codes("duplicate else", validate(`func main()\n    if (a)\n    else\n    else\n    endif\nendfunc`), ["duplicate-else"]);

suite("reports: delimiters and literals");
codes("unclosed paren at statement end", validate(`func main()\n    gfx_Line(1, 2, 3;\nendfunc`), ["unclosed-bracket"]);
codes("unmatched close paren", validate(`func main()\n    gfx_Line(1, 2));\nendfunc`), ["unmatched-bracket"]);
codes("mismatched bracket", validate(`func main()\n    x := arr[1);\nendfunc`), ["mismatched-bracket"]);
codes("braces", validate(`func main()\n    if (a) {\n        x := 1;\n    }\n    endif\nendfunc`), ["unexpected-brace", "unexpected-brace"]);
codes("unterminated string", validate(`func main()\n    print("hello);\nendfunc`), ["unterminated-string"]);
// An unterminated comment swallows the rest of the file, so nothing else is reported.
codes("unterminated comment", validate(`func main()\n    /* never closed\nendfunc`), ["unterminated-comment"]);

suite("reports: keywords, operators, directives");
codes("orphan else", validate(`func main()\n    else\n        x := 1;\nendfunc`), ["orphan-keyword"]);
codes("orphan case", validate(`func main()\n    case 1:\nendfunc`), ["orphan-keyword"]);
codes("break outside a loop", validate(`func main()\n    break;\nendfunc`), ["orphan-keyword"]);
codes("return outside a func", validate(`x := 1;\nreturn;`), ["orphan-keyword"]);
codes("bare equals", validate(`func main()\n    x = 1;\nendfunc`), ["bare-equals"]);
codes("missing if condition", validate(`func main()\n    if a > b\n        x := 1;\n    endif\nendfunc`), ["missing-condition"]);
codes("malformed func", validate(`func\n    x := 1;\nendfunc`), ["malformed-func"]);
codes("unknown directive", validate(`#frobnicate "x"\nfunc main()\nendfunc`), ["unknown-directive"]);

suite("options");
ok("assignmentOperator:false silences the bare-= warning",
  validate(`func main()\n    x = 1;\nendfunc`, { assignmentOperator: false }).length === 0);
ok("unknownDirectives:false silences the directive warning",
  validate(`#frobnicate "x"\nfunc main()\nendfunc`, { unknownDirectives: false }).length === 0);
