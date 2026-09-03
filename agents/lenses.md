# Review Lenses - Canonical Criteria

Single source of truth for the eight review lenses (PLAN, CTO, CFO, CMO, COO,
DPO, DB, COMPTROLLER).
Both the harness that dispatches reviews inline and the
`agents/<lens>-review.md` agents (spawned for high-stakes work) read
THIS file. Never copy these lists elsewhere - link here.

Report format (all lenses): end with one verdict -
`APPROVE` · `APPROVE-WITH-NITS` · `CHANGES-NEEDED` - followed by specific
`file:line` findings. Nits are optional improvements; CHANGES-NEEDED blocks ship.

**PLAN is the one exception.** It runs before any code exists, so it reports two
tables and ends with `BLOCKED` · `OWNER-DECISION` · `APPROVE`. See
`agents/plan-review.md`.

**Model tier tracks how OPEN-ENDED a lens's criteria are, not how important its
domain is (S312).** Every gotcha written into this file moves reasoning out of
the model and into the text, which makes a cheaper model sufficient. `db-review`
carries the longest section here, 43 lines of named traps each with its exact
verification method, and on sonnet it has zero recorded misses since 22-07-2026:
it independently matched opus `cto-review` on the same defect, and wrote a
`SET LOCAL ROLE` probe that ATTEMPTS the call rather than reading grant tables,
which is stronger than the criteria asked for. `cto-review` takes opus because
"no needless coupling" prescribes nothing and the model supplies all the
judgment. `plan-review` takes opus for the same reason: its design-challenge
check is the one open-ended criterion in this file. **Do not read section length
as difficulty. It is closer to the inverse.**

---

## PLAN - the plan itself, before any code  (whenever a written plan exists)

Grounds the PLAN against the codebase that already exists. It does NOT re-verify
the request's premises, which `ambiguity-closer` already grounded, and it says
nothing about code that does not exist yet.

### 1. Collision  (verifiable, BLOCKS)

- Does the plan's chosen TECHNIQUE break existing tests, fixtures or helpers?
  Grep for the helper, fixture builder or clock source the approach depends on
  and COUNT the call sites. S309: a restart date written as an inline SQL literal
  collided with `istDayBounds().businessDate` and `addDays(TODAY, -N)` plantings
  **61 times across 5 suites**, and on the boundary date the property under test
  could not be written at all.
- Does it collide with an in-flight lane? Check the plan's touched files against
  other worktrees and open branches.
- **Does the plan's seam create its own hole?** A boundary made overridable by
  tests means no test then exercises the shipped value. That needs a source
  ratchet plus a mutation that changes the shipped value and must go red.

### 2. Prior art  (verifiable, BLOCKS)

- Does this already exist, whole or in part? Search by SURFACE, not by term
  (S275): route paths, component names, RPC names, column names, user-visible
  strings.
- S307: a false claim in `CLAUDE.md` sent a session to build something already
  built. **A doc saying a thing is absent is not evidence that it is absent.**
  Grep the code.

### 3. Design challenge, bounded  (judgment, OWNER DECISION)

Fires ONLY on plan decisions touching **money, persisted state, or apply/deploy
ordering**. Not naming, not structure, not style.

- Trace what the code ACTUALLY does on every arm the decision creates, including
  the arm nobody described. S309 D4: the fallback took the prior NUMBER but left
  `v_has_prior` false, so the cash window still jumped to IST midnight and the
  gap takings landed in NEITHER the opening NOR the takings.
- Name every arm the predicate **cannot distinguish**. If the plan would need to
  know which arm an earlier write took, that is STATE (S288), and state means a
  column the plan has not asked for.
- Ordering: does the plan state where the migration sits relative to the merge,
  and name the breakage window between apply and deploy?
- R1: does every money or data path in the plan arrive with a test in the plan?
- R8: does the plan change any behaviour, default, sign or mapping the owner did
  not ask about? Call it out before it is built, not after.

---

## CTO - correctness & architecture  (always applied)

- R1: money/data-path changes ship with an automated test.
- R2: non-obvious runtime architecture (queues/workers/schedulers) has a self-check.
- R6: changes to a shared schema/contract are checked against the other consumer.
- R7: Realtime/SSE/WS does not gate initial page load.
- Definition of Done satisfied: the works / safe / clean checklist the project keeps.
- Architecture: clear boundaries, focused files, no needless coupling.
- Tests: cover happy path + error + empty; assert behaviour, not implementation.
- **Hand off to COMPTROLLER** if this change computes, displays, reconciles or
  approves a money figure, or touches a control / approval chain / ledger read.
  That is a different question from "is the code correct" and it is not yours.
  This line lives in the ALWAYS-APPLIED section on purpose: `coo-review` was never
  dispatched once in 165 sessions (S258 usage audit) because a lens triggered by a
  subject category needs the orchestrator to self-classify into it. A new lens
  nobody fires is worse than no lens, because the trigger table then claims
  coverage that does not exist.

## CFO - cost & unit economics  (when cost / recurring ops touched)

- Every recurring operation (poll/cron/timer/subscription) has a Cost Model in the
  plan: `ops/sec × bytes/op × seconds/day = bytes/day` vs the free-tier allowance.
- Free-tier impact named (Supabase egress/DB/MAU, Vercel, Sentry, Resend, Anthropic).
- Event-driven preferred over polling; any polling is explicitly justified.
- External API/product confirmed activated on the account (not just documented).
- Growing tables have a retention policy.

## CMO - brand & conversion  (when public UI / customer copy touched)

- Brand tokens from the project design system honoured; no generic AI-default styling.
- Every page has one clear primary CTA; no dead-end pages.
- Mobile-first (the customers are on mobile).
- Copy is on-voice; business facts exact (tagline, phone, hours - never invented).
- SEO/meta present where it's a public page.
- Loading + empty states are friendly, not blank.

## COO - operations & runbook  (when deploy / infra / recurring ops touched)

> Severity ladder, solo-operator response loop, PIR template, and the full
> alert-coverage checklist live in `references/coo-playbook.md`. Load it when an
> incident is in progress or when the change adds a recurring op / money path /
> external dependency.

- Migrations apply to the DB BEFORE the deploy that needs them (never inverse).
- Runbook / daily-ops notes updated if the operational surface changed.
- Rollback path exists and is stated.
- Monitoring/alert covers the new failure mode (heartbeat, Sentry, dashboard).
- Incident-handoff implications noted if a shared service (bot/DB) is affected.

## DPO - data protection & consent  (when marketing sends / consent / customer-data export or import touched)

Added S258, ahead of CRM Slice 2 (the WhatsApp sender). India DPDP Act 2023 +
Meta WhatsApp policy are the frames; the `dpdp-readiness` skill holds the full
assessment method when a deeper pass is needed.

- Suppression is enforced at the DB layer, not only in app code; a send to a
  suppressed number must be IMPOSSIBLE, and phone normalization happens inside
  the enforcement point (the S256 `marketing_suppression_list` lesson).
- Third-party / cold-sourced contacts (`contact_source` `Cold:` prefix) are
  excluded from any audience by DEFAULT; inclusion is an explicit per-campaign
  owner opt-in with the deliverability + DPDP trade-off restated.
- Consent events are append-only with provenance (`notice_version`, proof,
  timestamp); nothing rewrites or deletes a consent/opt-out row.
- Every send path honours STOP/opt-out, and the opt-out write path is fail-safe
  (a malformed write suppresses; it never fails open).
- Data minimisation on any export: only the fields the purpose needs; CSV
  formula-injection guarded; no PII in logs, receipts, or share cards beyond
  what the surface requires (exact-key-set tests pin it).
- Erasure path (DPDP data-principal rights) still works after the change:
  tombstoned/erased contacts stay excluded from audiences and exports.
- Retention stated for any new personal-data table (Growing Tables Inventory row).

## DB - Supabase migration & grant safety  (when a migration / RLS / SECURITY DEFINER fn / role grant changes)

The Supabase-specific gotchas that have bitten this system 6+ times. The generic
correctness/architecture review is CTO's; this lens is the DB specialist and
fires ALONGSIDE cto-review on any migration. Verify on the LIVE DB where SQL
access exists; PGlite cannot catch the safeupdate or default-privilege issues.

- **Grants, BOTH directions (S135 + S230).** Every new `public` function gets
  EXECUTE granted to `anon`+`authenticated` at creation by Supabase default
  privileges; `REVOKE FROM PUBLIC` does NOT remove those direct grants. Any
  service-role/bot-only function MUST `REVOKE EXECUTE FROM anon, authenticated`
  explicitly. This covers EVERY function the migration creates (triggers and
  pure helpers too), not just the SECURITY DEFINER RPCs. Then verify BOTH
  directions: `anon=false`/`authenticated=false` AND `bot=true`/`service_role=true`
  for every role the migration grants (S230: a one-directional sweep stripped
  `bot`+`service_role` and caused a ~9,400 calls/hour outage). Use
  `has_function_privilege` on the live DB.
- **No WHERE-less UPDATE/DELETE (S130).** The `authenticator` role preloads
  `safeupdate`, which rejects unqualified writes even inside SECURITY DEFINER
  and even on temp tables. Use a real column predicate (`WHERE col IS NOT NULL`);
  `WHERE true` is constant-folded away and still rejected. PGlite has no
  safeupdate, so only a live RPC call catches it.
- **Migrate before deploy (S142).** The migration applies to the DB BEFORE the
  deploy that needs it. A `DROP FUNCTION` / re-signature / changed `RETURNS TABLE`
  shape couples apply to deploy (old route breaks after apply, new route breaks
  before it): state the expected breakage window and pick a low-traffic moment.
- **RLS + CHECK at creation.** RLS enabled in the same migration that creates the
  table; enum-like string columns carry a DB CHECK constraint.
- **Idempotency + no editing applied migrations.** Never edit a previously
  applied migration except to make a `CREATE ROLE` / `CREATE OR REPLACE FUNCTION`
  idempotent (Supabase never re-runs an applied version), **or to guard a closing
  `DO $$` POST-CONDITION so it skips when its subject data is absent** (added S415,
  concern #160). Schema-effecting edits (columns, data, policies) stay forbidden:
  write a new migration. Two notes on the post-condition case: a later migration
  **cannot** repair a failing one, because the test harness replays in sorted order
  and aborts on the first error, so anything numbered after it is unreachable; and
  a `DO` block leaves no `pg_proc` artifact, so the `prosrc` md5 check that proves a
  function edit did not drift from live **does not apply** - git history is the only
  record of what executed, so verify such an edit by reading the whole diff.
- **Ledger truth (#45).** Apply via the Supabase MCP so `schema_migrations` stays
  honest; if applied via the SQL editor, insert the bookkeeping row (version +
  name) so future tooling that diffs repo migrations against live is not lied to.
- **R6 shared contract.** Website + bot share one DB; a schema/grant change on
  either side is checked against the other consumer before shipping.
- **Housekeeping.** Migration filename `YYYYMMDDHHMMSS_verb_noun_context.sql` with
  a comment header block; `database.ts` is surgically widened for the new column,
  never full-regenerated mid-feature (a live regen drifts unrelated columns, S138).
- **R1.** A money/data-path migration ships with an automated test; note in the
  review that PGlite cannot exercise safeupdate/grants, so the live verification
  is the real gate.

## COMPTROLLER - accounting treatment & control design  (when a change computes, displays, reconciles, or approves a money figure, or creates/modifies a control, an approval chain, or a ledger read)

The seam, which must stay sharp or this becomes a lens people skip: CTO owns "is
the code correct", CFO "what does it cost to run", DB "is the migration safe".
**This lens owns "is the figure right, and is the control real".** Code that
computes the wrong quantity correctly is this lens's; code that computes the right
quantity incorrectly is CTO's.

Measured 2026-08-29 before this section was added: `reconcil`, `separation of
duties`, `internal control`, `misclassif`, `audit trail`, `approval` and `control`
returned **zero matches** across the whole of this file and `SKILL.md`. The one
`ledger` hit was line 184, the migration ledger (`schema_migrations`), a different
referent. Nothing below was previously covered anywhere.

- **The figure's population is stated where it prints.** A money total names what
  it counts and what it excludes. A number whose denominator is one population and
  numerator another is the single most repeated defect class in this repo's own
  history; an unstated filter reads as coverage.
- **Classification.** Money is booked to what it IS, not to the nearest available
  bucket. A category chosen because no better one exists is a finding, not a
  workaround (a real finding: several thousand rupees of delivery revenue filed
  as generic income at three sites, because no delivery-income account existed).
- **Completeness of record.** A screen that reports "all" of something reads EVERY
  ledger that holds it. Two ledgers under one heading, or one heading over one of
  two ledgers, both mislead (S447: a money screen that had never read one of two
  ledgers while its own footer admitted it).
- **The control can fail.** A control whose passing outcome is the only outcome its
  inputs can produce is ceremony. Ask what a failure would look like in the data,
  then ask whether that shape has ever occurred (concern #144: 93.5% of courier
  drawer closes balance to exactly Rs 0 and three branches have never been a rupee
  out - to a controller that is the textbook tell that the reconciliation is not
  being performed, not that it always passes).
- **Separation of duties.** The person who records a transaction is not the person
  who approves it, and a single account cannot hold both roles. Check whether the
  approval chain still has two heads after the change (S446: D5 permits a
  single-signature cash close, and its written premise had expired before it
  shipped).
- **Exception path.** Every reconciliation defines what happens when it does NOT
  balance, and that path is reachable by the staff who hit it. A control with no
  exception path trains people to force the match.
- **Cut-off.** A figure attributed to a period was earned or spent in that period.
  Entry date and effective date are different columns and the screen says which it
  used (concern #102: counter spend entered in one IST month but dated to a
  previous one is invisible in every money screen).
- **Model tier.** `opus`, and NOT for the reason "money is important" - by this
  file's own rule, tier tracks how OPEN-ENDED the criteria are. "Is this control
  real" prescribes no procedure and the model supplies the whole judgement, which
  is the same reason `cto-review` and `plan-review` take opus. Every trap named
  above moves reasoning out of the model and into this text; if this section grows
  the way `db-review`'s did, re-argue the tier down.
- **Deeper method.** `skills/comptroller/` holds the built library (108 concepts,
  17 core reference files) behind Door 1. This lens does not load it - it is
  shell-less and budget-bound. When a finding needs the depth, name the concept and
  hand back to a `/comptroller` invocation.
