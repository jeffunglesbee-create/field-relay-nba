# CC-CMD-2026-08-08-confirm-duplicate-fixture-mechanism

**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR

One-liner:
```
git remote get-url origin || git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-08-confirm-duplicate-fixture-mechanism.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## This is a confirmation task, not a fix task — read this before doing anything else

Real, measured symptom: 18 duplicate rows across 5 of 14 real days
checked, each pair the same fixture under two different ids — one
unscored, one final. Example:
```
MLS_2026-08-06_newyorkcityfootballclub_clubsantoslaguna        score=—    finalized=no
MLS_MLS-COM-000006_MLS-MAT-000A3C_phaseone_2026-08-06           score=0-2  finalized=yes
```

Real cause, at the id-construction line in the archive writer:
```js
const id = series_key
    ? `${sport}_${series_key}_${shortify(round) || 'r'}_${date}`
    : `${sport}_${date}_${idTail}`;
```
Two ids for one match means `ON CONFLICT` cannot merge them.

**The existing code comment above that line claims this is transitional
and "self-heals" on next resolution.** Real measurement contradicts
that framing — duplicates appear on 2026-08-05, 06, 07, and 08, which
are current dates, not a migration backlog. The working hypothesis,
consistent with every observed pair but not yet confirmed: the pre-game
**seed** writes from `gameMeta` (built from ESPN's scoreboard), which
carries no `series_key`, so it always takes the second branch; the
**resolution** always has one and takes the first. Two writers, two id
inputs, permanently — not a one-time migration artifact.

## Task 1 — Re-verify from HEAD before anything else (Rule 87)

- Re-confirm this id-construction code and its comment still read as
  described — locate by the real, current line content, not a line
  number that may have moved.
- Re-run the duplicate measurement fresh against real, current data
  (query the archive directly for a recent window) rather than trust
  this doc's snapshot.

## Task 2 — Confirm or refute the actual mechanism

**This is the real task.** Trace whether the pre-game seed code path can
obtain a `series_key` at seed time, from the real, current source — not
by reasoning about what "should" be possible.

- If the seed path genuinely has no access to `series_key` at the point
  it writes (confirm by reading the real seed function, not assuming),
  the hypothesis is confirmed: this is structural, not transitional, and
  the code comment's "self-heals" claim is wrong and should be corrected
  in-place to say so, with the real reasoning.
- If the seed path *could* obtain a `series_key` (e.g., it's available
  in `gameMeta` or a nearby call but not currently read), state that
  precisely — that changes which of Task 3's two candidates is viable.

## Task 3 — Present two candidate fixes, do not apply either

Both carry real, different risk. State them clearly, with genuine
tradeoffs, and stop — the choice is not this CC-CMD's to make.

1. **Converge the id schemes** (make the seed path build the same id
   shape the resolution does, if Task 2 found it can obtain a
   `series_key`). Risk: `briefs.game_id` joins `games.id` in
   `analytics-engine.js` (real join sites — re-locate by content, not
   line number, they were at ~999, 1005, 1411, 1417 when last checked).
   Changing historical ids risks silently breaking those joins for
   already-referenced rows.
2. **Dedupe at read time**, keying on `(sport, date, home, away)` since
   `espn_event_id` is null on every measured duplicate pair (confirmed —
   the obvious join key is unavailable). Risk: a real, ongoing
   maintenance cost in the read path rather than a one-time write fix,
   and a chance of false-merging two genuinely different games that
   happen to share date/teams (e.g., a doubleheader) — check whether
   that's a real, current occurrence in this data before presenting this
   option as risk-free.

## Task 4 — Verification

- Real evidence for whichever of Task 2's two branches was found true —
  not a claim, the actual code read and quoted.
- If a real fix is scoped as a clear, low-risk follow-up given Task 2's
  finding, note it explicitly as a recommended next CC-CMD — do not
  write or apply it in this one.

---

## Explicitly NOT in scope

- Do not apply either candidate fix.
- Do not touch the id-construction code beyond confirming its current
  content, unless Task 2 finds the comment is factually wrong, in which
  case only the comment text may be corrected — not the logic.

---

## Outbox

`outbox/cc-session-2026-08-08-confirm-duplicate-fixture-mechanism.md`:
the real, traced answer to whether the seed path can obtain a
`series_key`, and a clear, decision-ready comparison of the two
candidate fixes.
