# Incidents that became mechanisms

**Most of these already had a written rule against it, and that is the only
reason they are worth reading.** The rule existed, the agent had read it that
session, and the failure happened anyway. Incidents 2, 3, 4 and 5 are that
shape. Incidents 1 and 6 are the other useful shape: a control that was itself
the defect.

The pattern that emerged is narrow and useful: a rule fails when applying it
requires noticing an unpredictable moment. It holds when the trigger is
positional, or when a mechanism removes the need to notice at all.

Each entry follows the same shape: what happened, why the prose rule did not
prevent it, what was installed instead, and how the installed thing was proven.
The proof step is not optional. A check nobody has watched go red is decoration.

---

## 1. The denylist that was itself the leak

**What happened.** This repository needed a check stopping client identifiers
from being published. The first draft wrote its rules as plain regex literals:

```js
{ re: /<clientname>/i, why: "client name" },
```

It failed its own scan on eleven lines. Every rule spelled out, in plaintext,
the term it existed to hide. Shipping it would have published the complete list
of clients along with a helpful label saying which was which.

**Why the rule did not prevent it.** There was no rule. This class is invisible
until the check runs on itself, and most checks are never pointed at their own
source. The near-miss is that the file was one `SKIP` entry away from being
exempted from its own scan on the grounds that it "obviously" contains matches.
That exemption would have created the single location in the tree where a real
leak could sit unexamined, and it would have looked like tidiness.

**What was installed.** Identifying terms are hex-encoded and compiled at
runtime, so no client name exists as text anywhere, including in the rule table.
Structural patterns stay readable, because auditability is their whole value;
only their positive samples are encoded.

**Proof.** A probe file containing a real client name: exit 1, naming
`leak-probe.md:1`. Removed: exit 0.

**The transferable rule.** *A control that must exempt itself has been designed
wrong.* Change the representation, not the scope.

---

## 2. Mutation testing against an uncommitted tree

**What happened.** To check whether a test suite was meaningful, the agent
mutated a source file, ran the tests, and reverted with `git checkout -- <file>`.

`git checkout --` restores to `HEAD`. It does not restore to "before the
mutation". On a committed file those are identical; on a file carrying
uncommitted work they are not, and the difference is silent and destructive. On
an untracked file the command is a no-op, so the mutation survives.

**Three occurrences in four sessions.** The third happened *after* the agent had
read the memory describing the first two, earlier in that same session.

**Why the rule did not prevent it.** The rule said "be careful with destructive
git commands". Care is not a mechanism. The moment requiring care is not
announced, and the operation looks like cleanup.

**What was installed.** Two things. A positional trigger replacing the
judgement: *if the next command is a mutation, the previous one must have been a
commit or a clean `git status`.* And `hooks/block-destructive-git.js`, which
checks the tree and refuses only when something would actually be lost - so it
is invisible during normal work and cannot be trained away.

**The tell, and it generalises.** The signal every time was the failure *count*.
A mutation failing more tests than predicted means the tree is not what you think
it is. Inspect the tree before reading the result as a coverage finding.

---

## 3. Six multi-line strings, four of which reported success

**What happened.** The agent needed to write a multi-line commit message. On a
Windows machine running Git Bash beside PowerShell, the shell rewrote the string:
backticks became command substitution, quoting collapsed, heredocs terminated
early.

It happened six times. **Four of the six reported SUCCESS** or produced a
plausible-but-wrong artifact rather than erroring.

**Why the rule did not prevent it.** The rule named heredocs. The trigger is not
the heredoc, it is the newline - `-m` is just as fatal. Worse, the dangerous
character is the backtick, which is ordinary punctuation in prose the agent emits
constantly and never reads as syntax.

**What was installed.** A rule with no judgement in it at all: *a string
containing a newline never reaches a shell. It goes to a file first, then
`git commit -F <path>`.* No exceptions, no assessment of whether this particular
string looks dangerous, because that assessment is precisely what failed six
times.

**The transferable rule.** *When four of six failures report success, the check
cannot be "did the command work".* Verify the artifact, not the exit code.

---

## 4. Nineteen claims stated at a wider scope than the evidence

**What happened.** Across many sessions, the agent produced sentences of this
shape: "revenue fell because of the online channel", "that path is enforced in
CI", "the tool is unavailable". Each was a real assertion about a cause, a
coverage, a capability or a destination. Each was rendered in exactly the same
prose as a checked claim.

Nineteen recorded occurrences, despite roughly 1,460 words of prose instructing
against it. The damage is not that the claims were wrong; some were right. It is
that **the seam between checked and unchecked was invisible**, so the reader
could not audit any of them, and neither could the agent.

**Why the rule did not prevent it.** The rule asked the agent to notice, while
writing, that a sentence had become a claim. That is a judgement at an
unpredictable moment, which is the exact shape that does not work.

**What was installed.** `hooks/evidence-clause-guard.js`, a Stop hook that reads
the last assistant message and blocks the turn when a claim arrives without its
evidence. Alongside it, a positional trigger that needs no judgement: *if a
sentence names a cause, a coverage, a capability or a destination, the tool call
immediately before it must be the one that checked that thing, and the check goes
into the sentence.*

The hook makes one deliberate trade. It is biased toward false positives: a false
positive costs one round trip, a false negative costs a wrong cause inside a
recommendation someone acts on.

**A corollary, learned separately and painfully.** When caught, make the claim
TRUE, not softer. Editing "merge gate" down to "recommended" still reads as
coverage to anyone skimming. Wire the gate.

---

## 5. An instrument fault that read exactly like a finding

**What happened.** A mutation was applied to check whether a test was
meaningful. The suite reported all-pass. The obvious reading was "the test is
weak" - a real, reportable finding about the code.

The mutation had never applied. The `sed` escaping silently failed. The green run
was measuring unmutated source.

**The tell** was that the confirming `grep` printed nothing, and a missing
confirmation is easy to read as a quiet success. Re-run with an edit that asserts
the pattern exists first, and the same mutation produced six failures.

This has a sibling. An audit command recommended in a project's own
documentation, `git grep -nP '\x{2014}'`, is a *fatal error* on a git built
without PCRE UTF support. A reader running it and taking the failure for a clean
result concludes the tree is clean when nothing was searched.

**What was installed.** *A fresh measurement that contradicts something already
known is an instrument fault until proven otherwise, and pattern syntax is the
usual culprit.* Mechanically: a mutation asserts that it landed before the result
is read, because **a mutation that fails to apply is indistinguishable from a
check that fails to fire.**

**Proof this one is live.** It fired during the construction of this repository.
A test-count grep printed nothing; that empty output was treated as an instrument
fault rather than a pass, and re-running produced the real numbers.

---

## 6. The guard that blocked ordinary code, found while building this repository

**What happened.** Mid-way through assembling this repository, a command was
refused with a message about reading a secrets file. The command read an
in-process environment variable and touched no file at all.

`block-env-read` detects the literal token `.env` anywhere in a tool call. The
expression `process` + `.env` contains that token. So the guard fired, correctly
by its own rules, on the single most common way any Node program reads
configuration.

**Why this is worse than it looks.** The guard was not wrong about its pattern;
it was wrong about its cost. **A secrets guard that fires on ordinary code gets
uninstalled**, and an uninstalled guard is strictly worse than no guard, because
the rulebook still claims the coverage. The same logic that makes
`block-destructive-git` fire only on a dirty tree applies here and had been
missed.

**What was installed.** A lookbehind requiring a non-identifier character before
the token, so a real path still matches and a property access does not. Plus 25
tests weighted deliberately toward the MUST-NOT-BLOCK half, because the
false-positive rate is what decides whether the hook survives.

The fix opens a gap: an env file named with no separator before the dot no
longer matches. That is written into the header rather than left silent.

**Proof.** Reverting the lookbehind: 22 pass, 3 fail. Restoring it: 25 pass.

**Two smaller things fell out of the same hour, and both are the doc's own
lessons firing on their author.** The mutation script's first version replaced
the first occurrence of the guard in the file, which was a *comment quoting it*,
not the code - and the assert-it-landed check from incident 5 caught that and
refused to report a result. Separately, a test fixture listed a destination
filename as safe when it did contain a protected token; the hook was right and
the fixture moved.

---

## 7. The rung ladder

The rule that came out of all of the above, and the one that changed the most
behaviour:

> **A bug is not closed by the patch. It is closed by the check that would have
> caught it, installed at the cheapest stage that can see it, and proven by
> reverting the fix.**

Cheapest means earliest and most automatic:

| Rung | Mechanism |
|---|---|
| 1 | **Make it unrepresentable** - a narrower type, `NOT NULL`, a `CHECK` constraint, a required argument. The defect becomes a compile or insert error. |
| 2 | A compile or lint rule |
| 3 | A unit test **on the property that failed**, not on the line that was edited |
| 4 | An integration test, when the defect lives in a seam |
| 5 | A gate step, for things a test cannot express |
| 6 | CI, when the check is too slow or environment-dependent for local |
| 7 | A runbook step or human check |

Rung 7 is where you **land** when nothing above can see the defect. It is never
the default, and choosing it means saying out loud which higher rungs were ruled
out and why.

The proof is one command: revert the fix, run the check, watch it go red, restore
the fix, watch it go green. Commit before reverting anything, per incident 2.

**And when a defect class genuinely has no mechanical rung** - transcription,
taste, brand judgement - say so out loud and record the human step. Silence about
an unguarded class reads as coverage. That is why this repository's README lists
what is not proven, and why the confidentiality gate ends with a `KNOWN LIMITS`
block rather than a clean bill of health.
