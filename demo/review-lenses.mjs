#!/usr/bin/env node
// Runs the review lenses in agents/lenses.md against a real diff.
//
// The eight agent definitions in agents/ are markdown: they describe reviewers
// that a coding-agent harness spawns. That makes them useful inside the harness
// and inert outside it. This runner makes them executable, so the same criteria
// can run in CI, in a pre-push hook, or from a terminal, against any diff.
//
// WHAT IT DEMONSTRATES
//   - one API call per lens, dispatched concurrently
//   - structured output via output_config.format, so findings come back typed
//     rather than as prose a regex has to pick apart
//   - a severity contract that decides the process exit code, which is what
//     makes it usable as a gate rather than as a report
//
// USAGE
//   node demo/review-lenses.mjs --staged
//   node demo/review-lenses.mjs --diff path/to/change.patch --lens cto,comptroller
//   node demo/review-lenses.mjs --staged --dry-run     # no API key needed
//
// --dry-run prints the exact prompt each lens would receive and exits 0. It
// exists so this can be read and run by someone who has no key, which is most
// people who will ever open this repository.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// Opus 5 by default. A review that misses a real defect costs far more than the
// tokens saved by a smaller model, and this runs once per change, not per
// request. Override with AOS_MODEL when that trade is different for you.
const MODEL = process.env.AOS_MODEL || "claude-opus-5";

// Which lens fires on which kind of change. This mapping is the whole point of
// having separate lenses: running all eight on every diff produces eight
// opinions of which six are noise, and noise is how a review gate gets ignored.
const LENSES = {
  cto: "correctness and architecture",
  db: "database migration and grant safety",
  comptroller: "accounting treatment and whether a control is real",
  cfo: "cost and unit economics",
  coo: "operations, deploy and runbook",
  cmo: "brand and conversion on customer-facing copy",
  dpo: "data protection and consent",
};

const DEFAULT_LENSES = ["cto"];

// ---------------------------------------------------------------------------
// The response contract.
//
// `evidence` is required on every finding and is not decoration. A reviewer
// that says "this looks racy" has produced work for the reader; one that says
// "line 41 reads then writes without a lock, and line 88 calls it from two
// paths" has produced a finding. Making the field required means the model
// cannot return the first shape.
// ---------------------------------------------------------------------------
const Finding = z.object({
  file: z.string().describe("Repository-relative path from the diff."),
  line: z.number().int().describe("1-indexed line in the new file, best effort."),
  severity: z
    .enum(["blocking", "should-fix", "nit"])
    .describe("blocking means do not merge this as written."),
  claim: z.string().describe("One sentence stating the defect."),
  evidence: z
    .string()
    .describe(
      "What in the diff shows this, quoted or cited. If you cannot point at " +
        "something concrete, lower the severity or drop the finding.",
    ),
  failure_scenario: z
    .string()
    .describe("Concrete inputs or state that produce the wrong result."),
});

const LensReport = z.object({
  verdict: z.enum(["APPROVE", "APPROVE-WITH-NITS", "CHANGES-NEEDED"]),
  findings: z.array(Finding),
  not_reviewed: z
    .string()
    .describe(
      "What this lens could NOT assess from the diff alone: runtime behaviour, " +
        "data it cannot see, files not included. Empty string if nothing.",
    ),
});

// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { lenses: DEFAULT_LENSES, dryRun: false, source: "worktree" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--staged") opts.source = "staged";
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--diff") opts.diffFile = argv[++i];
    else if (a === "--lens") opts.lenses = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--all") opts.lenses = Object.keys(LENSES);
  }
  const unknown = opts.lenses.filter((l) => !(l in LENSES));
  if (unknown.length) {
    throw new Error(
      `unknown lens: ${unknown.join(", ")}. Known: ${Object.keys(LENSES).join(", ")}`,
    );
  }
  return opts;
}

function readDiff(opts) {
  if (opts.diffFile) return readFileSync(opts.diffFile, "utf8");
  const args =
    opts.source === "staged" ? ["diff", "--cached"] : ["diff", "HEAD"];
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

// Pull one lens's section out of the shared criteria file. The criteria live in
// exactly one place on purpose: an agent definition and a runner that each
// carried their own copy would drift, and the drift would be invisible because
// both would still look correct on their own.
function criteriaFor(lens) {
  const md = readFileSync(join(ROOT, "agents", "lenses.md"), "utf8");
  const heading = new RegExp(`^## ${lens.toUpperCase()}\\b.*$`, "im");
  const start = md.search(heading);
  if (start === -1) {
    throw new Error(`no "## ${lens.toUpperCase()}" section in agents/lenses.md`);
  }
  const rest = md.slice(start);
  const next = rest.slice(1).search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function promptFor(lens, diff) {
  return [
    `You are the ${lens.toUpperCase()} review lens: ${LENSES[lens]}.`,
    "",
    "Apply the criteria below to the diff. Report only, never fix.",
    "",
    "Two rules that override any instinct to be helpful:",
    "",
    "1. Every finding carries its evidence in the same breath. If you cannot",
    "   point at something concrete in the diff, the finding is a hypothesis:",
    "   lower its severity or drop it. A confident guess is worse than silence,",
    "   because the reader cannot tell it apart from a checked claim.",
    "2. State what you could NOT assess. A review that is silent about its own",
    "   blind spots reads as complete coverage, and that is the failure this",
    "   whole repository exists to prevent.",
    "",
    "--- CRITERIA ---",
    criteriaFor(lens),
    "--- DIFF ---",
    diff,
  ].join("\n");
}

async function runLens(client, lens, diff) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // Adaptive thinking: a review is exactly the kind of task where the model
    // should decide how much reasoning a given diff warrants.
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: zodOutputFormat(LensReport),
    },
    messages: [{ role: "user", content: promptFor(lens, diff) }],
  });

  // A policy decline is surfaced, never papered over. Server-side fallbacks
  // were considered and deliberately not used here: a review's provenance is
  // part of its output, and silently re-running on a different model would
  // present one model's findings under another's name.
  if (response.stop_reason === "refusal") {
    return {
      lens,
      error: `declined by the model (${response.stop_details?.category ?? "unknown"})`,
    };
  }
  if (!response.parsed_output) {
    return { lens, error: "response did not parse against the schema" };
  }
  return { lens, report: response.parsed_output, model: response.model };
}

// ---------------------------------------------------------------------------
function render(results) {
  const SEV = { blocking: "BLOCK", "should-fix": "FIX  ", nit: "nit  " };
  let blocking = 0;

  for (const r of results) {
    console.log(`\n${"=".repeat(72)}`);
    if (r.error) {
      console.log(`${r.lens.toUpperCase()}  ERROR: ${r.error}`);
      continue;
    }
    console.log(`${r.lens.toUpperCase()}  ${r.report.verdict}   (${r.model})`);
    console.log("=".repeat(72));

    if (r.report.findings.length === 0) console.log("  no findings");
    for (const f of r.report.findings) {
      if (f.severity === "blocking") blocking += 1;
      console.log(`\n  [${SEV[f.severity]}] ${f.file}:${f.line}`);
      console.log(`     ${f.claim}`);
      console.log(`     evidence: ${f.evidence}`);
      console.log(`     fails when: ${f.failure_scenario}`);
    }
    if (r.report.not_reviewed) {
      console.log(`\n  NOT ASSESSED: ${r.report.not_reviewed}`);
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`${blocking} blocking finding(s) across ${results.length} lens(es).`);
  return blocking;
}

// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const diff = readDiff(opts);

  if (!diff.trim()) {
    console.log("no diff to review (try --staged, or --diff <file>)");
    process.exit(0);
  }

  if (opts.dryRun) {
    for (const lens of opts.lenses) {
      console.log(`${"=".repeat(72)}\nPROMPT for ${lens.toUpperCase()}\n${"=".repeat(72)}`);
      console.log(promptFor(lens, diff));
    }
    console.log(`\n[dry run] ${opts.lenses.length} request(s) not sent. Model would be ${MODEL}.`);
    process.exit(0);
  }

  // The SDK resolves credentials itself: ANTHROPIC_API_KEY, then an OAuth
  // profile from `ant auth login`. An unset env var does not mean no key, so
  // this does not pre-check one and refuse.
  const client = new Anthropic();

  // Concurrent, not sequential. The lenses are independent by construction -
  // each reads its own section and none sees another's output - which is also
  // why their findings can be trusted as separate signals rather than one
  // opinion restated seven times.
  const results = await Promise.all(
    opts.lenses.map((lens) =>
      runLens(client, lens, diff).catch((e) => ({ lens, error: e.message })),
    ),
  );

  const blocking = render(results);
  // Exit code is the contract that makes this a gate. Wire it into CI or a
  // pre-push hook and a blocking finding stops the change.
  process.exit(blocking > 0 ? 1 : 0);
}

// Everything above the network boundary is exported so it can be tested
// without an API key. That boundary is where this repository's coverage
// honestly stops: `runLens` itself is UNPROVEN until someone runs it with a
// key, and README.md says so rather than leaving the gap silent.
export { parseArgs, criteriaFor, promptFor, LENSES, LensReport, MODEL };

// import.meta.main is not available on Node 20, so compare argv instead.
const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith("review-lenses.mjs");

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e.stack || String(e));
    process.exit(2);
  });
}
