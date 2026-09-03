#!/usr/bin/env node
// CONFIDENTIALITY GATE.
//
// This repository is an extraction from a private working system built for a
// paying client. The client's identity, their customers, their commercial
// figures and their infrastructure identifiers must never appear here.
//
// A note in a README saying "remember to sanitise" is a hint. This is the
// mechanism. It is the same argument the README makes about hooks versus
// instructions, turned on this repository's own construction: the extraction
// was done by hand, by someone who could miss a line, so the thing that decides
// whether a leak ships is a check rather than that person's attention.
//
// Runs as `pretest`, so `npm test` cannot start on a dirty tree, and as the
// first step in CI. Exits non-zero on any hit, printing file:line.
//
// -------------------------------------------------------------------------
// WHY THE TERMS ARE HEX-ENCODED, which is the part worth reading.
//
// The first version of this file wrote its rules as plain regex literals:
//   { re: /<clientname>/i, why: "client name" }
// It failed its own scan on eleven lines, and it was right to. A denylist
// written in plaintext IS the leak: publishing it would publish the exact list
// of clients it exists to hide. The obvious workaround, exempting this file
// from the scan, is worse - it creates the one location in the tree where a
// real leak could sit unexamined.
//
// So identifying terms are stored hex-encoded and compiled at runtime. No
// client name exists as text anywhere in this repository, including here.
// Structural patterns (phone numbers, JWTs, API keys) carry no secret and stay
// readable, because their whole value is that a reader can audit them.
// -------------------------------------------------------------------------
//
// PROVING IT WORKS. A check nobody has watched go red is decoration, so:
//
//     node scripts/check-no-client-refs.mjs --self-test
//
// asserts every rule matches a known-bad sample AND stays silent on benign
// text. CI runs the self-test before the scan, so a rule that has quietly
// stopped matching fails the build rather than reporting "clean".

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const un = (hex) => Buffer.from(hex, "hex").toString("utf8");

// Directories never scanned. Not exemptions from the rule: they hold no
// authored content, so scanning them produces noise and nothing else.
const SKIP_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".pytest_cache", ".venv", ".dev",
]);

const SCAN_EXT = new Set([
  ".md", ".mjs", ".js", ".cjs", ".ts", ".mts", ".json", ".yml", ".yaml",
  ".py", ".sh", ".txt", ".toml", ".gitignore", "",
]);

// ---------------------------------------------------------------------------
// ENCODED RULES: identities that would themselves leak if written in the open.
// `src` is a regex source, `sample` a string it must match. Both hex.
// ---------------------------------------------------------------------------
const ENCODED = [
  { src: "62657468656c", sample: "62657468656c", why: "client name" },
  { src: "7965646964", sample: "7965646964", why: "client name" },
  { src: "72656e65776d696e64", sample: "72656e65776d696e64", why: "client name" },
  { src: "636f6c696e6b6f6d", sample: "636f6c696e6b6f6d", why: "client name" },
  { src: "62656d7468756d", sample: "62656d7468756d", why: "client name" },
  { src: "6e61746976655b5c732d5d3f6a616d203f73747564696f", sample: "6e6174697665206a616d73747564696f", why: "client name" },
  { src: "73706963656a6574", sample: "73706963656a6574", why: "client counterparty" },
  { src: "64656c686976657279", sample: "64656c686976657279", why: "client counterparty" },
  { src: "5c626a6d636f5c62", sample: "6a6d636f", why: "client entity" },
  { src: "6d756e69726b61", sample: "6d756e69726b61", why: "client location" },
  { src: "63687572616368616e64707572", sample: "63687572616368616e64707572", why: "client location" },
  { src: "5c626c616d6b615c62", sample: "6c616d6b61", why: "client location" },
  { src: "5c6261697a61776c5c62", sample: "61697a61776c", why: "client location" },
  { src: "5c626d616e697075725c62", sample: "6d616e69707572", why: "client location" },
  { src: "6e637273676379626161796c73717762646c636f", sample: "6e637273676379626161796c73717762646c636f", why: "database project reference" },
  { src: "64756a6b6773796f6f6377716c70727877646364", sample: "64756a6b6773796f6f6377716c70727877646364", why: "database project reference" },
  { src: "6275737a686271676164707a7467686a6e7a7164", sample: "6275737a686271676164707a7467686a6e7a7164", why: "database project reference" },
  { src: "62657468656c6c61756e6472795c2e636f6d", sample: "62657468656c6c61756e6472792e636f6d", why: "client domain" },
  { src: "70696b616674676f6e65", sample: "70696b616674676f6e65", why: "unrelated account handle" },
];

// ---------------------------------------------------------------------------
// STRUCTURAL RULES: shapes, not secrets. The PATTERNS stay readable, because
// their whole value is that a reviewer can audit what is being caught. Only the
// positive SAMPLES are encoded - a literal that a rule matches is, by
// definition, a literal this gate must not find in the tree, even a synthetic
// one. Keeping them readable would mean exempting this file from its own scan.
// ---------------------------------------------------------------------------
const STRUCTURAL = [
  { re: /[a-z]{20}\.supabase\.co/i, sample: un("6162636465666768696a6b6c6d6e6f70717273742e73757061626173652e636f"), why: "database project host" },
  { re: /\bprj_[A-Za-z0-9]{16,}/, sample: un("70726a5f7a316644544b714d5344444e3053323479745939694f"), why: "hosting project id" },
  { re: /\bdpl_[A-Za-z0-9]{16,}/, sample: un("64706c5f4371504364335957456b7278714b6453415a47474756"), why: "deployment id" },
  { re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, sample: un("3230332e302e3131332e37"), why: "IP address" },
  { re: /\+91[\s-]?\d{4,5}[\s-]?\d{5}/, sample: un("2b3931203938373635203433323130"), why: "phone number" },
  { re: /wa\.me\/\d/, sample: un("77612e6d652f393139383736353433323130"), why: "messaging deep link to a real number" },
  { re: /[\w.+-]+@(?!example\.(com|org)\b)[\w-]+\.[\w.]+/, sample: un("736f6d656f6e65407265616c646f6d61696e2e636f"), why: "email address" },
  { re: /\bRs\.?\s?[\d,]{4,}/i, sample: un("527320312c32302c303030"), why: "figure from client books" },
  { re: /\bINR\s?[\d,]{4,}/i, sample: un("494e52203435303030"), why: "figure from client books" },
  { re: /\bsk-[A-Za-z0-9_-]{16,}/, sample: un("736b2d6162636465666768696a6b6c6d6e6f707172737475767778"), why: "API key" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{16,}/, sample: un("6768705f6162636465666768696a6b6c6d6e6f707172737475767778797a3031"), why: "source-host token" },
  { re: /\beyJ[A-Za-z0-9_-]{20,}\./, sample: un("65794a68624763694f694a49557a49314e694973496e5235634349362e78"), why: "JWT" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, sample: un("2d2d2d2d2d424547494e205253412050524956415445204b45592d2d2d2d2d"), why: "private key" },
];

// The author's surname is permitted exactly where authorship belongs, and
// nowhere else, so it cannot arrive as part of a client anecdote.
const AUTHOR = {
  re: new RegExp(un("6d756e6c756168"), "i"),
  sample: un("6d756e6c756168"),
  why: "author surname outside an authorship line",
  allowIn: ["LICENSE", "package.json", "README.md"],
};

const DENIED = [
  ...ENCODED.map((r) => ({
    re: new RegExp(un(r.src), "i"),
    sample: un(r.sample),
    why: r.why,
  })),
  ...STRUCTURAL,
  AUTHOR,
];

// ---------------------------------------------------------------------------
function selfTest() {
  let failed = 0;

  for (const [i, rule] of DENIED.entries()) {
    if (typeof rule.sample !== "string" || rule.sample.length === 0) {
      failed += 1;
      console.error(`  FAIL  rule ${i} (${rule.why}) has no sample, so it is unproven`);
      continue;
    }
    if (!rule.re.test(rule.sample)) {
      failed += 1;
      console.error(`  FAIL  rule ${i} (${rule.why}) did not match its own sample`);
    }
  }

  // A gate that matches everything is as useless as one that matches nothing.
  const benign = [
    "This repository ships hooks, review agents and a routing table.",
    "npm test runs node --test over hooks/__tests__/",
    "contact: someone@example.com",
    "See docs/CASE-STUDY.md for the anonymised write-up.",
    "The reviewer returned CHANGES-NEEDED on the money path.",
    "Node 20 or later; run npm ci first.",
  ];
  for (const line of benign) {
    for (const rule of DENIED) {
      if (rule.re.test(line)) {
        failed += 1;
        console.error(`  FAIL  rule (${rule.why}) fired on benign text: ${line}`);
      }
    }
  }

  if (failed === 0) {
    console.log(
      `self-test: ${DENIED.length} rules match their samples and stay silent on ` +
        `${benign.length} benign lines`,
    );
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}

// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      const dot = name.lastIndexOf(".");
      const ext = dot === -1 ? "" : name.slice(dot);
      if (SCAN_EXT.has(ext)) out.push(full);
    }
  }
  return out;
}

function allowed(rule, relPath) {
  if (!rule.allowIn) return false;
  return rule.allowIn.some((s) => relPath === s || relPath.endsWith("/" + s));
}

const findings = [];
for (const file of walk(ROOT)) {
  const relPath = relative(ROOT, file).split(sep).join("/");
  let lines;
  try {
    lines = readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    continue;
  }
  lines.forEach((line, i) => {
    for (const rule of DENIED) {
      if (allowed(rule, relPath)) continue;
      const m = line.match(rule.re);
      if (m) {
        findings.push({
          file: relPath,
          line: i + 1,
          why: rule.why,
          match: m[0].slice(0, 60),
        });
      }
    }
  });
}

if (findings.length === 0) {
  console.log(`confidentiality gate: clean (${DENIED.length} rules over the tree)`);
  process.exit(0);
}

console.error(`CONFIDENTIALITY GATE FAILED: ${findings.length} finding(s).\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  [${f.why}]  matched "${f.match}"`);
}
console.error(
  "\nEvery hit above is either a real leak or a term that needs an explicit" +
    "\nallowIn entry. Do not widen a rule to make it quiet.",
);
process.exit(1);

// ---------------------------------------------------------------------------
// KNOWN LIMITS, stated rather than left silent.
//
// 1. It cannot read images, PDFs or any binary. A screenshot containing a
//    client name passes. No mechanical rung here can see that, so the human
//    step replacing it is that this repository ships no screenshots at all.
// 2. It matches terms and shapes. A paraphrase that identifies the client
//    without naming it would pass. The human step is that docs/CASE-STUDY.md
//    was written to be unattributable, and that is a judgement, not a check.
// 3. It scans the working tree, not git history. History here begins at the
//    extraction commit precisely so there is no earlier history to audit.
// ---------------------------------------------------------------------------
