#!/usr/bin/env node
// SessionStart hook. Catches the "shipped code, never closed" class.
//
// WHY THIS EXISTS. The session-close routine was invoked, never fired: the
// only hook events wired were SessionStart and PreToolUse - no Stop, no
// SessionEnd - so a session that commits and then has its terminal closed
// leaves no entry at all. The project this was built for had accumulated
// eighteen session numbers with shipped work and no log entry before anyone
// counted. An uninvoked control and an absent control are indistinguishable
// in outcome.
//
// WHY SessionStart AND NOT SessionEnd. SessionEnd fires when nothing can
// act on the warning, and it would need a state file that can rot or
// disagree with git. Deriving "commits since the last close commit"
// straight from git at START is stateless, self-healing, and surfaces the
// reminder at the one moment somebody can do something about it.
//
// SECOND JOB: it prints the fix( commits in that range, which is the
// machine-derived input to close-session step 5 (the R15 check ledger).
// Without it, step 5 depends on my memory of a session that may have been
// compacted.
//
// KNOWN BLIND SPOT. The range is bounded by the most recent close commit by
// ANYONE. Two or three lanes commit to this repo concurrently, so a sibling
// lane closing ON TOP of unlogged work hides it: measured 2026-08-25, the
// range came back empty with two unlogged commits sitting one layer under a
// sibling docs(S428) tip. This guard therefore reports a FLOOR, never a
// ledger - it can under-report and must never be read as "nothing is
// outstanding". Widening it would mean guessing which lane owns which commit,
// which is worse: it would accuse the wrong session and train the reader to
// ignore the alarm.
//
// SAFETY. This runs before every session in every repo. It must never
// break one: every path is wrapped, git calls are timed out, and the
// process always exits 0 with no output when it has nothing to say.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LOOKBACK = 200; // commits scanned for the most recent close

// Opt-in marker. A repo only gets this warning if it actually keeps session
// logs; everywhere else the hook exits silently. Override both for a different
// convention, e.g. AOS_SESSIONS_DIR=notes/sessions AOS_CLOSE_RE='^chore\(close'
const SESSIONS_DIR = process.env.AOS_SESSIONS_DIR || "docs/sessions";
const CLOSE_RE = new RegExp(process.env.AOS_CLOSE_RE || "^docs\\(S\\d+\\)");
const FIX_RE = /^fix\(/;

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    timeout: 5000,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function main() {
  const cwd = process.cwd();

  let root;
  try {
    root = git(["rev-parse", "--show-toplevel"], cwd);
  } catch {
    return; // not a git repo - nothing to say
  }

  // Scope guard. CLOSE_RE is one project's commit convention; firing it on a
  // repo that does not use session closes would report every commit as
  // unclosed forever. A repo opts in by having the sessions directory, so
  // this hook is silent everywhere else rather than noisy everywhere.
  if (!fs.existsSync(path.join(root, SESSIONS_DIR))) return;

  let log;
  try {
    log = git(["log", `-${LOOKBACK}`, "--format=%h%x1f%s%x1f%ad", "--date=short"], root);
  } catch {
    return;
  }
  if (!log) return;

  const commits = log.split("\n").map((line) => {
    const [sha, subject, date] = line.split("\x1f");
    return { sha, subject: subject || "", date };
  });

  const closeIdx = commits.findIndex((c) => CLOSE_RE.test(c.subject));
  if (closeIdx === -1) return; // no close in living memory; stay quiet rather than guess
  if (closeIdx === 0) return; // the tip IS a close - nothing outstanding

  const since = commits.slice(0, closeIdx);
  const lastClose = commits[closeIdx];

  // Doc-only commits above the close are usually another lane tidying, not
  // unclosed work. Report them, but count the substantive ones separately.
  const substantive = since.filter((c) => !/^docs[(:]/.test(c.subject));
  if (substantive.length === 0) return;

  const fixes = since.filter((c) => FIX_RE.test(c.subject));

  let branch = "HEAD";
  try {
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  } catch {
    /* keep default */
  }

  const out = [];
  out.push("UNCLOSED WORK GUARD (machine-derived from git, not from memory):");
  out.push(
    `  ${since.length} commit(s) on ${branch} sit above the last close ` +
      `${lastClose.sha} "${lastClose.subject}" (${lastClose.date}).`
  );
  out.push(`  ${substantive.length} of them are code rather than docs:`);
  for (const c of since.slice(0, 15)) {
    out.push(`    ${c.sha}  ${c.date}  ${c.subject}`);
  }
  if (since.length > 15) out.push(`    ... and ${since.length - 15} more`);
  out.push("");
  out.push(
    "  This means a session shipped and did not log, OR a sibling lane is live" +
      " right now. Establish which BEFORE writing a close - do not assume the" +
      " work is yours to log, and do not assume it was logged."
  );
  if (fixes.length > 0) {
    out.push("");
    out.push(
      `  R15 (close-session step 5): ${fixes.length} of these are fix( commits and` +
        " each owes a check-ledger line - the rung, the check, and whether it was" +
        " watched going RED - or an explicit 'this class is unguarded' with the" +
        " human step that replaces it:"
    );
    for (const c of fixes.slice(0, 10)) out.push(`    ${c.sha}  ${c.subject}`);
    if (fixes.length > 10) out.push(`    ... and ${fixes.length - 10} more`);
  }

  console.log(out.join("\n"));
}

try {
  main();
} catch {
  // Never break a session start over a reminder.
}
process.exit(0);
