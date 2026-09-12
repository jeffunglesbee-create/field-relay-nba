# CC session 2026-09-12 — eight routes answered `ok: true` when the query failed

Rule 67 session doc for `docs/CC-CMD-2026-09-12-catch-collapse-routes.md`.

## HEAD progression

| commit | what |
|---|---|
| `36f2797` | the eight-site fix + `check-d1-failure-distinguishable.mjs` + CONTRACTS.md |
| `7bf8494` | four browser suppressions + the setAlarm CC-CMD |
| `b5837a7` | regenerated route-provenance manifest + the truncation CC-CMD |
| `2e5b5a4` | deleted the spent `register-rule-99.yml` (secrets ratchet) |
| `d4e0b62` | the live success-path probe |
| this | coverage accounting fix + this manifest |

**Deployed:** run 34663070816, `2e5b5a4`, 00:53:33Z. Both jobs green.

## Two corrections to my own CC-CMD, both from Task 0

**It was eight, not seven.** I counted with `grep` on `src/index.js` — a file I
already knew carries NUL bytes. grep switched to binary mode and truncated its
own output. `/backfill/brief-scores` was the one it dropped. Python is
authoritative on that file; grep is not.

**Task 0 changed Task 1.** The CC-CMD asserted four of these would break a
response-shape contract, so the fix would need paired client changes. It does
not. Every consumer already branches on `res.ok` and none reads a body field on
failure:

| consumer | what it does |
|---|---|
| jubilant-bassoon `field.js:35370` | `if (!r.ok) return 0;` |
| `drama-backfill.mjs:302` | `if (!res.ok) { … break; }` |
| `score-fill.mjs:31` | `if (!listRes.ok) throw` |
| `verify-drama-leaderboard.mjs:10` | logs the HTTP status |

And **five of the six routes have no jubilant-bassoon consumer at all.** They
were written to distrust a non-2xx and had simply never been given one. So a
503 needed no client change, and CONTRACTS.md gained a statement rather than a
migration.

## The shape

`d1AllOrError(stmt, label)` returns `{ results, error }`: `results` is `null` on
failure and an array on success — a sibling of the value, not a member. Failures
answer `503 {ok:false, error:'query_failed', detail}`.

What each site used to say when the query threw:

| site | the false claim |
|---|---|
| postseason cron helper | `reason: 'no active postseason series'` |
| `/archive/drama/leaderboard` (×2 queries) | 200 `{ok:true, games:[]}` |
| `/archive/drama-missing` | 200 `{ok:true, games:[]}` |
| `/archive/score-missing` | 200 `{ok:true, games:[], count:0}` |
| `/integrity/briefs` | `slateCount:0` → `divergence:true` → offers a repair |
| `/integrity/games` | a gap for every league |
| `/backfill/brief-scores` | `{ok:true, dry_run:true, found:0}` |

## Verification, both halves

**Failure path — by mutation.** Forcing a real D1 failure in production is not a
thing to do, so `check-d1-failure-distinguishable.mjs` asserts two properties
against the source and mutation-tests itself every run. Three mutations, each
caught by its own property letter: reinstating the banned catch, deleting an
`.error` check, and reading `.results` one line before the check.

Property B is **"`.error` checked before `.results` is read"**, not "checked
within N lines". A line-window was the first attempt and it flagged correct
code — the leaderboard route checks `reg.error || ps.error` together after both
queries, eight lines down. Widening the window to make that pass would have been
tuning the matcher to the answer. The ordering invariant is both the real
property and strictly stricter.

**Success path — live.** `outbox/d1-failure-shape-live-20260912T005807Z.json`,
after the deploy: five routes, all HTTP 200, `ok:true`, expected key present.
`/archive/drama-missing` is the one with a client consumer, which is why a
silent shape break there would not have surfaced in the relay's own checks.

## Done condition

| | before | after |
|---|---|---|
| D1 result-set collapses under `src/` | 8 | **0** |
| catch-collapse under `src/` (all kinds) | 17 | **1** |
| suppressed with reasons | 4 | **18** |

The one remaining is `ambient-do.js:950` — `setAlarm(...).catch(() => {})`, so a
rejected alarm means the DO never wakes again. **Left flagged deliberately.**
Suppressing a known concern to lower a count is the failure Rule 99 exists to
prevent. Filed as `CC-CMD-2026-09-12-ambient-do-setalarm-swallowed`.

## Three CI failures, all real, all mine

| run | failure | cause |
|---|---|---|
| 926 | stale `route-provenance.js` | the manifest is generated from `src/index.js` |
| 927 | same | same commit chain |
| 928 | secrets ratchet 117 > 115 | `register-rule-99.yml` carries the literal twice |

I should have run the gate set locally before the first push, not the third.

**The ratchet fix is worth stating plainly:** the check's message offers "lower
the number if you REMOVED some", and raising it to accommodate my own hard-coded
credential would be the ratchet defeating itself. Deleted the spent one-shot
instead — it had already registered rule-99 successfully, so keeping it was dead
code carrying a credential.

**And `2e5b5a4` triggered no deploy at all** — it touched only
`.github/workflows/`, which `deploy.yml`'s paths filter excludes. Correct
behaviour, but it meant the fix sat committed and undeployed while I was
reporting on a run that did not exist. Dispatched manually.

## Found while fixing: the provenance instrument has the same defect

Regenerating the manifest dropped `echo.pims.cfl.ca` and `www.cfl.ca` from
`/archive/`, which reads as a provenance correction and is not one.

`bodyOf()` scans at most `WINDOW = 1500` lines for brace balance. `/archive/`
**never balances**: dispatch at `:11858`, window ends at `:13358`, and
`/cfl/odds-probs` (`:13349`) and `/cfl/` (`:13358`) sat inside it by nine lines.
The ~40 lines this change added pushed them out. **Neither value is a fact about
`/archive/`** — both are artifacts of where an arbitrary boundary landed.

`bodyOf` already returns `truncated: true`, and its own comment says an
unbalanced block "must say it did not parse, not hand back an empty answer that
reads as fact." Nothing downstream reads the flag. That is Rule 99 inside the
provenance instrument. Filed as
`CC-CMD-2026-09-12-route-provenance-truncation-invisible`.

## A Rule 91 defect in the probe written to satisfy Rule 91

The first live probe printed `probed 5 of 8` alongside two not-probed entries.
5 + 2 = 7. The leaderboard route runs **two** of the eight queries, so routes
and sites are different denominators. Fixed to count sites, and the script now
refuses to run if `probed + not_probed !== total` — mutation-tested by setting
the total to 9, which exits 1.

## Carry-forward

None deferred without a successor. Three CC-CMDs raised:
`ambient-do-setalarm-swallowed`, `route-provenance-truncation-invisible`, and
(from the earlier triage) `odds-identity-join-cfb`.
