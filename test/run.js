#!/usr/bin/env node
/**
 * Runs every test in this folder. `npm test`.
 *
 * The corpus test needs the vendor manuals in Resources/, which are in the repo, so
 * everything here runs from a clean clone with no install step.
 */

const path = require("path");
const { report } = require("./_harness");

const FILES = [
  "syntaxValidator.test.js",
  "corrections.test.js",
  "documentParser.test.js",
  "semanticChecks.test.js",
  "diagnostics.test.js",
  "activation.test.js",
  "fixture.test.js",
  "include.test.js",
  "vendorCorpus.test.js",
];

(async () => {
  for (const file of FILES) {
    // A test file may export a promise when its cases are asynchronous.
    const result = require(path.join(__dirname, file));
    if (result && typeof result.then === "function") await result;
  }
  process.exit(report() ? 0 : 1);
})();
