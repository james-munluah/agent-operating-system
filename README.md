# agent-operating-system

[![ci](https://github.com/james-munluah/agent-operating-system/actions/workflows/ci.yml/badge.svg)](https://github.com/james-munluah/agent-operating-system/actions/workflows/ci.yml)

**A coding agent's instructions are a hint. Only a mechanism is a mechanism.**

That sentence is the whole argument, and it was learned the expensive way. Over
roughly two years of building and operating a production system with a coding
agent, I wrote a rulebook: do not read `.env` files, carry your evidence in the
same sentence as your claim, never run a destructive git command without stating
the recovery path. The rulebook grew to several thousand words. The agent read it
at the start of every session. It broke the rules anyway, and the pattern in
*which* rules it broke turned out to be the useful finding:

> A rule the agent must remember to apply at an unpredictable moment fails.
> A rule with a hook behind it does not.

This repository is the mechanisms. Hooks that fail closed, review agents that
fire by risk class, and a confidentiality gate that had to be redesigned because
its first draft leaked the thing it was protecting.

---

## What's here

| | | |
|---|---|---|
| `hooks/` | 5 hooks | Intercept tool calls and turns. Two block, three inform. |
| `agents/` | 8 review lenses | Fresh-eyes reviewers, each with a scope it may not exceed. |
| `demo/` | 1 runner | Makes the lenses executable against any diff, with typed findings. |
| `scripts/` | 1 gate | The confidentiality check described below. |
| `docs/` | | The incident-to-rule loop, and an anonymised case study. |

```bash
npm ci
npm test                                     # 55 tests + the gate's self-test
node demo/review-lenses.mjs --staged --dry-run   # no API key needed
```

---

## The three pieces worth your time

### 1. A confidentiality gate whose denylist cannot leak its own terms

This repository is an extraction from a private client system, so the first
thing it needed was a check deciding whether a leak ships, rather than a note
asking me to remember.

The first draft wrote its rules as plain regex literals: `{ re: /<clientname>/i }`.
**It failed its own scan on eleven lines, and it was right to.** A denylist
written in plaintext *is* the leak, because publishing it publishes the exact
list of names it exists to hide. The obvious workaround, exempting the file from
its own scan, is strictly worse: it creates the single place in the tree where a
real leak could sit unexamined.

So identifying terms are hex-encoded and compiled at runtime. Structural
patterns (phone numbers, JWTs, API keys) stay readable, because their value is
that a reviewer can audit them; only their positive samples are encoded, for the
same reason as above.

```bash
node scripts/check-no-client-refs.mjs --self-test
# self-test: 33 rules match their samples and stay silent on 6 benign lines
```

The self-test runs **before** the scan, in `npm test` and in CI. A scan
reporting "clean" because its rules quietly stopped matching is worse than no
scan at all.

The file ends with a `KNOWN LIMITS` block naming three things it cannot do:
it cannot read images, it cannot catch a paraphrase that identifies the client
without naming them, and it scans the working tree rather than git history. Each
one names the human step that replaces it. That block is not modesty. A control
silent about its own edge reads as complete coverage, which is the specific
failure this repository is about.

### 2. Hooks that fail closed

| Hook | Event | What it does |
|---|---|---|
| `block-env-read` | PreToolUse | Refuses any tool call that would read a real `.env`, while allowing `.env.example`. |
| `block-destructive-git` | PreToolUse | Refuses `reset --hard` / `checkout --` / `clean -f` **only when the tree is dirty**, lists what would be lost, states the recovery path. |
| `evidence-clause-guard` | Stop | Reads the agent's own last message and blocks it when a claim arrives with no check attached. |
| `unclosed-work-guard` | SessionStart | Derives "commits since the last session close" from git. Reports a floor, never a ledger. |
| `skill-router` | UserPromptSubmit | Matches a prompt and names the skill that covers it. |

Three details that matter more than the list:

**`block-destructive-git` only fires on a dirty tree.** A guard that blocks
`git reset --hard` unconditionally gets removed within a day. It exists because
a tidy-looking reset in a scratch repository discarded two files that had never
been staged, and so were not in git at all, recoverable only by luck.

**`unclosed-work-guard` reports a floor and says so.** Concurrent sessions can
close on top of each other's unlogged work, so it can under-report. The comment
explains why widening it would be worse: it would have to guess which session
owns which commit, accuse the wrong one, and train the reader to ignore the
alarm.

**`evidence-clause-guard` is the interesting one.** An LLM states a cause, a
coverage claim or a capability in the same confident prose whether it checked or
not, and the seam is invisible in the output. This hook reads the last assistant
message and blocks the turn when a sentence asserts one without carrying its
evidence. It is deliberately biased toward false positives: a false positive
costs one round trip, a false negative costs a wrong cause inside a
recommendation someone acts on.

### 3. Review lenses that are executable, not decorative

Eight reviewers, each with a scope it may not exceed and a shared criteria file
they all read. The separation is the point: a single "review this" prompt returns
one blended opinion, whereas seven bounded ones return seven signals you can
weigh separately.

`demo/review-lenses.mjs` runs them against a real diff, concurrently, with
structured output:

```bash
node demo/review-lenses.mjs --staged --lens cto,comptroller
```

The response schema requires `evidence` and `failure_scenario` on every finding,
and `not_reviewed` on every report. Those fields are the design. A schema that
makes them optional produces "this looks risky", which is work handed back to
the reader rather than work done. Blocking findings set the exit code, so it is
a gate rather than a report.

---

## What is proven, and what is not

Coverage claims are the thing this repository is most opinionated about, so here
is its own, honestly:

| | Status |
|---|---|
| Confidentiality gate | **Proven.** 33 rules self-tested; watched go red on a real leak probe (exit 1) and green after removal (exit 0). |
| `skill-router` | **Proven.** 29 tests, including 14 real working prompts it must stay silent on. |
| `evidence-clause-guard` | **Proven.** 14 tests. Verified non-vacuous by mutation: weakening the CAUSE evidence rule takes the suite from 55 pass to 3 fail. |
| Runner: parsing, criteria, prompts | **Proven.** 12 tests, including one asserting every advertised lens has criteria behind it. |
| Runner: the live API call | **NOT PROVEN.** No credentials were available in the session that wrote it. `runLens` has never executed against the API. |
| Hooks under a live agent harness | **NOT PROVEN HERE.** They run daily in the private system they came from; this repository tests their logic, not their registration. |

The last two rows are the honest edge. They are in the README rather than
discovered by a reader, because "some of this is untested" found on your own is
a different experience from being told.

---

## Provenance

Extracted 2026-09-03 from a private operating system built for a paying client:
a four-business operations platform (~181,000 lines of TypeScript, 274 database
migrations, 560 test files) that the agent and I built and ran together.

**Git history starts at the extraction commit, deliberately.** The source
repository's history references the client throughout, and auditing two years of
commit messages was not feasible. An honest short history beats an unaudited
long one.

The criteria in `agents/lenses.md` carry `S<number>` markers. Those are session
references from that system: each one is a real incident that produced the rule
above it. `docs/INCIDENTS.md` works several through in full. They are left in
because a rule with an incident behind it is a different kind of claim from a
rule someone thought sounded wise.

`reference/dot-claude.gitignore.txt` is the fail-closed allowlist governing what
of a 2.0 GB agent home directory is version-controlled: it denies `/*`, then
allows back eleven named paths. It is included as an artifact rather than as
config, because the reasoning is written into the file.

## Installing the hooks

Hooks register in `~/.claude/settings.json` under the matching event. Each file
documents its own event and its kill switch in the header. They are
independent - take one, take none, take all five.

## License

MIT. See `LICENSE`.
