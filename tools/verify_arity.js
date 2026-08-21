/**
 * Regenerates data/4dgl_arity_unverified.json — the built-in functions whose
 * documented argument count must NOT be trusted for diagnostics.
 *
 * Why this exists
 * ---------------
 * semanticChecks.js reads a built-in's arity from its `signature` string, which is
 * the only faithful record in the database (the `parameters` array groups arguments,
 * so `gfx_Line(x1, y1, x2, y2, colour)` arrives with three entries for five
 * arguments). But a signature is only as good as the manual section it came from, and
 * a meaningful minority are wrong or incomplete:
 *
 *   - variadic functions written as if fixed — `lookup8(key, string)` is really
 *     `lookup8(key, a, b, c, ...)`, and the manual's own example passes six
 *   - arguments missing from the Syntax line — `file_Close()` is documented with no
 *     handle, yet every example calls `file_Close(hndl)`
 *   - functions with a second, lvalue form — `pokeW(addr) := value` alongside
 *     `pokeW(addr, value)`
 *   - genuinely different arity between libraries, with examples cross-contaminated
 *     between manuals
 *
 * Reporting those as user errors is exactly the false-positive problem the whole
 * diagnostics design is built to avoid. So: a function's arity is only trusted when
 * the manual's own example code agrees with its signature. Where the vendor's
 * examples contradict it, the function is listed here and its calls are never
 * arity-checked. Names the examples never call at all stay trusted — there's no
 * evidence against them, and the signature is all we have.
 *
 * This deliberately measures agreement rather than trying to *fix* the signatures.
 * Rewriting them would mean guessing which of the two sources is right, and the
 * generated databases are not hand-edited (see CLAUDE.md).
 *
 * Usage:  node tools/verify_arity.js [--report]
 *         --report  print the disagreements instead of only counting them
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { tokenize } = require(path.join(ROOT, "extension", "syntaxValidator.js"));
const { findCalls, arityFromSignature } = require(path.join(ROOT, "extension", "semanticChecks.js"));
const { loadFunctionDatabase } = require(path.join(ROOT, "extension", "docDatabase.js"));

const LIBRARIES = ["diablo16", "goldelox", "picaso", "pixxi"];
// directives_and_syntax.txt is shared: its examples are language-level and may call
// into any library, so they're checked against every one.
const SHARED_SOURCE = "directives_and_syntax.txt";

/**
 * Pull the text of every <code> block out of a mkdocs HTML export.
 *
 * Deliberately regex-based rather than using an HTML parser: it keeps this script
 * dependency-free (the Python extractors need beautifulsoup4; this needs nothing),
 * and the mkdocs output is regular enough that it matches the parser's block count.
 */
function codeBlocks(html) {
  const blocks = [];
  const re = /<code\b[^>]*>([\s\S]*?)<\/code>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    blocks.push(unescapeHtml(match[1].replace(/<[^>]+>/g, "")));
  }
  return blocks;
}

function unescapeHtml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Names a code block defines itself — those shadow the built-in of the same name. */
function locallyDefined(text) {
  const names = new Set();
  let match;
  const re = /^[ \t]*func[ \t]+([A-Za-z_]\w*)/gim;
  while ((match = re.exec(text)) !== null) names.add(match[1]);
  return names;
}

function main() {
  const report = process.argv.includes("--report");

  const signatures = {}; // library -> name -> arity|null
  for (const library of LIBRARIES) {
    // Through docDatabase.js so the keys match what the extension actually looks up
    // (data/4dgl_name_corrections.json renames a few of them).
    const db = loadFunctionDatabase({ extensionPath: ROOT }, library);
    signatures[library] = {};
    for (const [name, entry] of Object.entries(db)) {
      signatures[library][name] = arityFromSignature(entry.signature);
    }
  }

  // library -> name -> Set of argument counts seen in vendor example code
  const observed = {};
  for (const library of LIBRARIES) observed[library] = new Map();

  let blockCount = 0;
  for (const file of fs.readdirSync(path.join(ROOT, "Resources"))) {
    if (!file.endsWith(".txt")) continue;
    const targets =
      file === SHARED_SOURCE ? LIBRARIES : LIBRARIES.filter((l) => file.includes(l));
    if (targets.length === 0) continue;

    const html = fs.readFileSync(path.join(ROOT, "Resources", file), "utf8");
    for (const block of codeBlocks(html)) {
      blockCount++;
      const local = locallyDefined(block);
      const blockLines = block.split("\n");
      const { tokens } = tokenize(block);
      for (const call of findCalls(tokens)) {
        if (call.isDefinition || call.isPseudo) continue;
        if (call.argumentCount === null) continue; // '@' pointer or unbalanced
        if (local.has(call.name)) continue;

        // A bare `name()` written about a function that takes arguments is usually
        // prose referring to it — a Revision History row, or "use gfx_MoveTo() to set
        // the origin" — not a call passing none, and counting it as evidence would
        // wrongly retire that function's arity. Requiring a `;` or `:=` on the line
        // keeps real zero-argument calls (`val := disp_ReadWord();`) as evidence.
        const line = blockLines[call.token.line] || "";
        const looksLikeCode = line.includes(";") || line.includes(":=");

        for (const library of targets) {
          if (!(call.name in signatures[library])) continue;
          if (call.argumentCount === 0 && signatures[library][call.name] > 0 && !looksLikeCode) continue;
          if (!observed[library].has(call.name)) observed[library].set(call.name, new Set());
          observed[library].get(call.name).add(call.argumentCount);
        }
      }
    }
  }

  const output = {};
  let totalExcluded = 0;
  for (const library of LIBRARIES) {
    const unverified = [];
    for (const [name, counts] of observed[library]) {
      const declared = signatures[library][name];
      if (declared === null) continue; // already untrusted (variadic / no parens)
      if (!counts.has(declared) || counts.size > 1) unverified.push(name);
    }
    unverified.sort();
    output[library] = unverified;
    totalExcluded += unverified.length;

    const called = observed[library].size;
    const total = Object.keys(signatures[library]).length;
    console.log(
      `${library.padEnd(10)} ${total} functions, ${called} called in examples, ` +
        `${unverified.length} contradicted -> arity not checked`
    );
    if (report) {
      for (const name of unverified) {
        const counts = [...observed[library].get(name)].sort((a, b) => a - b);
        console.log(`    ${name}: signature says ${signatures[library][name]}, examples call with ${counts.join("/")}`);
      }
    }
  }

  const destination = path.join(ROOT, "data", "4dgl_arity_unverified.json");
  fs.writeFileSync(destination, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\n${blockCount} code blocks scanned; ${totalExcluded} exclusions -> ${path.relative(ROOT, destination)}`);
}

main();
