# CC-CMD-2026-08-09-diagnose-0805-pre-403-miss

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-09-diagnose-0805-pre-403-miss.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## The specific unexplained fact

`CC-CMD-2026-08-08-investigate-mlb-wnba-archive-gap` confirmed the
MLB/WNBA archive gap was an ESPN-fetch failure (candidate 2): every
ESPN-sourced write stopped while every non-ESPN-sourced write continued,
and `change_log` went from 16 entries on 08-04 to zero on 08-05, 08-06
and 08-07.

**But the timeline does not close.** The recorded start of the ESPN-403
incident is 2026-08-06 15:22 UTC. The archive pass for 2026-08-05 would
have run about 08-05 10:00, and its catchup about 08-06 10:00 — both
well before 15:22. So 2026-08-05's miss is not explained by the 403.

Either the 403 began earlier than recorded, or a second failure mode
overlaps it. If the latter, it is still live and undiagnosed.

**Do not resolve this by widening the 403 window to fit.** That is the
rationalization Rule 77 exists to prevent. Establish which it is from
evidence.

## Task 1 — bound the real 403 onset

The last ESPN-sourced write before the outage is an `mlb_game` brief at
2026-08-06 15:06 (from pass E of the archive-gap probe). That is the
latest known-good ESPN read.

Find the earliest known-BAD one. Cloudflare request logs are not
reachable from a session, so use what is persisted:
- `GET /debug/last-archive-error` (KV `journalism:last-archive-write-error`)
  — note this holds only the LAST error, so it is likely stale now;
  record what it says and its timestamp rather than assuming relevance.
- `briefs` and `change_log` timestamps either side of 08-04 10:01,
  which is the last healthy same-day archive pass.

**Artifact:** the latest known-good and earliest known-bad ESPN-sourced
write timestamps, quoted from query output.

## Task 2 — decide between the two explanations

- **If evidence shows ESPN-sourced writes failing before 08-05 10:00**,
  the 403 (or something indistinguishable from it) started earlier than
  recorded. Correct the incident record in
  `outbox/cc-session-2026-08-08-espn-site-api-403-p0.md` with the real
  bound and the evidence for it. One cause, wrong start time.
- **If ESPN-sourced writes were healthy right up to 08-05 10:00 and then
  stopped**, this is a SECOND failure mode. Identify it: was the 08-05
  cron invocation itself missing, did the fetch throw, did it return 200
  with empty events? Read the real code path for the same-day archive
  pass before concluding.

## Task 3 — Done condition

A written determination naming which of the two branches the evidence
supports, with the timestamps that decide it. If branch two, either a
named root cause or an explicit statement of what evidence would be
needed and why it is not obtainable — not a guess presented as a finding.

If a fix is warranted, it is a THIRD CC-CMD. Do not apply one here.

## Explicitly NOT in scope

- Do not backfill the missing dates — that is
  `CC-CMD-2026-08-09-backfill-archive-gap-dates`.
- Do not modify the archive writer or cron.

## Outbox

`outbox/cc-session-2026-08-09-diagnose-0805-pre-403-miss.md`.
