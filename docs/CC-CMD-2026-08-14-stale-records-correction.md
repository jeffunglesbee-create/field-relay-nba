# CC-CMD-2026-08-14-stale-records-correction

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-14-stale-records-correction.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## Two records in this repo point the wrong way

Both were written in good faith. Both are now false, and both are the first
thing a searcher finds. Neither is a code defect — which is why nothing has
caught them.

## PART A — a route documented as deleted is live

An outbox doc states `/test/gemini-judge` was removed on 2026-07-21, **with a
live 403 as verification**. A probe on 2026-08-13 got **200**. Full history
resolved it: `22ed3df` deliberately re-added the route for the still-active
combined-judge investigation.

The removal doc was true when written. It is false now, and it nearly caused the
wrong fix — had the removal stood, deleting the route was correct rather than
repairing its label.

Compounding it: **the clone was shallow (52 commits, back to 2026-08-11), so
`git log -S` silently found nothing until `--unshallow`.** A search that returns
no results on a shallow clone is indistinguishable from a search that proves
absence.

### TASK A1

Locate the outbox doc making the removal claim. Append a dated correction
in place — do not rewrite or delete the original. It was accurate at the time
and the record of *when* it stopped being accurate is the useful part. The
correction must name `22ed3df` and state the route is live.

### TASK A2

Add the shallow-clone trap to `HANDOFF.md` if it is not already there: any
`git log -S` / `git log --grep` used as evidence of absence requires
`--unshallow` first, and a negative result on a shallow clone proves nothing.

`field-laboratory`'s `check:workflows` already automates the sibling of this —
it asserts *"the detector catches a history reader on a shallow checkout"* and
*"the detector does not flag `fetch-depth: 0`"*. Consider porting that assertion
rather than relying on the note.

## PART B — the 08-08 archive-gap correlation rests on a client-sourced write

`CC-CMD-2026-08-08-investigate-mlb-wnba-archive-gap` concluded candidate 2 and
anchored the timeline on:

> The last ESPN-sourced write before the outage is an `mlb_game` brief at
> **2026-08-06 15:06**. The recorded start of the ESPN-403 incident is
> **2026-08-06 15:22**. Sixteen minutes apart.

**That anchor is client-sourced.** Every `mlb_game` brief on that date is
`source: "client"` — browser-generated. Measured via `GET /archive/query`:

```
mlb_game_2026-08-06_g13  created 2026-08-06 15:06:21  source: "client"
mlb_game_2026-08-06_g18  created 2026-08-06 00:38:41  source: "client"
mlb_game_2026-08-06_g19  created 2026-08-06 00:38:41  source: "client"
mlb_game_2026-08-06_g17  created 2026-08-06 00:38:40  source: "client"
mlb_game_2026-08-06_g16  created 2026-08-06 00:38:40  source: "client"
```

The 403 is **Cloudflare-Worker-egress-specific** — established twice
independently (`espn-reachability-monitor` run 31283740940: `site.api` HTTP 200
from a non-Worker IP; the WNBA `/web-fetch` probe: the same URLs serve a runner
and not the Worker). So a client write at 15:06 evidences *browser*
reachability. It says nothing about Worker egress, and the sixteen-minute
coincidence compares two different network paths.

### The Worker-side bound, measured

```
Last known-good Worker ESPN write:
  pre_game_MLB_2026-08-04_diamondbacks_padres  source:cron  2026-08-04 10:01:24

GET /freshness/2026-08-04 → 19 entries: 17 ESPN event ids + 2 MLS
GET /freshness/2026-08-05 →  4 entries:  1 ESPN event id  + 3 MLS
                              (the 1 is 401816398 — the 08-04 pre_game above)

pre_game for 2026-08-06 → 1 row, created 2026-08-08 13:47:35 (catchup, not same-day)
pre_game for 2026-08-07 → 0 rows
```

ESPN-fed coverage for 08-05 collapsed 17 → 1 while non-ESPN MLS coverage
continued at 3 — the same source-split signature the original CC-CMD used to
confirm candidate 2, visible **a full day before the recorded 403 onset**.

### Determination

**Task 2 branch one: one cause, wrong start time.** Onset bounded to
**(2026-08-04 10:01:24, 2026-08-05 ~10:00]** — roughly 29 hours earlier than the
incident record.

Stated limits, because they matter: the branch call rests on **signature
identity** with the confirmed 08-06 cause, not on a directly observed 403 on
08-05. Branch one's own wording ("or something indistinguishable from it")
anticipates exactly this. Scored **96** by its author, and the author could not
write to `outbox/` — hence this CC-CMD rather than a result doc.

### TASK B1

Correct the incident record in
`outbox/cc-session-2026-08-08-espn-site-api-403-p0.md` with the real bound and
the evidence above. Append, do not rewrite.

### TASK B2

Amend `CC-CMD-2026-08-08-investigate-mlb-wnba-archive-gap`'s result to mark the
sixteen-minute correlation as **withdrawn**, with the reason: the anchor is
`source: client` and the 403 is Worker-specific.

### TASK B3

Re-scope or close `CC-CMD-2026-08-09-diagnose-0805-pre-403-miss`. Its question is
substantially answered by the above. Decide explicitly: close as answered at 96,
or execute the remaining discriminator. **Do not leave it open by default** —
that is how a stale spec becomes a permanent carry-forward.

### Observed, not diagnosed — do not build on it

`GET /changelog/2026-08-05` returned rows timestamped **2026-08-12 and
2026-08-13**, newest-first by id. The date segment appears inert on that route.
Recorded because a future probe may reach for it as evidence; it was not relied
on for anything above.

## DONE CONDITION

1. The removal doc carries a dated correction naming `22ed3df`; the original text survives.
2. The shallow-clone trap is in `HANDOFF.md` (or the laboratory assertion is ported).
3. The 403 incident record carries the corrected bound with the freshness counts quoted.
4. The sixteen-minute correlation is explicitly marked withdrawn, with its reason.
5. `diagnose-0805-pre-403-miss` is closed or re-scoped — a stated decision either way.

## Explicitly NOT in scope

- Do not delete or rewrite any historical outbox text. Append corrections.
- Do not backfill or modify any `briefs` or `regular_season_games` row.
- Do not change `/changelog/`'s date handling; it is recorded, not assigned.

## Confidence scoring

- PART A (30 pts): correction appended without destroying the original; shallow-clone trap recorded
- PART B1/B2 (35 pts): incident record corrected, correlation withdrawn with its reason
- PART B3 (25 pts): an explicit close-or-rescope decision, not a default
- Discipline (10 pts): nothing rewritten, nothing built on the `/changelog/` observation

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
Automate follow-ups. No fallbacks, only fixes.

## Outbox

`outbox/cc-session-2026-08-14-stale-records-correction.md`
