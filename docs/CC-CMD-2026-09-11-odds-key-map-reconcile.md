# Claude Code Command — Reconcile the four sport→odds-key maps

**Date:** 2026-09-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** B (bug fix)
**Severity:** Live. MLS, Bundesliga, NFL, CFB and others get no ambient odds and
no closing-odds capture, for a reason that is not a coverage decision.

## CONTEXT — the same mapping, written four times, diverged

| location | entries | keyed by |
|---|---|---|
| `index.js:6332` `ODDS_SPORT_KEYS` | 6 | `sport\|league` |
| `index.js:6344` `ARCHIVE_SPORT_TO_ODDS_KEY` | 16 | short code |
| `ambient-do.js:67` `ODDS_SPORT_KEYS` | own copy | sport |
| `wp-resolver.js:53` `ARCHIVE_SPORT_TO_ODDS_KEY` | own copy | short code |

The 6-entry map holds nba, wnba, nhl, mlb, `soccer|eng.1`, `soccer|fifa.world`.

The 16-entry map, **twelve lines below it in the same file**, already holds
`mls: 'soccer_usa_mls'`, plus bundesliga, serie a, la liga, ligue 1, nfl, cfb,
cfl, ufl, afl, ipl.

`ambient-do.js:574` gates the ambient odds path on the six-sport map:
`if (!ODDS_SPORT_KEYS[sport]) continue;`
`ambient-do.js:773` gates the closing-odds capture on the same map.

So both live paths skip any sport not in the six, while the archive path
(`index.js:6565`, `:6688`, `:14925`) resolves the same sports correctly.

`index.js:12875` already documents this in a comment — "its `ODDS_SPORT_KEYS` is
six sports" — and works around it by calling `archiveSportToOddsKey()` at that
one site. The divergence was known and patched locally rather than reconciled.

## MEASURED 2026-09-11 — the observable effect

Via `/context/date/{date}`, `games.regular`:

```
2026-09-10   MLS 9 rows / 0 odds    UCL 6 / 0    MLB 5 / 5    NFL 1 / 0   CFB 1 / 0
2026-09-06   MLB 15 / 14   MLS 8 / 0   La Liga 4 / 3 (draw 3)
             Serie A 4 / 3 (draw 3)   Ligue 1 3 / 3 (draw 3)   EPL 2 / 2 (draw 2)
             Bundesliga 2 / 0   CFB 3 / 0   CFL 1 / 1 (draw 0 — correct, CFL has no draw)
```

Three-way is correct wherever odds arrive: every European soccer row with odds
carries a draw. MLS is 0 of 17 across both dates — it previously came through
two-way (2026-08-23 finding) and now comes through not at all.

## TASK 0 — PROBE (read from HEAD, do not trust this document)

1. Read all four maps at HEAD. Record real entry counts and exact keys. This
   document's table is a starting point, not the source of truth.
2. Establish why the key SHAPES differ (`sport|league` vs short code) and
   whether both are still needed, or whether one is a historical artifact.
   Do not unify on a shape before understanding what each call site passes.
3. For every sport in the 16-entry map but not the 6-entry map, determine
   whether the omission is deliberate. Check `git log`/blame on both maps.
   **If any omission turns out to be an intentional cost or rights decision,
   leave it and report it** — do not assume divergence means defect.
4. Confirm against the vendor that `soccer_usa_mls` is live and returns
   markets. The key existing in our source is not evidence the vendor serves it.

## TASK 1 — Single source of truth

Reduce to ONE mapping, imported by every call site. Both lookup shapes may
remain as thin accessors over one table if Task 0.2 shows both are needed —
but there must be exactly one place where a sport's odds key is written down.

This is the condition Rule 50 exists to end (see `field-laboratory/docs/
SPORT-PROOF.md`: "five separate string-keyed registries"). Reproducing the
registry pattern in a second domain is the thing to stop, not just this
instance.

## TASK 2 — Budget consequences, measured before enabling

Widening the ambient path from 6 sports to 16 increases API consumption.
Before enabling, compute the real projected daily credit cost from observed row
counts per sport, and check it against `ODDS_QUOTA_FLOOR` (50),
`_AMBIENT_ODDS_HARD_LIMIT` (85000) and the 30/day ambient capture cap.

If the projection exceeds any limit, **do not enable everything** — report the
numbers and propose a prioritised subset. A quota wipeout is the failure this
codebase has already had once.

Note the capture path charges via `_consumeAmbientOddsCredit` / `oddsCreditCost`
after the 2026 fix (`ambient-do.js:781`); use the real cost function, not a
per-call assumption of 1.

## TASK 3 — Verification (inside this session)

After deploy, probe `/context/date/{date}` for a date with MLS fixtures and
report real rows / rows-with-odds / rows-with-draw per sport. MLS is a
three-outcome market: if odds arrive without a draw price, that is the
2026-08-23 finding returning and must be reported, not smoothed over.

## DONE CONDITION

- One mapping; all four former sites import it.
- Task 0.3 findings stated per omitted sport (defect vs deliberate).
- Task 2 projection recorded against all three limits.
- Real per-sport census showing MLS rows with odds AND draw, or an explicit
  statement of what arrived instead.

## TASK 4 — Outbox manifest (last task)

`outbox/cc-session-2026-09-11-odds-key-map-reconcile.md` with the four-map
inventory, the blame findings, the budget projection, the post-deploy census,
and the commit SHA.
