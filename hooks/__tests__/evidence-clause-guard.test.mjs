// Tests for evidence-clause-guard.js.
//
// This hook exists because an LLM will state a cause, a coverage claim, a
// capability or a destination in exactly the same confident prose whether it
// checked or not. The seam between "I verified this" and "this sounds right"
// is invisible in the output, which is precisely what makes it dangerous: the
// reader cannot audit it, and neither can the model.
//
// So the property under test is a detector's, not a formatter's:
//
//   1. it FIRES on a bare claim - a cause, coverage, capability or destination
//      asserted with no check attached, and
//   2. it stays SILENT when the evidence is in the same sentence, and when the
//      sentence is ordinary prose that merely uses a trigger word.
//
// (2) matters more than (1) here. This guard blocks the agent's turn, so a
// false positive costs a whole round trip. It was deliberately shipped biased
// toward false positives, and these tests are the floor under how far that
// bias is allowed to go.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { scanText } = require("../evidence-clause-guard.js");

const kinds = (t) => scanText(t).map((f) => f.kind);

// ---------------------------------------------------------------------------
// MUST FIRE: a claim with no check attached.
// ---------------------------------------------------------------------------
const BARE_CLAIMS = [
  [
    "CAUSE",
    "Revenue fell by 40% last month because customers moved to the competitor.",
  ],
  [
    "COVERAGE",
    "That whole class of mistake is enforced now, so it cannot happen again.",
  ],
  [
    "CAPABILITY",
    "The deployment tool is unavailable to me, so I could not check the release.",
  ],
];

for (const [kind, text] of BARE_CLAIMS) {
  test(`fires ${kind} on a bare claim`, () => {
    assert.ok(
      kinds(text).includes(kind),
      `expected ${kind}, got [${kinds(text).join(", ")}] for: ${text}`,
    );
  });
}

// ---------------------------------------------------------------------------
// MUST STAY SILENT: the evidence is in the sentence, or there is no claim.
// ---------------------------------------------------------------------------
const CARRIES_EVIDENCE = [
  // A cause claim that names the decomposition rather than only the total.
  "Revenue fell 40%, of which 31 points is the one lapsed account, measured by " +
    "grouping the month's invoices by customer.",
  // A coverage claim that names the command and says it was run.
  "It is enforced by `npm run gate`, which pretest invokes; I ran it and it " +
    "exited 1 on the probe.",
  // A capability claim carrying the actual error rather than the inference.
  "I cannot reach the database: the probe returned `error 28P01 password " +
    "authentication failed`.",
];

for (const text of CARRIES_EVIDENCE) {
  test(`stays silent when the evidence is in the sentence: ${text.slice(0, 46)}...`, () => {
    assert.deepEqual(scanText(text), [], `fired: ${JSON.stringify(kinds(text))}`);
  });
}

const ORDINARY_PROSE = [
  // "because" explaining the agent's own choice is nobody's business here: it
  // is not a claim about a system or a measurement.
  "I used a separate worktree because the main checkout was already dirty.",
  // A destination trigger word with no traversable subject.
  "This approach points to a simpler design overall.",
  // Plain description with no claim in it at all.
  "The repository ships eight review agents and a routing table.",
];

for (const text of ORDINARY_PROSE) {
  test(`stays silent on ordinary prose: ${text.slice(0, 46)}...`, () => {
    assert.deepEqual(scanText(text), [], `fired: ${JSON.stringify(kinds(text))}`);
  });
}

// ---------------------------------------------------------------------------
// Behaviours that were each added after the guard missed something real.
// ---------------------------------------------------------------------------

test("a self-flagged unverified claim is left alone", () => {
  // Saying "I have not checked this" is the behaviour the guard wants. Blocking
  // it would train the agent to stop hedging, which is the opposite outcome.
  const text =
    "I have not verified this, but the drop is probably driven by the lapsed account.";
  assert.deepEqual(scanText(text), []);
});

test("fenced code is not scanned", () => {
  const text = [
    "Here is the check:",
    "```",
    "if (x) throw new Error('this cannot happen because reasons');",
    "```",
  ].join("\n");
  assert.deepEqual(scanText(text), []);
});

test("a table row is judged whole, not cell by cell", () => {
  // Findings get presented in tables more often than in prose. An early version
  // split on the pipe, which handed the detector each half of a claim with the
  // other half missing, so it fired on neither. The claim below spans columns.
  const row = "| Revenue | down 40% | because the competitor undercut us |";
  assert.ok(
    kinds(row).includes("CAUSE"),
    `a spanning table-row claim must still fire; got [${kinds(row).join(", ")}]`,
  );
});

test("a blockquote is not exempt", () => {
  // A blockquote is as likely to be the agent's own emphasis as a quotation,
  // and an exemption clause is where coverage dies.
  const quoted = "> Orders dropped 60% because the checkout was broken all week.";
  assert.ok(kinds(quoted).includes("CAUSE"));
});

test("malformed input does not throw", () => {
  // A Stop hook that throws blocks the turn with no explanation.
  assert.deepEqual(scanText(""), []);
  assert.deepEqual(scanText("short"), []);
});
