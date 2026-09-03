#!/usr/bin/env node
// Global secrets guard: "never open, read, or inspect .env / .env.local".
// PreToolUse hook on Read/Grep/Bash/PowerShell. If a tool call would read or
// inspect a real environment file (.env, or .env.<suffix> such as .env.local
// or .env.production), the call is blocked (exit 2) and the reason is fed back
// so the model asks for the variable NAME instead of reading the value.
//
// The variable-names file .env.example (and .sample / .template / .dist /
// .defaults) is allowed, since it carries names only. Writing a file whose
// content merely mentions an env path is NOT blocked; only reads/inspection are.
// Flip to a warning or remove via ~/.claude/settings.json.
//
// Read vectors covered: the Read tool (file_path), the Grep tool (path), and
// shell reads via Bash/PowerShell (cat, type, Get-Content, head, tail, less,
// grep, source, dotenv, git diff/show/add of the file, etc). Detection is by
// the literal ".env" token in the tool input, so a plain "grep -rn X ." over
// the whole repo is NOT blocked (ripgrep skips the gitignored .env.local
// anyway); only an explicit reference to the env file itself is blocked.
//
// Kept pure ASCII so it never trips the sibling block-em-dash guard.

// A protected env file: a ".env" path token, optionally ".<suffix>", whose
// suffix is NOT one of the conventionally-secret-free allowlist below.
//
// The leading (?<![A-Za-z0-9_]) matters and was added after a real false
// positive: `process.env` contains the literal token `.env`, so a command doing
// nothing but reading an in-process environment variable was blocked with a
// message about reading a secrets file. A guard that fires on ordinary code is
// a guard that gets uninstalled, which costs far more than the case it was
// protecting.
//
// The lookbehind requires the character before ".env" to be a non-identifier -
// a path separator, a quote, a space, or start-of-string - which is what a real
// path looks like (`.env`, `./.env.local`, `app/.env`) and what an expression
// like `process.env` or `import.meta.env` never is.
//
// KNOWN GAP, stated rather than left silent: this also stops matching an env
// file named without a separator before the dot, such as `myapp.env`. That is
// not a convention anywhere I have seen it, and the trade is deliberate -
// a rare miss is preferable to a guard firing on every line of code that reads
// an environment variable.
const ENV_TOKEN = /(?<![A-Za-z0-9_])\.env(\.[A-Za-z0-9_-]+)?\b/g;
const SAFE_SUFFIX = /^\.(example|sample|template|dist|defaults)$/i;

function hasProtectedEnv(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  ENV_TOKEN.lastIndex = 0;
  let m;
  while ((m = ENV_TOKEN.exec(text)) !== null) {
    const suffix = m[1]; // ".local", ".production", or undefined for bare .env
    if (suffix === undefined || !SAFE_SUFFIX.test(suffix)) return true;
  }
  return false;
}

// Exported so the predicate can be tested directly. The false-positive rate is
// the thing that decides whether this hook survives contact with real work, and
// it is not measurable through a subprocess that calls process.exit.
module.exports = { hasProtectedEnv };

if (require.main !== module) return;

let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    process.exit(0); // not our concern if we cannot parse the payload
  }

  const ti = (data && data.tool_input) || {};
  const candidates = [ti.file_path, ti.filePath, ti.path, ti.command];

  for (const c of candidates) {
    if (hasProtectedEnv(c)) {
      process.stderr.write(
        "Blocked by the secrets rule (machine-wide hard rule): this tool call " +
          "would read or inspect a real environment file (.env / .env.local / " +
          ".env.<env>). Never open, read, or inspect .env.local. If you need an " +
          "env variable, ask the user for the NAME, not the value; it lives in the " +
          "service or .env directly. Reading .env.example (names only) is allowed. " +
          "To run a script that needs the env loaded, use the package.json wrapper " +
          "(e.g. `npm run smoke:realtime`) rather than referencing .env.local directly."
      );
      process.exit(2); // block the tool call
    }
  }
  process.exit(0);
});
