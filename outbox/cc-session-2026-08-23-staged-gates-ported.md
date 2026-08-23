# The staged gates, ported from field-laboratory — 2026-08-23

## What was exposed here

**55 files in this repo contain the word STAGED. Four things checked anything**
— and not one of those four had ever been demonstrated to fail. They ran daily,
printed `PASS` or `PENDING`, and nothing established that a genuine regression
would make them say otherwise.

field-laboratory registers its staged items against those four by id, and this
repo's CC-CMDs cite them as done conditions. They are the executors everything
points at.

## Two gates, one idea

A claim nothing checks, and a check never shown to fail, are the same defect in
different clothes: **something that can only ever report success.**

### 1. `staged-verdicts-check.mjs` — every verdict must be falsifiable

The four verdicts were inline ternaries inside `add({...})` blocks in
`verify-staged-items.mjs`, so there was nothing to exercise without a live D1
round trip. They now live in `scripts/staged-verdicts.mjs` as pure functions,
**copied not rewritten** — same branches, same order, same strings. A verdict
that changed while being extracted would break the thing it protects, and the
extraction is the last place anyone would look.

`verify-staged-items.mjs` imports them, so there is one copy of each decision.

Each declares `mustFailOn`, a payload it must not call `PASS`:

| verdict | negative control |
|---|---|
| `closing_after_opening` | 8 pairs, 0 sequenced — the pre-fix condition |
| `soccer_opening_coverage` | EPL at 10% against a 23.1% baseline |
| `epl_brief_event_grounded` | a post-fix recap still carrying a leaked literal |
| `recap_names_a_scoring_play` | 6 testable recaps, none naming a scorer |
| `thread_notes_cleanup` | 37 of 40 notes long past expiry, still present |

**And each must also be able to reach `PASS`.** That is the mirror defect, and
it is the one the laboratory's brief-contamination predicate actually had:
permanently red, so nobody could act on it. A verdict that can never pass gets
ignored exactly like one that can never fail.

15 assertions. A missing `mustFailOn` is itself a failure — optional would make
it the field nobody fills in, which is how Rule 89's "specify an artifact" became
prose.

### 2. `staged-verifier-check.mjs` — every staged claim must name an executor

Ported with the repo prefix inverted: `relay/…` ids resolve locally against
`staged-verdicts.mjs` and their workflow must carry a `schedule:`; `lab/…` ids
are well-formedness only. Each repo verifies its own executors and neither
pretends to verify the other's.

## It found a real orphan on its first run

```
docs/cc-session-2026-07-20-game-thread-relay.md:
  - **STAGED** — fires at next :30 mark post-deploy
```

**34 days.** The `30 * * * *` cleanup cron has fired roughly **816 times** since
that line was written, and nobody looked — because nothing was going to. Its
unblock condition was a future event, and nothing re-evaluated whether the event
happened. The identical shape that left `closing-odds-capture` two days past its
own `PASS`, except this one sat for a month.

**It is check 5 now**, not a tagged hole. `thread_notes_cleanup` asks daily
whether rows past `expires_at` are still present, with a one-hour grace window —
the sweep fires at :30, so a row that expired four minutes ago is not evidence of
anything. Only rows expired longer than the cron's own interval can testify.

`game_thread_notes` was added to `/d1/execute`'s `ALLOWED_TABLES` for the read.

## Not ported, and why

**The pre-commit outbox guard.** `.githooks/` does not exist here, and this
repo's Rule 67 is a per-session outbox document, not laboratory's per-commit
source/outbox pairing. Porting it would impose one repo's rule on another that
has a different one. Stated rather than dropped silently.

## Verified

- `staged-verdicts-check.mjs` — 15/15, both directions per verdict.
- `staged-verifier-check.mjs` — 10/10 self-test; **0 orphans** against `docs/`
  after tagging, 1 before.
- `node --check` on all three touched files.
- Both wired into `deploy.yml` as blocking steps.

## Open

Nothing deferred. If a sixth failure kind appears it is a finding, not a
limitation that was known and left standing.
