# completion-trigger Sticky Tag Fix — 2026-07-12

## Re-confirmed the reported regression live before touching anything

`SELECT source FROM briefs WHERE id = 'game_recap_mlb_401816130'` — the
exact row the prior CC-CMD (`completion-trigger-close`) verified live as
`source='completion-trigger'` — now shows `source='cron'`, real
`word_count`/`brief_text` changed too. Confirms CONTEXT's claim directly,
not by trusting the doc.

## TASK 0 — Probe (found a second occurrence, investigated rather than assumed relevant)

`grep -n "ON CONFLICT(id) DO UPDATE SET" -A5 src/index.js` surfaced **two**
clauses that unconditionally do `source = excluded.source` on conflict,
not one:

1. **Line 14071** (queue consumer, `type:'game-brief'` handler, the same
   one TASK 1/2 of `completion-trigger-close` touched) — `id` is
   server-constructed as `` `game_recap_${sport}_${eventId}` ``. This is
   the confirmed culprit: this handler fires from any of the 6 real
   `game-brief` enqueue sites, so an ordinary journalism-cron pass for a
   game that had already gone final (and had already been
   completion-triggered) can legitimately re-fire for the same id with
   `source` unset, defaulting to `'cron'` (per the prior CC-CMD's own `??
   'cron'` fix), clobbering the tag on write.
2. **Line 9236** (`POST /archive/brief`, client-driven — jubilant-bassoon's
   `archiveBrief()`-style fire-and-forget archival). `id` here is
   **client-supplied**, not server-constructed, so it's only a real risk
   if the client ever sends an id colliding with the
   `game_recap_{sport}_{gameId}` pattern. Checked directly against
   jubilant-bassoon's live source (`mcp__FIELD_Handoff__read_source`,
   repo=jubilant-bassoon) for `archiveBrief`, `/archive/brief`, and
   `game_recap` — all three return zero hits in `index.html`; every hit
   is in historical planning docs only. The client does not currently
   call this route with a colliding id. **Not fixed here** — genuinely a
   different, currently-inert risk (Rule 69: don't touch a route that
   isn't implicated in the confirmed bug, matches the doc's own "one SQL
   clause" scope) — flagged as a real, related follow-up if this route's
   client usage ever changes.

(A third `'game_recap'` site, line 4686, uses a hardcoded `source =
'kv_sweep'` literal — no dynamic overwrite risk, not relevant. A fourth
site, line ~9035-9039, the `/archive/game` KV-brief-capture block, uses
`ON CONFLICT(id) DO NOTHING` — structurally cannot overwrite an existing
row at all, ruled out.)

## TASK 1 — The fix

```sql
source = CASE WHEN briefs.source = 'completion-trigger' THEN briefs.source ELSE excluded.source END
```

Applied to line 14071 only (the confirmed clause). `brief_text` and
`word_count` remain freely overwritable on every conflict — a
completion-triggered brief's *text* can still legitimately refresh on a
later pass; only the *provenance tag*, once true, is now permanent.

## TASK 2 — Real write-after-write test (not code review alone)

Deployed the fix (`24c4000`, confirmed live via the real
`deploy.yml` run). Picked a real row already in `briefs`
(`game_recap_pga tour_golf_401811955_R4`, real PGA Tour recap,
`source='cron'`) — captured its exact original state first for
restoration.

```
1. UPDATE briefs SET source='completion-trigger' WHERE id=... -- changes:1

2. Simulated the exact cron-path INSERT (identical SQL to the deployed
   fix, run directly via D1 -- the CASE logic is pure SQL and behaves
   identically whether invoked through the Worker or directly, so this
   is a real test of the actual logic, not a mock) with a different
   brief_text ('TEST CRON OVERWRITE...') and source='cron':
   -- changes:1 (row updated, not rejected)

3. Re-queried:
   source: "completion-trigger"   <- STUCK, did not revert to 'cron'
   brief_text: "TEST CRON OVERWRITE - verifying sticky source tag..."
   word_count: 12                 <- DID refresh to the new write

   Proves both directions in one real test: the tag survives a later
   conflicting write, while content still updates normally -- exactly
   the CASE expression's intended behavior, confirmed live, not assumed
   from reading the SQL.

4. Restored the row to its exact original state (brief_text, model,
   quality_score, context_hash, word_count, source all set back to the
   captured originals) -- re-queried afterward, byte-for-byte identical
   to the pre-test state. No test data left in production.
```

`node --check src/index.js`: clean.

## Not done, flagged only (out of this CC-CMD's scope)

`game_recap_mlb_401816130` (the real row this whole investigation started
from) still shows `source='cron'` — genuinely was `'completion-trigger'`
at one point (independently verified live in the prior CC-CMD), but this
CC-CMD's scope is fixing the *mechanism* going forward, not correcting
historical data. Restoring it would be a one-line UPDATE if wanted, but
wasn't asked for here — flagged rather than done unprompted (Rule 69).

## Confidence Score

```
+15  TASK 0 probe run for real; found a second, structurally-similar
     clause and investigated it against real jubilant-bassoon source
     rather than assuming it either needed the same fix or was
     irrelevant -- confirmed empirically it's not currently exploitable,
     not touched, reasoning stated explicitly
+35  TASK 1 CASE expression correctly scoped to source only, applied to
     the one clause actually confirmed responsible for the live
     regression
+40  TASK 2 real write-after-write test, not code-review-only: deployed
     first, then a real UPDATE + a real simulated conflicting INSERT
     against production D1, re-queried and confirmed both properties
     (tag sticks, content refreshes) in the same live test
+10  Test data restored to its exact original state (re-verified via a
     final query, not assumed); zero other column behavior changed
     (brief_text/word_count/quality_score all remain freely
     overwritable, confirmed via the same diff)
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits (all on `main`)

- `24c4000` — the real fix: CASE-scoped sticky `source` on the queue
  consumer's `game_recap` INSERT
- (this commit) — this outbox, after the real write-after-write proof and
  test-data restoration (both done directly via the D1 MCP tool against
  production, no temp GH Actions workflow needed for this one — the CASE
  logic is pure SQL, testable directly)
