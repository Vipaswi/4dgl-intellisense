/**
 * The smallest thing that counts as a test runner: a describe/it pair that records
 * failures and a `main` that reports them. No dependencies, because this repo has no
 * node_modules and adding one for the test suite would mean adding a build step.
 */

let currentSuite = "";
const failures = [];
let checks = 0;

function suite(name) {
  currentSuite = name;
  console.log(`\n── ${name}`);
}

function ok(label, condition, detail) {
  checks++;
  if (condition) {
    console.log(`   ok   ${label}`);
    return true;
  }
  failures.push(`${currentSuite}: ${label}${detail ? "\n        " + detail : ""}`);
  console.log(`   FAIL ${label}${detail ? "  — " + detail : ""}`);
  return false;
}

function equal(label, actual, expected) {
  return ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Assert the exact set of problem codes, order-independent. */
function codes(label, problems, expected) {
  const actual = problems.map((p) => p.code).sort();
  const want = [...expected].sort();
  return ok(
    label,
    actual.length === want.length && actual.every((c, i) => c === want[i]),
    `expected [${want}], got [${actual}]${problems.length ? "\n        " + problems.map((p) => `${p.line + 1}:${p.character + 1} ${p.message}`).join("\n        ") : ""}`
  );
}

function report() {
  console.log(`\n${checks} checks, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  - ${failure}`);
  }
  return failures.length === 0;
}

module.exports = { suite, ok, equal, codes, report };
