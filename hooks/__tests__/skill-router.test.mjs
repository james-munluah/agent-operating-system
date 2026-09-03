// Tests for skill-router.js.
//
// The property under test is NOT "the regexes are the ones I typed" - that is a
// tautology that passes no matter how wrong the router is. It is the two things
// a suggest-mode router can actually get wrong:
//
//   1. it FIRES on the intents it was installed for, and
//   2. it stays SILENT on ordinary working prompts.
//
// (2) is the one that decides whether the router survives. A false fire costs a
// line of injected noise on every unrelated message, and a router that is noisy
// gets switched off, at which point its true-positive rate is irrelevant.
//
// The negative cases are real prompts lifted from a working project's session
// logs, not invented ones, because those are the sentences the router has to
// live beside all day.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { route, render } = require("../skill-router.js");

const skills = (p) => route(p).map((h) => h.skill);

const MUST_FIRE = [
  ["which of these 200 concerns should I do first?", "prioritization-advisor"],
  ["what should I work on next", "prioritization-advisor"],
  ["help me prioritise the backlog", "prioritization-advisor"],
  ["should we build a staff chat system", "problem-framing-canvas"],
  ["what problem is this actually solving", "problem-framing-canvas"],
  ["who are our competitors on the northern route", "competitive-analysis-process"],
  ["another RFQ came in from an airline", "competitive-analysis-process"],
  ["build me a battle card", "battle-card-builder"],
  ["how do we win against the incumbent", "battle-card-builder"],
];

for (const [prompt, want] of MUST_FIRE) {
  test(`fires ${want} on: ${prompt}`, () => {
    assert.ok(
      skills(prompt).includes(want),
      `expected ${want}, got [${skills(prompt).join(", ")}]`,
    );
  });
}

const MUST_STAY_SILENT = [
  "close session",
  "continuing the migration programme",
  "tell me exactly what i need to do",
  "give me status",
  "check this two, and I want this table presented like this",
  "the bill now shows the discount on all four documents",
  "open the ledger in a browser and confirm the order number",
  "apply the migration to production before the merge",
  "why did the cash drawer close at zero again",
  "fix the failing test in tests/auth",
  "/prioritization-advisor 200 concerns, solo dev",
  "/jobs-to-be-done first-time customers",
  "",
  "   ",
];

for (const prompt of MUST_STAY_SILENT) {
  test(`stays silent on: ${JSON.stringify(prompt)}`, () => {
    assert.deepEqual(skills(prompt), [], `fired: [${skills(prompt).join(", ")}]`);
  });
}

test("an explicit slash invocation suppresses the router entirely", () => {
  // The user has already chosen a skill. Suggesting a different one on top is
  // the router second-guessing an explicit instruction, which is the fastest
  // way to make it annoying enough to remove.
  assert.deepEqual(route("/prioritization-advisor what should I work on next"), []);
});

test("at most two suggestions, however many patterns match", () => {
  // Three matches means the patterns have not actually identified the intent,
  // and three suggestions read as noise rather than help.
  const many =
    "what should I work on first, should we build it, who are the competitors, battle card";
  assert.ok(route(many).length <= 2, `got ${route(many).length}`);
});

test("render is empty when nothing matched", () => {
  assert.equal(render(route("close session")), "");
});

test("render names the skill with a leading slash", () => {
  assert.match(render(route("what should I work on next")), /\/prioritization-advisor/);
});

test("render says it is a suggestion, not a requirement", () => {
  // Suggest-not-compel is a deliberate design choice on a cost asymmetry: a
  // false match should cost one line, never a whole turn. If this assertion is
  // ever deleted, that choice has been reversed silently.
  assert.match(render(route("what should I work on next")), /not a\s*\n?\s*requirement/);
});

test("malformed input does not throw", () => {
  // A hook that throws blocks the user's prompt. Failing open is mandatory.
  assert.deepEqual(route(null), []);
  assert.deepEqual(route(undefined), []);
  assert.deepEqual(route(42), []);
  assert.deepEqual(route({}), []);
});
