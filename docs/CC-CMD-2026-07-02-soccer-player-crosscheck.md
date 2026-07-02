# Claude Code Command — Soccer Player Cross-Check (BSD ↔ ESPN)

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-soccer-player-crosscheck-2026-07-02.md.

## CONTEXT

Same category of problem as the MLB player-mismatch detector
(jubilant-bassoon, shipped 2026-07-02, commit `8bc84fc`/`08dd08f`), but
soccer's failure shape is structurally different — checked directly
this session, not assumed:

- **BSD's own two soccer endpoints disagree with each other.** Its
  `shotmap` array carries only a numeric `player_id` (e.g. `3513`) —
  no name at all. Its `average_positions` array (same combined
  `/bsd/events/{id}/shotmap` response) carries **both** `player_id`
  and a name string, but abbreviated: `"T. Weah"`, `"B. A. Yılmaz"`,
  `"N. Da Costa"`. The BSD `/bsd/contract` doc's own documented example
  claims shotmap entries carry a full `"player": "M. Salah"` string —
  **that's wrong**, confirmed against live data, not just the cached
  R2 snapshot. The contract's own status field says `"provisional —
  pending live BSD verification"`; do not trust it without checking
  live data again before building against it.
- **ESPN's soccer roster format is unrelated to its MLB roster format
  in one important way:** MLB surnames are single-token. Soccer has
  real particle surnames — confirmed live, "N. Da Costa" is a real
  player (WC26). A naive "last space-separated token" extraction
  (which is *exactly right* for MLB) would silently truncate this to
  "Costa" and drop "Da". Verified the correct rule against 6 real BSD
  `average_positions` names collected this session: **strip leading
  period-terminated tokens (initials), keep everything remaining as
  the surname** — this correctly handles both compound first names
  (`"B. A. Yılmaz"` → `"Yılmaz"`) and multi-word surnames
  (`"N. Da Costa"` → `"Da Costa"`) with one rule. Do not use a
  different rule without re-testing against real samples first.
- **The actual open question this tool answers, not yet checked:**
  does ESPN's `lastName` field for the matching real player also say
  `"Da Costa"`, or does it truncate to `"Costa"` the way FPL's fields
  mis-slot Korean names? This is genuinely unknown — this CC-CMD
  builds the tool to find out, it doesn't assume the answer either way.

**No shared numeric ID exists between BSD's `player_id` and ESPN's
athlete `id`** — confirmed, these are two independent ID systems.
Matching must be name-based, same constraint as the MLB case, and same
core risk: **any resulting alias map needs the same collision check
performed for `CANONICAL_PLAYER`** (10 of 22 MLB candidates were
rejected for colliding with a different real player sharing the
truncated surname — expect the same risk here, arguably worse, since
soccer surnames like "Costa," "Silva," "Santos" are far more common
than the MLB cases found).

**Scope, real and checked, not assumed:** FIELD wires far more soccer
competitions than just the 5 majors + WC26 — `TEAM_ID_LOOKUP` (or
equivalent config table, confirm exact name via probe below) includes
at minimum EPL, MLS, UCL, Europa, Conference League, EFL Championship/
League One/Two, La Liga, and others not yet enumerated here. Task 1
requires enumerating the real full list before scoping which
competitions this tool covers — do not assume it's just the ones named
in this doc.

**Known, real, current limitation — do not try to work around it:**
2026-27 European domestic season has not started (checked EPL via
`/bsd/events/season?league=1&season=2026`: all real fixtures returned
`status: "notstarted"`, dated 2027 — no finished match exists yet to
test against for EPL specifically). WC26 group stage is the only
confirmed source of real finished matches with real `average_positions`
data available right now. Build and verify against WC26. Note in the
outbox manifest which other competitions could not be tested for this
reason, rather than skipping them silently or assuming they'd work.

## PRE-BUILD PROBE (Rule 87)

```bash
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/bsd/events/8346/shotmap | python3 -m json.tool | grep -A3 average_positions | head -20
curl -s https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/367/roster | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(list(d['athletes'][0].keys()))"
grep -n "espnLeague:\|bsdLeagueId:" src/index.js
```

Confirm the real current shape of both endpoints and the real full
league config table before writing any matching logic. If either shape
has changed since this doc was written, stop and report the
discrepancy rather than building against stale assumptions.

## TASK 1: Enumerate real cross-referenceable competitions

From the real config table (found via probe above), list every
competition with `bsdLeagueId != null` AND a real ESPN `espnLeague`
slug — both are required for this tool to do anything. Competitions
with `bsdLeagueId: null` (ESPN-only, e.g. `eflone`/`efltwo` per this
doc's context) have nothing to cross-check against by definition —
exclude them, document why.

## TASK 2: New script — `scripts/soccer-player-crosscheck.js`

Node script, relay-side (this repo owns both the BSD proxy and the
ESPN calls already — unlike the MLB case, no cross-repo duplication
needed here; consider importing `_stripPlayer`/`resolveEntity` from
`src/identity-resolver.js` directly if the type dispatch can be
extended to a `'soccer_player'` type — evaluate this during the probe,
don't assume the MLB `_stripPlayer` algorithm applies as-is, since
suffix-stripping (Jr/Sr/II/III/IV) is irrelevant here and the surname-
extraction rule is different, as established above).

Logic, per cross-referenceable competition:
1. Find a real finished match (checked live, not assumed) — if none
   exists for that competition right now, log it as untestable and
   move on, per the known limitation above.
2. Fetch its `average_positions` via the existing BSD proxy route.
3. Fetch the two teams' ESPN rosters.
4. For each BSD player, extract the surname using the verified rule
   above. Loosely match (accent-stripped, case-insensitive) against
   ESPN roster `lastName` to find the corresponding athlete — same
   "find first, compare after" two-stage approach as the MLB tool, not
   a direct string equality assumption.
5. If found: compare BSD's real surname (accented, particle-preserving)
   against ESPN's `lastName` for that athlete. If they differ, this is
   a real candidate — log `{bsdName, bsdPlayerId, espnLastName,
   espnFullName, espnAthleteId, team, competition}`.
6. If not found: log to `unmatched` (real gap, don't guess).
7. **Collision check, same discipline as `CANONICAL_PLAYER`:** before
   proposing any candidate as reviewable, check whether the truncated/
   ESPN-derived form already independently matches a *different* real
   BSD player elsewhere in the same dataset. If so, flag the candidate
   as `collision_risk: true` with the colliding player's info attached
   — do not silently exclude it (unlike the MLB case where exclusion
   happened after the fact by a human; here, surface the risk in the
   output itself since the volume may be much higher).

Output: `outbox/soccer-player-crosscheck.json` — `candidates` (with
`collision_risk` flagged inline per point 7), `unmatched`, `untestable`
(competitions with no real finished match available).

## TASK 3: Inline test assertions, run before any real data is touched

```js
assertEqual(extractSurname('T. Weah'), 'Weah', ...);
assertEqual(extractSurname('B. A. Yılmaz'), 'Yılmaz', ...);
assertEqual(extractSurname('N. Da Costa'), 'Da Costa', ...);
```
These are the exact 3 real samples verified in this doc — use them
literally, do not invent new ones as substitutes.

## TASK 4: Verification

```bash
node -c scripts/soccer-player-crosscheck.js
```
Cannot fully verify end-to-end from the CC sandbox (needs live BSD +
ESPN data). Done condition: syntax valid, the 3 inline assertions pass,
`TASK 1`'s real competition list is documented in the outbox manifest
even if the full run itself is chat-side follow-up.

**Chat-side follow-up (not checkable by CC):** trigger via
`workflow_dispatch` (new workflow, `.github/workflows/soccer-player-
crosscheck.yml`, `workflow_dispatch` only, same rationale as the MLB
one — periodic audit tool, not continuous pipeline) against WC26 at
minimum. Review `candidates` — especially anything with
`collision_risk: true` — before adding anything to
`CANONICAL_PLAYER`'s `type: 'soccer_player'` entries (or wherever this
lands, per Task 2's evaluation). Given the higher collision risk
already flagged above, expect a materially lower accept rate than the
MLB run's 11/22.

## TASK 5: Outbox manifest (last task)

State explicitly: the real enumerated competition list from Task 1,
which competitions were untestable and why (expected: most of the
2026-27 European domestic season, confirmed not started), and confirm
the 3 inline assertions passed before any real data was touched.
