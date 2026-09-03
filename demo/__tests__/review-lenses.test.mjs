// Tests for the review-lens runner, up to the network boundary.
//
// WHAT THIS DOES NOT COVER, stated first because a test file that is silent
// about its own edge reads as full coverage: `runLens` makes a real API call
// and is NOT exercised here. Nothing in this repository proves the live request
// works; that is a human step, recorded in README.md.
//
// What IS covered is everything that decides WHAT gets sent - argument parsing,
// lens validation, criteria extraction from the shared file, and prompt
// assembly. That matters more than it looks: the most likely way this tool goes
// wrong is not an API error, it is silently reviewing a diff against the wrong
// criteria, or against an empty string, and reporting APPROVE.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  parseArgs,
  criteriaFor,
  promptFor,
  LENSES,
  LensReport,
  MODEL,
} = await import("../review-lenses.mjs");

test("defaults to a single lens, not all of them", () => {
  // Running eight lenses on every diff produces eight opinions of which six are
  // noise, and a noisy gate gets ignored. The default is deliberately narrow.
  const opts = parseArgs([]);
  assert.deepEqual(opts.lenses, ["cto"]);
  assert.equal(opts.dryRun, false);
});

test("--all selects every known lens", () => {
  assert.deepEqual(parseArgs(["--all"]).lenses.sort(), Object.keys(LENSES).sort());
});

test("--lens accepts a comma list", () => {
  assert.deepEqual(parseArgs(["--lens", "cto,dpo"]).lenses, ["cto", "dpo"]);
});

test("an unknown lens fails loudly instead of being skipped", () => {
  // Silently dropping an unrecognised lens would mean asking for a security
  // review and getting a clean result because the lens never ran.
  assert.throws(() => parseArgs(["--lens", "cto,securty"]), /unknown lens: securty/);
});

test("--staged and --dry-run are picked up", () => {
  const opts = parseArgs(["--staged", "--dry-run"]);
  assert.equal(opts.source, "staged");
  assert.equal(opts.dryRun, true);
});

test("every advertised lens has a section in the shared criteria file", () => {
  // The agent definitions and this runner read ONE criteria file precisely so
  // they cannot drift. This asserts the join actually holds: a lens offered on
  // the command line with no section behind it would send a prompt whose
  // criteria block is missing, and the model would review against nothing.
  for (const lens of Object.keys(LENSES)) {
    const text = criteriaFor(lens);
    assert.ok(
      text.length > 200,
      `${lens} resolved to ${text.length} chars of criteria, which is too thin to be real`,
    );
    assert.match(text, new RegExp(`^## ${lens.toUpperCase()}\\b`, "im"));
  }
});

test("criteria extraction stops at the next lens", () => {
  // An off-by-one here would hand every lens the whole file, which would look
  // like it worked while quietly destroying the separation the lenses exist for.
  const cto = criteriaFor("cto");
  const headings = cto.match(/^## /gm) || [];
  assert.equal(headings.length, 1, `expected one heading, got ${headings.length}`);
});

test("a lens with no section throws rather than sending an empty prompt", () => {
  assert.throws(() => criteriaFor("nonexistent"), /no "## NONEXISTENT" section/);
});

test("the prompt carries the diff, the criteria and both output rules", () => {
  // The fixture below is inert TEXT standing in for a diff, never executed:
  // it names eval() precisely because that is the sort of line a review lens
  // exists to catch, so it makes a realistic payload.
  const diff = "diff --git a/x.ts b/x.ts\n+const unsafe = eval(input);";
  const p = promptFor("cto", diff);

  assert.ok(p.includes(diff), "the diff must reach the model");
  assert.match(p, /## CTO/, "the criteria must reach the model");
  assert.match(p, /carries its evidence/i, "the evidence rule must be in the prompt");
  assert.match(p, /could NOT assess/i, "the blind-spot rule must be in the prompt");
  assert.match(p, /report only, never fix/i);
});

test("the schema requires evidence and a failure scenario on every finding", () => {
  // These two fields are the difference between a finding and an opinion. If
  // they ever become optional, the tool starts producing "this looks risky".
  const missingEvidence = {
    verdict: "CHANGES-NEEDED",
    not_reviewed: "",
    findings: [
      { file: "a.ts", line: 1, severity: "blocking", claim: "it is broken" },
    ],
  };
  assert.equal(LensReport.safeParse(missingEvidence).success, false);

  const complete = {
    verdict: "CHANGES-NEEDED",
    not_reviewed: "runtime behaviour",
    findings: [
      {
        file: "a.ts",
        line: 1,
        severity: "blocking",
        claim: "user input reaches eval",
        evidence: "line 1 of the diff passes `input` straight to eval()",
        failure_scenario: "any request whose body contains a JS expression",
      },
    ],
  };
  assert.equal(LensReport.safeParse(complete).success, true);
});

test("verdict is a closed set", () => {
  const bad = { verdict: "LGTM", findings: [], not_reviewed: "" };
  assert.equal(LensReport.safeParse(bad).success, false);
});

test("the default model is an Opus-tier id, not a downgrade", () => {
  // A review that misses a real defect costs far more than the tokens saved by
  // a smaller model, and this runs once per change rather than per request.
  assert.match(MODEL, /^claude-(opus|fable)-/, `default model was ${MODEL}`);
});
