#!/usr/bin/env node
// UserPromptSubmit hook. Skill descriptions are a HINT the model may act on,
// not a mechanism (S458: a session asked a textbook controls question and went
// straight to grep with no skill and no adapter). This hook is the mechanism:
// it matches the prompt against a small set of intent patterns and injects a
// line naming the skill that covers it.
//
// SUGGEST, NOT COMPEL, by owner decision 2026-09-03. A false match costs one
// line of injected text rather than a whole turn spent in a workshop nobody
// asked for. That trade is why only cheap, recommendation-shaped skills are
// routed here; the four question-asking workshops in the same library are
// deliberately left on the slash command.
//
// Scope is deliberately narrow. Adding a skill here is a decision to interrupt
// ordinary work whenever its patterns hit, so the bar is: does the routed skill
// return a RECOMMENDATION, and would missing it have cost something real?

const ROUTES = [
  {
    skill: "prioritization-advisor",
    why: "picking what to work on has a method behind it",
    patterns: [
      /\bwhat should (?:i|we) (?:work on|do|build|tackle|start)\b/i,
      /\bwhat(?:'s| is) next\b/i,
      /\bwhich (?:one|of these|should)\b.*\bfirst\b/i,
      /\bpriorit(?:ise|ize|isation|ization|ies)\b/i,
      /\brank (?:these|them|the|my)\b/i,
      /\bmost important thing to\b/i,
    ],
  },
  {
    skill: "problem-framing-canvas",
    why: "framing the problem before choosing a solution",
    patterns: [
      /\bshould (?:we|i) build\b/i,
      /\bis it worth building\b/i,
      /\bwhat problem (?:are|is|does)\b/i,
      /\bframe the problem\b/i,
      /\broot (?:problem|cause) (?:here|is)\b/i,
      /\breal problem\b/i,
    ],
  },
  {
    skill: "competitive-analysis-process",
    why: "a bid assumed to be sole-source turned out to be competitive, and nobody knew until after it was sent",
    patterns: [
      /\bcompetitors?\b/i,
      /\bcompetitive (?:analysis|landscape|position)\b/i,
      /\bmarket landscape\b/i,
      /\b(?:rfq|rfp|tender)\b/i,
      /\bwho else (?:is|does|offers|bids)\b/i,
    ],
  },
  {
    skill: "battle-card-builder",
    why: "a field card states every claim with a source",
    patterns: [
      /\bbattle ?cards?\b/i,
      /\b(?:we|us|our)\s+(?:vs\.?|versus)\s+\S/i,
      /\bobjection handling\b/i,
      /\bwin (?:against|versus|vs\.?)\b/i,
    ],
  },
];

// Exported so the test can drive it without spawning a process.
function route(prompt) {
  if (typeof prompt !== "string") return [];
  const text = prompt.trim();
  if (!text) return [];
  // An explicit slash invocation has already chosen a skill. Do not second-guess it.
  if (text.startsWith("/")) return [];

  const hits = [];
  for (const r of ROUTES) {
    if (r.patterns.some((p) => p.test(text))) hits.push(r);
  }
  // Two is the cap. A prompt matching three routes is a prompt whose intent the
  // patterns have not actually identified, and three suggestions read as noise.
  return hits.slice(0, 2);
}

function render(hits) {
  if (hits.length === 0) return "";
  const lines = ["[skill-router] This prompt matches an installed skill:"];
  for (const h of hits) {
    lines.push(`  /${h.skill} - ${h.why}`);
  }
  lines.push(
    "Consider invoking it before answering. This is a suggestion, not a",
    "requirement: if it does not fit what was actually asked, ignore it and",
    "say nothing about it.",
  );
  return lines.join("\n");
}

module.exports = { route, render, ROUTES };

if (require.main === module) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => {
    raw += c;
  });
  process.stdin.on("end", () => {
    let prompt = "";
    try {
      prompt = (JSON.parse(raw) || {}).prompt || "";
    } catch {
      // A hook that throws on unexpected input blocks the prompt. Fail open.
      process.exit(0);
    }
    const out = render(route(prompt));
    if (out) console.log(out);
    process.exit(0);
  });
}
