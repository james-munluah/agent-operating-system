// Tests for block-env-read.js.
//
// This hook blocks tool calls, so its false-positive rate is what decides
// whether it survives contact with real work. A secrets guard that fires on
// ordinary code gets uninstalled, and an uninstalled guard protects nothing -
// which is strictly worse than the honest position of having no guard, because
// the rulebook still claims coverage.
//
// So the MUST-NOT-BLOCK list below is the more important half of this file, and
// its first entry is a real incident: `process.env` contains the literal token
// `.env`, and an earlier version of this hook blocked a command that did
// nothing but read an in-process environment variable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { hasProtectedEnv } = require("../block-env-read.js");

const MUST_BLOCK = [
  "cat .env",
  "cat .env.local",
  "cat .env.production",
  "type .env.local",
  "Get-Content .env.local",
  "head -5 ./.env",
  "grep SUPABASE app/.env.local",
  "source .env",
  "git diff .env.local",
  "/home/user/project/.env.staging",
  // A safe suffix does not launder an unsafe token later in the same string.
  // This case was originally written as a MUST-NOT-BLOCK and the test caught
  // the mistake: the destination filename contains `.env.local`, so blocking
  // it is correct.
  "cp .env.template .env.local.notreal",
];

for (const input of MUST_BLOCK) {
  test(`blocks: ${input}`, () => {
    assert.equal(hasProtectedEnv(input), true);
  });
}

const MUST_NOT_BLOCK = [
  // The real false positive that produced the lookbehind.
  "node -e 'console.log(process.env.HOME)'",
  "const dir = process.env.TMPDIR || '/tmp'",
  "import.meta.env.MODE",
  // The names-only contract file is explicitly allowed: it is how you find out
  // which variables exist without learning any of their values.
  "cat .env.example",
  "cat .env.sample",
  "cp .env.template ./config/defaults",
  // Ordinary work that happens to mention environments.
  "npm run build",
  "grep -rn TODO .",
  "echo 'set the environment variable first'",
  "git status",
  "",
];

for (const input of MUST_NOT_BLOCK) {
  test(`allows: ${JSON.stringify(input)}`, () => {
    assert.equal(hasProtectedEnv(input), false, `wrongly blocked: ${input}`);
  });
}

test("a safe suffix does not launder a real env file elsewhere in the string", () => {
  // Reading .env.example is fine; mentioning it alongside a real read is not.
  assert.equal(hasProtectedEnv("diff .env.example .env.local"), true);
});

test("malformed input does not throw", () => {
  // A PreToolUse hook that throws blocks the tool call with no explanation.
  assert.equal(hasProtectedEnv(null), false);
  assert.equal(hasProtectedEnv(undefined), false);
  assert.equal(hasProtectedEnv(42), false);
});

test("the regex is not left with sticky state between calls", () => {
  // ENV_TOKEN carries the /g flag, so lastIndex persists across exec calls. If
  // it is not reset, the second call on the same input silently returns the
  // wrong answer - a guard that works once and then stops.
  assert.equal(hasProtectedEnv("cat .env.local"), true);
  assert.equal(hasProtectedEnv("cat .env.local"), true);
  assert.equal(hasProtectedEnv("cat .env.local"), true);
});
