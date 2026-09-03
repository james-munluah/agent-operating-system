# Case study: operating a production system with a coding agent

**Anonymised.** The client is not named and no figure here identifies them. The
purpose is to describe the operating model that produced this repository, and to
be honest about which parts of it worked.

---

## The system

A four-line operations platform for a small group of businesses in India:
laundry, courier, a diner, and property. One web application plus a separate
messaging bot sharing a database.

| | |
|---|---|
| Application | ~181,000 lines of TypeScript across ~1,100 files |
| Tests | ~560 files, run against an in-process Postgres that replays every migration |
| Database | 274 migrations |
| Commits | ~2,600 |
| Team | One person, plus a coding agent |
| Duration | 2026-04-02 to 2026-09-03: 5.1 months, 131 active days of 155 |

The stack is unremarkable and deliberately so: Next.js, Postgres, a managed
host. The interesting part is not the architecture. It is that a single
developer ran four live business lines, with real money moving through them,
using an agent as the primary implementer.

---

## What actually made it work

### Sessions with a protocol, and a log with holes in it

Every working session begins by reading the project's state file and its recent
history, verifying the local checkout is not behind the remote, and printing a
loaded-state block. Every session ends by writing a log entry.

The useful part is what happened when that failed. Eighteen session numbers
accumulated with shipped work and no log entry. Nobody noticed until someone
counted, and the counting was only possible because the convention was
mechanical enough to count against.

The fix was not discipline. It was `hooks/unclosed-work-guard.js`, which derives
"commits since the last close" from git at session start. It has a known blind
spot, documented in its own header: concurrent sessions can close on top of each
other's unlogged work, so it reports a floor rather than a ledger.

There is a second lesson buried in that guard's first draft. An unconditional
"claimed but not logged is a failure" would have been red through the middle of
*every* session, because a session claims its number at its first commit and logs
it at its last. It was chained into the test command, so it would have blocked
the test suite for every concurrent session on the machine. **The highest claimed
number is therefore exempt and everything below it is not**, which delays
detection by exactly one session and is the price of telling "unfinished" apart
from "abandoned" with no clock and no network.

### Review lenses that fire by risk class

Seven bounded reviewers rather than one general one, dispatched by what the
change touches: money paths and migrations get the correctness and database
lenses, customer-facing copy gets the brand lens, anything with consent in it
gets the data-protection lens.

**The measurement that justified this**: one lens had never been dispatched once
in 165 sessions. A lens triggered by a subject category needs the dispatcher to
correctly self-classify into that category, and it silently does not. The fix
was to move the hand-off instruction into the always-applied lens's own criteria,
so the reviewer that always runs is the thing that names the one that should.

**A lens nobody fires is worse than no lens**, because the trigger table then
claims coverage that does not exist.

### Model tier tracks how open-ended the criteria are

Counter-intuitive and measured. The longest, most detailed lens - 43 lines of
named traps, each with its exact verification method - runs reliably on a
mid-tier model with zero recorded misses. The shortest one needs the most capable
model, because "no needless coupling" prescribes nothing and the model supplies
all the judgement.

Every gotcha written into a criteria file moves reasoning out of the model and
into the text. **Section length is closer to the inverse of difficulty.**

---

## What did not work

Being honest about this is the point of the document.

**Prose rules.** Several thousand words of them. The failure rate on rules
requiring the agent to notice an unpredictable moment was high enough that
`docs/INCIDENTS.md` exists to record the pattern. Nineteen occurrences of one
claim-inflation class, six of one shell-quoting class, three of one
destructive-git class in four sessions.

**A state file that grew past its own purpose.** The project's primary context
file was designed as a catalog that routes and does not hold content. It was
restructured twice for size and regrew both times, ending at more than double
its post-restructure size. The regrowth was always in the same block: the live
work queue, which was the one block with nowhere to move a finished item to.
**A structure with no exit path for completed items will regrow, regardless of
how carefully it was cut.**

**Verification of anything visual.** At one point twenty consecutive shipped
changes carried the same open item: nobody had opened the screen in a browser.
The test harness had no DOM, so no test could execute a render site, and the
gap was recorded honestly each time and closed by nobody. Recording an unguarded
class is necessary and is not the same as guarding it.

**CI.** For a long stretch the pipeline had never run green - blocked first on
billing, then on a dependency advisory. Merges were gated on local checks and
preview deployments instead. The lesson recorded at the time: *watch a run go
green before writing a sentence that says a gate is enforced.*

---

## The thing I would tell someone starting this

Three ideas carried more weight than everything else.

**1. Write the check, not the rule.** When an agent gets something wrong, the
instinct is to add a sentence to the instructions. Measured over dozens of
incidents, that mostly does not work. Ask instead: what is the cheapest stage
that could have caught this - a type, a lint rule, a test on the property, a
gate step? `docs/INCIDENTS.md` has the ladder.

**2. Make the trigger positional.** Rules of the form "be careful when X" fail
because X is not announced. Rules of the form "if the next command is a
mutation, the previous one must be a commit" work, because the condition is
visible without judgement.

**3. Name what you did not check, in the same breath as what you did.** This is
the highest-value habit of the three, and the hardest. An agent will state a
cause, a coverage claim or a capability in exactly the same confident prose
whether it verified it or not. If the seam is invisible, everything downstream
is unauditable. This repository's own README carries a table of what is proven
and what is not, for that reason.

---

## What this repository is

The mechanisms, extracted and generalised: the hooks, the review lenses, the
runner that makes them executable, and the confidentiality gate that had to be
redesigned when it turned out to be leaking the thing it protected.

The application code is not here and will not be. It belongs to the client.
