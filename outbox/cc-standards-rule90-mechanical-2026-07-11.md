# Rule 90 Mechanical Version — TASK 3 (field-relay-nba portion) — 2026-07-11

## Scope

TASKS 1-2 (replace Rule 90's self-report text with the mechanical
version, register Rule 89 in the codex) target jubilant-bassoon. This
session executed **TASK 3 only** — the field-relay-nba 14-day
staleness CI check.

## Drift found and corrected before writing code

TASK 3's text says to reuse "the exact same D1 query pattern and step
structure the confidence-gate check already established." Checked
directly: the confidence-gate step (`Check for confidence-gate
violations`) does **not** query D1 at all — it operates entirely on
`git log`/outbox-file grep. This CC-CMD's own description is
inaccurate on this point. The real, working D1-query-from-CI precedent
in this repo is `verify-pending-checks.yml`'s `/d1/execute` +
`X-FIELD-Relay: field-relay-cron-2026` pattern — the same one this
session's own immediately-prior CC-CMD (Rule 89 collision resolution,
TASK 5) already used and proved out (including fixing a real
Cloudflare-edge 403 caused by a missing `User-Agent` header on a bare
`urllib` POST). Reused that exact, already-tested pattern here rather
than inventing a third one or forcing a fit to the confidence-gate
step's actually-unrelated git-log approach.

## Real, live state check before building anything

Queried the actual codex `rule-registry` category directly:

```sql
SELECT key, title, updated_at FROM codex
  WHERE category = 'rule-registry' AND title LIKE 'UNEXERCISED%';
-- rule-89 (updated 17:48:45), rule-91 (updated 18:09:41),
--   rule-90 (updated 18:42:03) -- all three present, all <1 day old
```

Worth noting: `rule-90` itself is now registered — it was missing when
the Rule 89 collision-resolution CC-CMD's TASK 5 was executed earlier
tonight (that outbox flagged this as a genuine open gap, deliberately
not resolved there since fixing it would have been scope creep on a
different task). It has since been registered, presumably as part of
this same CC-CMD's TASK 2 (jubilant-bassoon-side) or a related session.
Not independently re-verified which — out of this task's scope to
confirm, noted only because it resolves an ambiguity flagged in the
prior outbox.

## Implementation

Added `Rule 90 staleness check` to `post-deploy-live-verify.yml`,
positioned after the just-added `Rule registry check` (Rule 89
collision-resolution TASK 5) and before `Commit results` — same job,
same file, no new workflow created. The two checks are distinct,
complementary concerns sharing the same D1 access pattern: the Rule 89
check catches "a rule number exists with no registry entry at all";
this one catches "a rule is registered but has sat UNEXERCISED past 14
days."

```sql
SELECT key, title, updated_at,
       (julianday('now') - julianday(updated_at)) AS days_old
FROM codex WHERE category = 'rule-registry' AND title LIKE 'UNEXERCISED%'
```

Any row with `days_old > 14` fails the step (exit 1, prints key + title
+ age); zero stale rows passes silently — matching the confidence-gate
step's pass/fail behavioral pattern (a violation blocks the downstream
`Commit results` step, exactly like a confidence-gate violation already
does today), even though the underlying query mechanism itself is
different (D1, not git log), for the reason explained above.

## Live Verification — both cases, real infrastructure

Via a temporary GitHub Actions workflow (`rule90-staleness-test.yml`,
`push`-triggered, deleted after verification):

**Positive case — real stale row, inserted directly into the live
codex table, must fail:**

```sql
INSERT INTO codex (key, category, title, content, status, updated_at)
  VALUES ('rule-test-999-stale', 'rule-registry',
          'UNEXERCISED -- Rule 999: scratch test for staleness check',
          '{"test":true}', 'open', datetime('now', '-20 days'));
```

Real run result:
```
Checked 4 UNEXERCISED rule-registry entries.
RULE-90 STALENESS VIOLATIONS (UNEXERCISED > 14 days):
  rule-test-999-stale: UNEXERCISED -- Rule 999: scratch test for staleness check
    (updated_at=2026-06-21 18:48:11, 20.0 days old)
[exit code 1]
```

Correctly flagged only the deliberately-stale scratch row — the three
real, fresh entries (89/90/91, all <1 day old) were correctly not
flagged, in the same run.

**Test row deleted** (`DELETE FROM codex WHERE key =
'rule-test-999-stale'`), confirmed via read-back.

**Negative case — same check, re-run after cleanup, only real fresh
entries remain, must pass:**

```
Checked 3 UNEXERCISED rule-registry entries.
No stale UNEXERCISED rule-registry entries found.
[exit code 0]
```

Both cases run against the real deployed relay and real D1 database —
not simulated, not asserted from code review alone.

## Cleanup

Temporary `.github/workflows/rule90-staleness-test.yml` deleted. The
scratch `rule-test-999-stale` codex row deleted before the negative
test ran (confirmed absent, not just assumed). The permanent step lives
only in `post-deploy-live-verify.yml`.

## Confidence Score (field-relay-nba)

```
+25  CI step added to the correct existing workflow
     (post-deploy-live-verify.yml), correct job (verify), correct
     placement (alongside the confidence-gate step and the just-added
     Rule 89 registry-existence check, before Commit results)
+25  Real D1 query against the actual rule-registry category -- reused
     the genuinely-established /d1/execute + X-FIELD-Relay pattern
     (verify-pending-checks.yml, and this session's own immediately-
     prior Rule 89 check), not the confidence-gate step's git-log
     approach, which this CC-CMD's own text inaccurately described as
     the same mechanism -- corrected via direct source read, not
     assumed
+25  Positive test case: a real stale row inserted directly into the
     live codex table, confirmed to fail the check with the correct
     key/title/age printed, real fresh entries correctly not flagged
     in the same run
+25  Negative test case: same check re-run after the stale row was
     deleted, confirmed to pass cleanly against only the real fresh
     entries; test row's absence confirmed via read-back before the
     negative run, not assumed
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits

- `3e5ed12`, `936d800` — temporary test workflow (positive case, then
  re-triggered for the negative case after test-row cleanup)
- (this commit) — the real, permanent step added to
  `post-deploy-live-verify.yml`; temporary test workflow removed; this
  outbox
