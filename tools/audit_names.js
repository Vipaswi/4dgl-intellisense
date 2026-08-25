/**
 * Reports database keys that look wrong, with evidence, so data/4dgl_name_corrections.json
 * can be curated from facts rather than guesses.
 *
 * Three classes, in decreasing certainty:
 *
 *  1. KEY NOT AN IDENTIFIER — `img_ FileSize` (a space in the middle),
 *     `com_Mode(Databits, parity, ...)` (the whole signature used as the name),
 *     `16-bit Registers Memory Map` (a non-function heading). These can never be
 *     called, so the key is definitely wrong.
 *
 *  2. CASE-ONLY DISAGREEMENT between the key (taken from the section heading) and the
 *     name in the entry's own Syntax line. One of the two is a documentation slip, and
 *     the manuals' example code decides which: 4DGL is case sensitive, so the spelling
 *     the vendor actually compiles is the real one. Note this is NOT the same as the
 *     deliberate multi-variant aliasing (`I2C2_Ack` documented under `I2C1_Ack`) —
 *     those differ by more than case and are filtered out here.
 *
 *  3. FAMILY OUTLIER — a constant one edit away from the shared prefix of an otherwise
 *     regular family, e.g. `SPI_SPEER5` sitting between `SPI_SPEED4` and `SPI_SPEED6`.
 *     A typo in the vendor's table; nothing can extract it correctly.
 *
 * Usage:  node tools/audit_names.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { tokenize } = require(path.join(ROOT, "extension", "syntaxValidator.js"));

const LIBRARIES = ["diablo16", "goldelox", "picaso", "pixxi"];
const IS_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function codeBlocks(html) {
  const blocks = [];
  const re = /<code\b[^>]*>([\s\S]*?)<\/code>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    blocks.push(
      match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
    );
  }
  return blocks;
}

/** How often each identifier appears in the example code of one manual. */
function usageCounts(file) {
  const counts = new Map();
  const html = fs.readFileSync(path.join(ROOT, "Resources", file), "utf8");
  for (const block of codeBlocks(html)) {
    for (const token of tokenize(block).tokens) {
      if (token.type !== "word") continue;
      counts.set(token.text, (counts.get(token.text) || 0) + 1);
    }
  }
  return counts;
}

function signatureName(entry) {
  const match = /^\s*([A-Za-z_]\w*)\s*\(/.exec(entry.signature || "");
  return match ? match[1] : null;
}

/** Longest common prefix of a list of strings. */
function commonPrefix(values) {
  if (values.length === 0) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

for (const library of LIBRARIES) {
  const file = `${library}_internal_functions.txt`;
  const functions = JSON.parse(fs.readFileSync(path.join(ROOT, "data", `4dgl_functions_${library}.json`), "utf8"));
  const constants = JSON.parse(fs.readFileSync(path.join(ROOT, "data", `4dgl_constants_${library}.json`), "utf8"));
  const used = usageCounts(file);

  console.log(`\n════════ ${library} ════════`);

  console.log("\n-- keys that aren't identifiers");
  for (const [collection, table] of [["function", functions], ["constant", constants]]) {
    for (const key of Object.keys(table)) {
      if (IS_IDENTIFIER.test(key)) continue;
      const suggestion = collection === "function" ? signatureName(table[key]) : null;
      console.log(`   ${collection} ${JSON.stringify(key)}${suggestion ? ` -> signature says ${suggestion}` : " -> no usable name"}`);
    }
  }

  console.log("\n-- key vs signature name, differing only by case");
  for (const [key, entry] of Object.entries(functions)) {
    const fromSignature = signatureName(entry);
    if (!fromSignature || fromSignature === key) continue;
    if (fromSignature.toLowerCase() !== key.toLowerCase()) continue; // real alias, not a slip
    const keyUses = used.get(key) || 0;
    const signatureUses = used.get(fromSignature) || 0;
    const winner =
      keyUses === signatureUses ? "TIE — leave alone" : keyUses > signatureUses ? key : fromSignature;
    console.log(
      `   key=${key} (${keyUses} uses in examples)  signature=${fromSignature} (${signatureUses} uses)  -> ${winner}`
    );
  }

  console.log("\n-- constant family outliers");
  // Group by the alphabetic prefix before a trailing number, then look for a member
  // whose prefix disagrees with the group's.
  const families = new Map();
  for (const key of Object.keys(constants)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*?)(\d+)$/.exec(key);
    if (!match) continue;
    if (!families.has(match[1])) families.set(match[1], []);
    families.get(match[1]).push(key);
  }
  const prefixes = [...families.keys()];
  for (const [prefix, members] of families) {
    if (members.length > 1) continue; // a family of its own is not an outlier
    for (const other of prefixes) {
      if (other === prefix || families.get(other).length < 3) continue;
      if (Math.abs(other.length - prefix.length) > 0) continue;
      let differences = 0;
      for (let i = 0; i < prefix.length; i++) if (prefix[i] !== other[i]) differences++;
      if (differences !== 1) continue;
      const suspect = members[0];
      const corrected = other + suspect.slice(prefix.length);
      console.log(
        `   ${suspect} looks like a typo of ${corrected} (family ${other}* has ${families.get(other).length} members, ` +
          `${used.get(suspect) || 0} uses of the suspect in examples)`
      );
    }
  }
}
