#!/usr/bin/env node
// Blocks a destructive git command when the working tree holds uncommitted
// work that the command would silently throw away.
//
// WHY THIS EXISTS. During a machine-wide text sweep the agent ran
// `git reset --hard HEAD~1` in an unrelated scratch repository, purely to clean
// up a throwaway proof commit. That repo also held two files the user had modified
// hours earlier and never staged. The reset discarded both. They were
// recovered from ~/.claude/file-history, which was luck, not a safety net:
// git had no copy, because content that is never staged never becomes an
// object.
//
// The machine-wide rule "before any destructive op, state the recovery path
// first" already existed and did not stop it, because the command LOOKED
// local and tidy. That is exactly the case a prose rule cannot catch, so it
// gets a mechanical rung instead.
//
// WHAT IS BLOCKED, and only when the tree is actually dirty:
//   git reset --hard          discards tracked modifications
//   git checkout -- <path>    same
//   git checkout .            same
//   git restore <path>        same, without --staged
//   git clean -f / -fd / -fx  deletes untracked files outright
//
// A CLEAN tree is never blocked, so ordinary use is unaffected. The hook
// reports what would be lost and names the recovery path, which is the thing
// the rule asked for in the first place.
//
// To proceed deliberately: commit or stash first, which is almost always the
// right answer. Genuinely need the destructive form on a dirty tree? Say so
// and remove this hook from ~/.claude/settings.json for that action.

// execFileSync, not execSync: no shell is spawned, so nothing from the
// model-authored command string can be interpreted as shell syntax.
const { execFileSync } = require("child_process");

// -C <dir> capture, so we check the RIGHT repo, not the shell's cwd
const DASH_C = /(?:^|\s)-C\s+("([^"]+)"|'([^']+)'|(\S+))/;

const DESTRUCTIVE = [
  { re: /\bgit\b[^|;&]*\breset\b[^|;&]*--hard\b/, what: "git reset --hard" },
  { re: /\bgit\b[^|;&]*\bcheckout\b[^|;&]*\s--\s/, what: "git checkout -- <path>" },
  { re: /\bgit\b[^|;&]*\bcheckout\b\s+\.(\s|$)/, what: "git checkout ." },
  { re: /\bgit\b[^|;&]*\bclean\b[^|;&]*\s-[a-z]*f/, what: "git clean -f" },
  { re: /\bgit\b[^|;&]*\brestore\b(?![^|;&]*--staged)/, what: "git restore <path>" },
];

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const ti = (data && data.tool_input) || {};
  const cmd = typeof ti.command === "string" ? ti.command : "";
  if (!cmd) process.exit(0);

  const hit = DESTRUCTIVE.find((d) => d.re.test(cmd));
  if (!hit) process.exit(0);

  // which repo would it act on?
  const m = cmd.match(DASH_C);
  let dir = m ? m[2] || m[3] || m[4] : (data.cwd || process.cwd());

  // Git Bash hands us msys paths like /d/Software/x, which Node on Windows
  // cannot resolve. Left unconverted, the status probe throws and this hook
  // silently bails open, which is worse than having no hook at all because it
  // looks like coverage. Convert /<drive>/rest  ->  <DRIVE>:/rest.
  const msys = dir.match(/^\/([a-zA-Z])\/(.*)$/);
  if (msys) dir = msys[1].toUpperCase() + ":/" + msys[2];

  let status = "";
  try {
    status = execFileSync("git", ["status", "--porcelain"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    process.exit(0); // not a repo, or git unavailable: not our business
  }

  const lines = status.split("\n").filter((l) => l.trim());
  if (!lines.length) process.exit(0); // clean tree, nothing to lose

  // untracked files only matter to `clean`; the others cannot touch them
  const tracked = lines.filter((l) => !l.startsWith("??"));
  const untracked = lines.filter((l) => l.startsWith("??"));
  const atRisk = hit.what.startsWith("git clean") ? untracked : tracked;
  if (!atRisk.length) process.exit(0);

  process.stderr.write(
    "BLOCKED: " + hit.what + " would discard uncommitted work in " + dir + ".\n\n" +
      atRisk.slice(0, 20).map((l) => "    " + l).join("\n") +
      (atRisk.length > 20 ? "\n    ...and " + (atRisk.length - 20) + " more" : "") +
      "\n\nContent that was never staged is NOT in git. Once discarded there is no\n" +
      "git-side recovery, only ~/.claude/file-history, which is luck and not a backup.\n\n" +
      "Do this instead:\n" +
      "  git -C <repo> stash push -u -m 'before <the destructive op>'   then redo it\n" +
      "  or commit the work first\n" +
      "  or narrow the command to the specific paths you actually mean\n\n" +
      "If discarding really is intended, say so to the user and get agreement first;\n" +
      "that is the machine-wide 'state the recovery path before a destructive op' rule.\n"
  );
  process.exit(2);
});
