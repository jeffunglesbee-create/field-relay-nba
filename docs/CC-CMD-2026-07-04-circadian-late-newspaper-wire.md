# Claude Code Command — Wire circadian_late into O(1) Newspaper bundle

**Branch:** main

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-circadian-late-2026-07-04.md.

## CONTEXT (verified live, not assumed — chat session 2026-07-04)

The standing incident "KV editorial keys not consulted by newspaper
endpoint" was investigated end-to-end this session. Two separate KV
keys are in play and they are NOT the same situation:

1. `field:circadian:preview:{date}` — NOT actually broken. Confirmed
   live via `curl .../analytics/newspaper/2026-07-03`: the `preview`
   field in the response IS populated with real content. It's served
   from D1 `analytics_output` (feature='circadian_preview'), not from
   KV. The KV write in `analytics-engine.js` (3 call sites, Phase 10A)
   is redundant but harmless. No action needed on this key as part of
   this CC-CMD.

2. `field:circadian:late:{date}` — genuinely orphaned. Written by
   Phase 10B (`runPhase10BLate`, src/analytics-engine.js ~line 1263)
   to BOTH KV (`field:circadian:late:${date}`) and D1
   (`analytics_output`, feature='circadian_late') under the SAME date
   as that day's `morning_report` (it directly reuses morning_report's
   brief_text — no extra AI call). Confirmed via grep across the
   entire relay: there is NO reader anywhere for either the KV key or
   the D1 `circadian_late` feature. Not in the newspaper endpoint, not
   anywhere else in src/*.js.

The newspaper endpoint's own D1 query already fetches this row for
free — `SELECT feature, value, brief_text FROM analytics_output WHERE
date = ?` has no feature filter, so `recap.circadian_late` is already
present in the parsed `recap` object by the time the bundle is
assembled. It is simply never read out into the response. This is a
one-line fix, not a redesign.

## TASK: extract circadian_late into the newspaper bundle

File: src/index.js, inside the `/analytics/newspaper/{date}` handler
(the route added by docs/CC-CMD-2026-06-22-newspaper-relay.md).

Find this exact block (confirmed present at ~line 10354 as of commit
checked this session — re-verify the exact line before editing since
this file changes daily):

```javascript
                    preview: preview.circadian_preview?.brief_text || null,
                    streak_board: recap.streak_board?.value || null,
```

Insert one new line between them:

```javascript
                    preview: preview.circadian_preview?.brief_text || null,
                    late: recap.circadian_late?.brief_text || null,
                    streak_board: recap.streak_board?.value || null,
```

That's the entire code change. No new D1 queries, no new KV reads —
the data is already in scope.

## SCOPE BOUNDARY

DO:
- Add the single `late:` line to the newspaper bundle object exactly
  as shown above.
- Verify against real data after deploy (see below).

DO NOT:
- Touch the circadian_preview KV write path — it's redundant but not
  broken, and removing it is a separate, optional cleanup decision
  not authorized by this CC-CMD.
- Remove or modify the circadian_late KV write in analytics-engine.js
  — leave it as-is; this CC-CMD only wires the D1 read side. (If a
  future session decides the KV write is fully redundant once `late`
  is D1-served, that's a separate decision, not this CC-CMD.)
- Touch the client repo (jubilant-bassoon).
- Change the Analytics Cron phases or their scheduling.
- Add any new database tables or columns.

## INSTRUCTIONS

1. Relay repo only (field-relay-nba).
2. git pull. Read CLAUDE.md.
3. Locate the exact current line for
   `preview: preview.circadian_preview?.brief_text || null,` inside
   the `/analytics/newspaper/{date}` handler — confirm it's still
   immediately followed by `streak_board:` before editing (the file
   moves; do not assume the ~10354 line number from this doc is still
   correct).
4. Add the single `late:` line as shown above.
5. `node --check src/index.js`.
6. Single commit: "feat: wire circadian_late into O(1) Newspaper
   bundle — data already fetched, never extracted (CC-CMD-2026-07-04)"
7. Deploy via wrangler deploy.
8. After deploy, verify against a date where morning_report is known
   to exist (yesterday relative to today, per the endpoint's own
   recap/preview date split):
   ```
   curl https://field-relay-nba.jeffunglesbee.workers.dev/analytics/newspaper/<today's date>
   ```
   Expect a non-null `late` field whose text matches that date's
   `morning_report` field exactly (same source text, since Phase 10B
   just copies it). If `late` is null, check whether Phase 10B actually
   ran for that date (it skips if no morning_report exists yet — see
   `runPhase10BLate`'s own early-return) before concluding the fix is
   wrong.
9. Write manifest to outbox: confirm the live curl output showing
   `late` populated and matching `morning_report`, not just that the
   deploy succeeded.
