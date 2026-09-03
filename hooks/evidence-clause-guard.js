#!/usr/bin/env node
// R10 (the evidence clause) + R16 (directional error), enforced mechanically.
//
// Stop hook. Reads the LAST assistant message out of the transcript and looks
// for sentences that assert a CAUSE, a COVERAGE, a CAPABILITY or a DESTINATION
// without carrying the evidence that would settle it. When it finds one, exit 2
// blocks the stop and feeds the offending sentences back so the turn is redone
// with the evidence clause in place, or the claim withdrawn.
//
// Why a hook and not a paragraph: measured 2026-08-25, R10/R11/R14 had nineteen
// recorded occurrences across projects despite ~1,460 words of prose telling me
// not to. R12's own text says it plainly: "knowing the rule demonstrably does
// not prevent it." block-env-read.js is why the secrets rule has never bitten.
// This is that mechanism pointed at the claim surface.
//
// Deliberately biased toward FALSE POSITIVES on first release. A false positive
// costs one extra turn; a false negative costs a wrong cause inside a
// recommendation the user acts on. Tune the pattern lists below, do not widen the
// evidence markers to make it quiet.
//
// Kill switch:  set CLAUDE_EVIDENCE_HOOK=off in the environment.
// Unregister:   remove the Stop entry in ~/.claude/settings.json.

const fs = require("fs");

if ((process.env.CLAUDE_EVIDENCE_HOOK || "").toLowerCase() === "off") {
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Claim triggers. A sentence matching one of these is asserting something that
// R10 says must arrive with its check attached.
// ---------------------------------------------------------------------------
const CLAIMS = [
  {
    kind: "CAUSE",
    re: /\b(because|due to|driven by|caused by|the cause (is|was)|the reason (is|was|for)|which is why|stems from|explains the|attributable to)\b/i,
    where: "the decomposition, not the total (GROUP BY / split / segment)",
  },
  {
    kind: "COVERAGE",
    re: /\b(is enforced|are enforced|is gated|are gated|is covered|are covered|is guarded|are guarded|runs in ci|cannot happen|is ratcheted|are ratcheted|is blocked by the|prevents this|will catch)\b/i,
    where: "the command that proves it, run THIS session",
  },
  {
    kind: "CAPABILITY",
    re: /\b(is unavailable|are unavailable|unauthenticated|not authenticated|cannot (run|access|reach|see|connect)|has no access|is not connected|is not available|is disabled)\b/i,
    where: "a read-only probe, --version, a list call, or a narrower scope",
  },
  {
    kind: "DESTINATION",
    re: /\b(reaches|links to|redirects to|resolves to|points to|is served (by|from)|lands on)\b/i,
    where: "the FAR end: the destination's own handling, not the href",
    // Only when the sentence is actually about a traversable path. Ordinary
    // prose uses "points to" and "reaches" constantly.
    subject:
      /\b(link|links|linked|route|routes|href|url|endpoint|page|screen|button|cta|nav|menu|anchor|redirect|domain|deep ?link|\/[a-z][\w/-]*)\b/i,
  },
];

// A CAUSE claim only matters when it is a claim about a SYSTEM or a MEASURE -
// which is the defect class. "I used a worktree because the checkout is dirty"
// is me explaining my own choice and is none of this rule's business. Measured
// 2026-08-25: without this the fire rate on 1,943 real messages was 10.7%.
const CAUSE_SUBJECT =
  /(\b\d+(\.\d+)?\s*(%|percent|pp)|\b(rs|inr|usd|\$)\s?[\d,]|\b\d[\d,]{2,}\b|\b(revenue|volume|orders?|bookings?|parcels?|sales|traffic|conversion|churn|retention|margin|aov|arpu|uptime|latency|throughput|error rate|drop-?off)\b|\b(fell|rose|dropped|declined|spiked|surged|grew|shrank|down|up)\s+(by\s+)?\d)/i;

// ---------------------------------------------------------------------------
// Evidence markers. Generic ones satisfy COVERAGE / CAPABILITY / DESTINATION.
// CAUSE is stricter on purpose: a bare number is a magnitude, and a magnitude
// is exactly what got mistaken for a mechanism. It needs a DECOMP marker.
// ---------------------------------------------------------------------------
const GENERIC_EVIDENCE = [
  /`[^`]+`/, // a code span: a command, path, symbol or literal
  /\b\d/, // a figure
  /\b(i ran|i probed|i checked|i opened|i read|verified|measured|confirmed by|output below|exit code|returned)\b/i,
  /\b[\w./-]+\.(ts|tsx|js|mjs|jsx|md|json|sql|html|css|yml|yaml|sh|py)\b/i,
];

const DECOMP_EVIDENCE = [
  /\bgroup by\b/i,
  /\bof which\b/i,
  /\b(split|broken down|grouped|segmented|bucketed) by\b/i,
  /\baccounts? for\b/i,
  /\bexcluding\b/i,
  /\bn\s*=\s*\d/i,
  /\b(vs\.?|versus)\b/i,
  /\b(i ran|i checked|i decomposed|i grouped|verified|measured)\b/i,
];

// A sentence that openly flags itself as unverified is doing the right thing.
const HEDGED =
  /\b(unverified|not verified|i have not|i did not|assumption|assuming|unproven|unguarded|guess|hypothes|might be|may be|could be|likely|probably|suspect|unclear|not checked|worth checking|needs? (a )?check)\b/i;

function textOfLastAssistantMessage(transcriptPath) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, "utf8").split(/\r?\n/);
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "assistant") continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
    if (text.trim()) return text;
  }
  return null;
}

// Strip fenced code only. Tables and blockquotes are NOT exempt: findings get
// presented in tables more often than in prose, and a blockquote is as likely
// to be my own emphasis as a quotation. An early version skipped both on the
// assumption that a table row is "already evidence-shaped" - tested, and that
// assumption made the exact defect this gate was built for invisible to it. An
// exemption clause is where coverage dies.
//
// A table ROW is judged whole, not cell by cell. A findings row spreads one
// claim across its columns - the magnitude in one cell, the cause in the next -
// so splitting on the pipe hands each half to the detector with the other half
// missing, and it fires on neither. Tested: cell-splitting missed the exact
// findings row it was added to catch.
function scannableUnits(text) {
  const out = [];
  for (const line of text.replace(/```[\s\S]*?```/g, " ").split(/\r?\n/)) {
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|[\s|:-]+\|?\s*$/.test(line)) continue; // separator row
      out.push(line.replace(/\|/g, " ")); // one row, one unit
    } else {
      out.push(line.replace(/^\s*>+\s?/, ""));
    }
  }
  return out.join("\n");
}

function sentences(prose) {
  return prose
    .split(/(?<=[.!?])\s+|\n{2,}|\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 25);
}

function hasAny(patterns, s) {
  return patterns.some((p) => p.test(s));
}

// Exported so the false-positive rate can be MEASURED against real transcripts
// by the same code that gates, rather than by a second copy that can drift.
function scanText(text) {
  const findings = [];
  for (const s of sentences(scannableUnits(text))) {
    if (HEDGED.test(s)) continue;
    for (const claim of CLAIMS) {
      if (!claim.re.test(s)) continue;
      // Some claim kinds need the sentence to be ABOUT the thing before the
      // trigger word means anything.
      if (claim.kind === "CAUSE" && !CAUSE_SUBJECT.test(s)) continue;
      if (claim.subject && !claim.subject.test(s)) continue;
      const ok =
        claim.kind === "CAUSE"
          ? hasAny(DECOMP_EVIDENCE, s)
          : hasAny(GENERIC_EVIDENCE, s);
      if (!ok) {
        findings.push({ kind: claim.kind, where: claim.where, sentence: s });
      }
      break; // one finding per sentence is enough
    }
    if (findings.length >= 3) break;
  }
  return findings;
}

function main(data) {
  // Never loop: if this hook already blocked once this turn, let the stop land.
  if (data.stop_hook_active) process.exit(0);

  const text = textOfLastAssistantMessage(data.transcript_path);
  if (!text) process.exit(0);

  const findings = scanText(text);
  if (findings.length === 0) process.exit(0);

  const lines = [
    "R10 THE EVIDENCE CLAUSE - blocked before this reached the user.",
    "",
    "The sentences below assert something without carrying the check that",
    "would settle it. For each one: either run the check and put it INSIDE",
    "the sentence, or withdraw the claim. Do not soften the wording - a",
    "hedged claim still reads as a finding (R10, corollary 2).",
    "",
  ];
  for (const f of findings) {
    lines.push(`  [${f.kind}] ${f.sentence}`);
    lines.push(`     check it at: ${f.where}`);
    lines.push("");
  }
  lines.push(
    "If this is a false positive - the evidence is genuinely in an adjacent",
    "sentence, a table or a tool result above - say so in one line and stop.",
    "R16: if this turn is an analysis or findings report, also state the",
    "direction the framing pushes and one disconfirming read."
  );

  process.stderr.write(lines.join("\n") + "\n");
  process.exit(2);
}

if (require.main === module) {
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    try {
      main(JSON.parse(raw));
    } catch {
      process.exit(0);
    }
  });
} else {
  module.exports = { scanText, textOfLastAssistantMessage };
}
