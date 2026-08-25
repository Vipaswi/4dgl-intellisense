/**
 * Cases for data/4dgl_name_corrections.json and the load-time layer in
 * docDatabase.js that applies it.
 *
 * A wrong suggestion is worse than no suggestion: "did you mean 'mem_free'?" tells you
 * to introduce a bug. Each case here is a name the databases got wrong, reported from
 * real use against the diablo16 library, plus the invariants that keep the corrections
 * layer from doing damage of its own.
 */

const path = require("path");
const { suite, ok, equal } = require("./_harness");
const { loadFunctionDatabase, loadConstantDatabase } = require("../extension/docDatabase");

const context = { extensionPath: path.join(__dirname, "..") };
const LIBRARIES = ["diablo16", "goldelox", "picaso", "pixxi"];
const functions = {};
const constants = {};
for (const library of LIBRARIES) {
  functions[library] = loadFunctionDatabase(context, library);
  constants[library] = loadConstantDatabase(context, library);
}

const IS_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

suite("reported wrong names are corrected");
// Heading is lower-case, Syntax line and 10 example uses say mem_Free.
ok("mem_Free is the function name", "mem_Free" in functions.diablo16);
ok("mem_free is gone", !("mem_free" in functions.diablo16));
ok("mem_Alloc is the function name", "mem_Alloc" in functions.diablo16);
ok("mem_alloc is gone", !("mem_alloc" in functions.diablo16));
// A typo in the vendor's own SPI speed table, between SPI_SPEED4 and SPI_SPEED6.
ok("SPI_SPEED5 exists", "SPI_SPEED5" in constants.diablo16);
ok("SPI_SPEER5 is gone", !("SPI_SPEER5" in constants.diablo16));
equal("and it kept its documented value",
  constants.diablo16.SPI_SPEED5.description, "729.166 khz");
// TRANSPARENT now comes from extraction for diablo16 (its gfx_FillPattern argument
// table spells out "TRANSPARENT or OPAQUE") and from the corrections `add` fallback
// for the other three, whose manuals only use it in example code. TRANSPARENCY is a
// different, correctly-extracted gfx_Set selector and must survive alongside it.
ok("TRANSPARENT exists", "TRANSPARENT" in constants.diablo16);
ok("OPAQUE exists", "OPAQUE" in constants.diablo16);
ok("TRANSPARENCY is still there too — it is a different constant",
  "TRANSPARENCY" in constants.diablo16);
ok("TRANSPARENT came from the manual, not the fallback, for diablo16",
  (constants.diablo16.TRANSPARENT.source || {}).confidence === "documented",
  JSON.stringify(constants.diablo16.TRANSPARENT));

suite("corrections apply to every library that has the key");
ok("picaso also gets mem_Free", "mem_Free" in functions.picaso && !("mem_free" in functions.picaso));
ok("pixxi also gets mem_Free", "mem_Free" in functions.pixxi);
ok("goldelox has no mem_Free entry to rename, and none is invented",
  !("mem_Free" in functions.goldelox) && !("mem_free" in functions.goldelox));
ok("TRANSPARENT ends up present for all four", LIBRARIES.every((l) => "TRANSPARENT" in constants[l]));
ok("HEX2ZB present for all four despite the Goldelox table duplicating HEX1ZB",
  LIBRARIES.every((l) => "HEX2ZB" in constants[l]));

suite("keys that could never be called are gone");
for (const library of LIBRARIES) {
  const bad = Object.keys(functions[library]).filter((k) => !IS_IDENTIFIER.test(k));
  ok(`${library} has no non-identifier function key`, bad.length === 0, JSON.stringify(bad));
}
ok("img_FileSize replaced the spaced key",
  "img_FileSize" in functions.diablo16 && !("img_ FileSize" in functions.diablo16));
ok("gfx_Dot replaced the parenthesised key",
  "gfx_Dot" in functions.goldelox && !("gfx_Dot()" in functions.goldelox));
ok("com_Mode replaced the whole-signature key", "com_Mode" in functions.pixxi);
ok("Goldelox document headings are dropped",
  !("Display Modules" in functions.goldelox) && !("Programming Tools" in functions.goldelox));

suite("ambiguous spellings resolve both ways rather than one being flagged");
// Heading and Syntax line disagree and the example code uses each exactly once, so
// there is no evidence for a winner. Both are accepted; neither is a "did you mean".
ok("sys_GetDate and sys_Getdate both resolve",
  "sys_GetDate" in functions.diablo16 && "sys_Getdate" in functions.diablo16);
ok("sys_PmmC and sys_Pmmc both resolve",
  "sys_PmmC" in functions.diablo16 && "sys_Pmmc" in functions.diablo16);
ok("pin_HI and pin_Hi both resolve",
  "pin_HI" in functions.goldelox && "pin_Hi" in functions.goldelox);
ok("an alias shares the original's docs",
  functions.diablo16.sys_Getdate === functions.diablo16.sys_GetDate);

suite("ambiguous colour spellings resolve both ways");
// colors.pdf spells these one way; every manual's example code the other.
ok("DARKGRAY and DARKGREY both resolve",
  "DARKGRAY" in constants.diablo16 && "DARKGREY" in constants.diablo16);
ok("DARKKHAKI and DARKKHARKI both resolve",
  "DARKKHAKI" in constants.diablo16 && "DARKKHARKI" in constants.diablo16);

suite("the layer is non-destructive");
ok("renaming never clobbers an existing entry: toupper survives alongside tolower",
  "toupper" in functions.diablo16 && "tolower" in functions.diablo16);
ok("colour constants still merge in", "BLUE" in constants.diablo16 && "DARKGREY" in constants.diablo16);
ok("the COLOUR aggregate entry survives", "COLOUR" in constants.diablo16 || "COLOR" in constants.diablo16);
ok("function count is still in the right ballpark",
  Object.keys(functions.diablo16).length > 500, String(Object.keys(functions.diablo16).length));
