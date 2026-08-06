# CC-CMD-2026-08-06-apply-soccer-league-label-fix-v2 — Result

## Status: DONE. Code fix live, 52 rows corrected, zero mismatches,
standing regression detector added.

## Provenance note (which spec was executed)

Started against v1, which pointed at `field-playground/docs/pending-
relay-fixes/` for the patch and reasoning. That repo is genuinely not in
this session's GitHub scope — `add_repo` required an approval that never
came, and a direct `get_file_contents` returned
`Access denied: repository "jeffunglesbee-create/field-playground" is
not configured for this session`. So the patch was never readable and
`git apply` was never possible.

Rather than stall, the fix was re-derived independently from the real
current source. **v2 (`660f1a5`, refined by `5a6fa95`) landed mid-session
and superseded v1**, inlining everything and explicitly forbidding any
field-playground reference. The independently-derived analysis matched
v2 on every point, including two things v1 never stated (see below).
v2 is the spec this session executed. **There is no v3** — checked both
repos; what looked like one was a second edit to v2 itself.

## Task 1 — real re-verification (Rule 87), and a correction to the
prior session's reasoning

Located the three sites fresh by literal search (not by v1's line
numbers): `handleJournalismCycle` catch-up, pre-game seed, and
yesterday-finals. Confirmed `gm.sport` is ESPN's top-level slug (from
`for (const {sport,league,label} of LEAGUES)`) and `gm.league` is that
table's per-competition `label`.

**The prior comment at all three sites claimed this was deliberately
left alone and "no change needed."** That claim is wrong, and resolving
it was the real work of Task 1. `canonicalizeWC26Sport()` (line 1549)
is:

```js
if (s === 'wc26' || s.startsWith('fifa world cup')) return SOCCER_LEAGUE_LABELS.wc26;
return sport;
```

It maps WC-ish labels **to** the canonical WC label. It solved label
*fragmentation* (12 WC26 variants → 1) but not label *correctness* — an
MLS game sent as `'FIFA World Cup 2026'` is normalized to the canonical
WC label and stays a World Cup row forever. The July 15 reasoning
cemented the bug rather than mooting it. Its one still-valid point (the
`id`-construction dependency) is preserved in the replacement comment.

Applied at all three sites: `sport: gm.league`. Verified zero remaining
buggy ternaries in code (the 3 grep hits are the new comment quoting the
old form), `node --check src/index.js` passes, pre-commit hook passed.

**Genuine WC rows are unaffected in the persisted column** — a point v1
never made: `LEAGUES`' own WC label is `'FIFA World Cup'`, and
`SOCCER_LEAGUE_LABELS.wc26` is also `'FIFA World Cup'`, so
`canonicalizeWC26Sport` still produces the identical column value. Only
the id *prefix* changes for WC rows. v2 independently states the same.

## Task 2 — real slate-safety check, before pushing

Run [`31112022669`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31112022669),
2026-08-06T14:40:57Z:

```
--- regular_season_games: 0 null-score soccer row(s) dated today ---
  EXPOSED (kicked off, still null-score): 0
--- postseason_games: 0 null-score soccer row(s) dated today ---
  EXPOSED (kicked off, still null-score): 0
```

Zero exposed rows → no seeded-but-unfinal soccer game could duplicate
under a new id on finalization. Safe moment confirmed, then pushed
(`3235749`).

Deploy run [`31112262449`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31112262449)
shows `failure` at the run level; investigated rather than assumed
(Rule 77): the `deploy` job itself is `success` — every STRUCTURAL
probe, the deploy gate, and the pre-existing "Soccer league label
contract check" all passed. The failure is the separate `verify` job's
trailing "Commit results" step losing a push race. The fix is live.

## Task 3 — real, scoped data correction

**Self-evidencing signal, no heuristic:** the same buggy call sends
`sport` (wrong) and `league` (correct) into the same row. So every
mislabeled row already carries its own true competition, written by the
call that mislabeled it. A row is mislabeled iff its `sport` is
WC-family while its `league` disagrees — and the correction value is
that row's own `league`.

Because the referenced probe workflow and scope `.sql` live in
field-playground and both v1 and v2 call for regenerating scope fresh
anyway, the probe was **built in this repo** (`scripts/soccer-league-
mislabel-scope.mjs` + `soccer-league-mislabel-scope-probe.yml`) — the
correct durable home for a relay data probe, and no dependency on a
non-production repo.

Measured ([`31112787072`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31112787072)):

| table | WC-family labeled | definitively mislabeled | true competition |
|---|---|---|---|
| regular_season_games | 155 | **52** (33.5%) | 100% MLS |
| postseason_games | 0 | 0 | — |

The numerator **52** matches the CC-CMD's independently-measured 52
exactly, via a completely separate measurement path. Denominators differ
legitimately: v2's "60 checkable" was a sampled window; the 155 here
includes 103 *genuine* World Cup rows from the real June–July
tournament — which the predicate correctly excludes, demonstrating the
"nothing that could sweep in a genuine World Cup fixture" property v2
demanded.

Applied ([`31112841057`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31112841057))
scoped by the explicit measured `espn_event_id` list (v2's explicit
requirement — not a bare `LIKE`), predicate retained as a second guard:

```
UPDATE changes=52 (expected 52)
remaining mislabeled after: 0 (expected 0)
=== TOTAL rows corrected: 52 ===
```

`id` never rewritten — confirmed `analytics-engine.js` really does
`JOIN briefs.game_id ... ON b.game_id = g.id` at lines 999, 1005, 1411,
1417. Immutability guard re-confirmed inapplicable against the real
current code: it is only an `AND drama_peak IS NULL` WHERE-clause on
drama_peak UPDATEs (10124/10235/10239); there is no DB trigger and
nothing guards `sport`.

## Task 4 — real verification

Run [`31112893004`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31112893004):

```
regular_season_games: 0 mislabeled row(s) remaining
  distribution: [{"sport":"FIFA World Cup","n":103},{"sport":"MLS","n":52}]
postseason_games: 0 mislabeled row(s) remaining
TOTAL REMAINING MISLABELED: 0
PASS: zero mismatches.
```

52 MLS rows now correctly labeled; 103 genuine World Cup rows untouched.
Repo quality gate (pre-commit: branch + syntax) passed on every commit;
the deploy job's full structural suite passed post-fix.

## Automated follow-up (highest order available)

v2 requires the set "stay zero for anything newly archived since" — a
continuing property, so it now has a continuing test rather than a
one-time reading. The probe gained a weekly `schedule` (Mondays 06:17
UTC) defaulting to `verify`, which exits non-zero the moment any
mislabeled row reappears, surfacing a regression as a real failed run
instead of silent re-accumulation. `inputs.mode` is empty on schedule
triggers, so mode is resolved once into a job-level `MODE` env with a
`verify` default — run step, log filename and commit message can never
disagree about which mode ran.

## Real bug found and fixed in this session's own tooling

The first probe run reported `success` but committed nothing.
Investigated rather than dismissed as the familiar push race (Rule 77):
`git add` is **atomic across pathspecs** — the `*.sql` glob matched
nothing on a slate run, which aborted the entire `git add`, so the
`.log` never staged. `2>/dev/null` hid the error. Split into separate
adds with visible errors.

## Commits
- `9078d8a` — probe (slate/scope/apply/verify)
- `fa3e37c` — scope correction by measured espn_event_id list
- `3235749` — the code fix (three sites)
- `+` this commit — weekly regression detector, git-add fix, this doc

## Outbox
This file, plus `outbox/soccer-league-mislabel-{slate,scope,apply,verify}-*.log`
and `outbox/soccer-league-mislabel-scope-2026-08-06T14-49-49-767Z.sql`.
