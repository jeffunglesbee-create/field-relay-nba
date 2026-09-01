# CC-CMD-2026-09-01-archive-game-numeric-espn-upsert-key — LANDED, DEPLOY HELD

**Status:** code on `main`, deploy deliberately not triggered. **Confidence: 96.**

## Task 1 — probed from HEAD, nothing written from memory

| the spec quoted | HEAD (`e94aca6`) |
|---|---|
| destructure with `source_id`, no `espn_event_id` | `src/index.js:11634`, `espn_event_id` count in that block: **0** |
| `const id = series_key ? … : …` | `src/index.js:11708-11710`, byte-identical |

The spec resolved against `e1b7ed1`; HEAD is `e94aca6`. The sha moved, the two
quoted regions did not, which is what the probe is for.

## The change

Four non-comment lines:

```js
const isEspnEventId = v => /^\d+$/.test(String(v ?? ''));
    : isEspnEventId(source_id)
        ? `${sport}_${date}_e${source_id}`
        : `${sport}_${date}_${idTail}`;
```

**The field is `source_id`, not `espn_event_id`.** This route's body has no such
field; the column is written from `source_id` at both bind sites. Code written to
the issue's own wording would read `undefined` on every call and the guard would
never fire — green, and doing nothing.

## Verified before pushing

Six cases against the composition in isolation:

| case | result |
|---|---|
| `Dream` and `Atlanta Dream` under one numeric id collapse to ONE id | PASS |
| that id is `e`-tailed | PASS |
| golf R1 and R2 under `golf_401811963` stay SEPARATE | PASS |
| a postseason leg with a numeric `source_id` keeps the series scheme | PASS |
| no `source_id` keeps the exact prior name id | PASS |
| the two schemes cannot produce the same string | PASS |

### One of my own assertions was wrong

The sixth started as `!id.endsWith('_e401857186')` for adversarial team names
`e401857186` vs `e401857186`, and FAILED. The property was wrong, not the code:

```
numeric: X_D_e401857186
byName : X_D_e401857186_e401857186
```

Different strings. `endsWith` is not collision. The real argument is structural
and holds: the name tail is `${homeShort}_${awayShort}` and always contains an
underscore; the numeric tail is `e` plus digits and never does.

## Why the deploy is held

The migration-exposure probe, run immediately before pushing:

```
134 forward row(s), 15 EXPOSED
  today (in flight, resolves on its own): 15
  future-dated (strands)                : 0
    MLB   15
SHIP ADVICE: quiet-window
```

Fifteen unscored MLB rows already carry a numeric event id. A deploy landing now
gives each of them a new id on resolution and strands the old row permanently
unscored — the 2026-08-08 shape, bounded at fifteen and entirely avoidable by
waiting.

**Not a backlog.** Zero future-dated. The count read 4 at 02:41Z and 15 at
15:12Z, which is today's slate being seeded, and it returns to 0 as those games
finalize.

`[skip ci]` on this commit is the sanctioned case from this repo's own rule: it
touches a deploy-trigger path and must not deploy. `deploy.yml` accepts
`workflow_dispatch`, so the deploy is a dispatch once the gate reads 0.

## Done condition — NOT YET MET

Both assertions from the CC-CMD remain outstanding and are the reason this is
LANDED and not DONE:

1. two `POST /archive/game` calls with one numeric `source_id` and two team-name
   spellings must produce **exactly one** row, with an id matching `/_e\d+$/`;
2. the same two calls with `golf_999999999` must still produce **two** rows.

Both run against the deployed worker after the dispatch. `/archive/game` needs no
auth (33 POSTs, HTTP 200, verified 2026-08-11), so both are executable.

## Residual

The 18.2% of rows with no numeric id — 177 MLS, 20 golf across the 30-day window
— keep the name-derived id and the duplicate bug. field-relay-nba#1 does not
fully close on this change.
