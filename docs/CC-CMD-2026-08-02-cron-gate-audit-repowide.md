# CC-CMD-2026-08-02-cron-gate-audit-repowide

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-02-cron-gate-audit-repowide.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Why this exists

Two real, independent confirmations of the same structural pattern:
the June 16 2026 Odds API P0 (`handleJournalismCycle` firing
ungated on every cron tick) and today's journalism-cost investigation
(the same function, still ungated, now found again). This is a real
pattern class (see codex `watch-cron-gate-pattern-recurrence`), not a
single bug. The paired CC-CMD (`gate-journalism-cycle-cron`) fixes the
known instance and checks the two other functions sharing its exact
call site. This CC-CMD checks the rest of the repo.

## Task 1 — Re-verify the real, current cron trigger list fresh (Rule 87)

Read `wrangler.toml`'s actual current `crons` array — do not assume
this doc's description (`*/5`, `*/15`, `0 9 * * *`, `0 * * * *`,
`30 * * * *`) is still accurate at execution time.

## Task 2 — Find every function invoked from `scheduled()`

List every function called inside `scheduled()`, real and complete —
not just the ones already discussed in prior CC-CMDs. For each one,
determine: is it gated on a specific `event.cron` value, or does it
run unconditionally on every tick regardless of which cron fired?

## Task 3 — For each ungated function, assess real risk, don't assume severity

For each function found unconditional:
- Does it make an external API call with real cost/quota (odds,
  Gemini, ESPN, BSD, etc.) — if so, this is the same real risk class
  as both prior incidents, flag with real urgency.
- Does it write to D1/KV in a way that could race with itself if two
  ticks genuinely overlap (same concern as the journalism dedup-check
  race) — flag if genuinely plausible, not just theoretically possible.
- Is it idempotent/harmless to run redundantly (e.g. a pure read, or
  a write with a proper dedup check that's actually safe under
  concurrent execution) — if genuinely safe, say so plainly rather
  than flagging it as equally urgent to the ones that aren't.

## Task 4 — Report, do not fix in this CC-CMD

Produce a real, structured list: function name, which cron(s) can
reach it, real risk assessment per Task 3, and whether it's a
candidate for the same event.cron-gate fix. **Do not add gates here**
— this is the audit; any real finding becomes its own, focused
follow-up CC-CMD, matching how the two real, confirmed instances
(odds API, journalism) each got their own dedicated fix rather than
being bundled into a single sweeping change.

## Task 5 — Smoke + verify

- Confirm this repo's real current quality gate passes (report-only
  task, should be a no-op check).

---

## Explicitly NOT in scope

- Do not fix anything found — report only.
- Do not duplicate the paired CC-CMD's work on `handleJournalismCycle`/
  `handleCron`/`sweepKVBriefs` — reference its findings if already
  executed, don't re-investigate from scratch.

---

## Outbox

`outbox/cc-session-2026-08-02-cron-gate-audit-repowide.md`: the real,
complete list of every scheduled()-invoked function, gated or not,
with a real risk assessment for each ungated one.
