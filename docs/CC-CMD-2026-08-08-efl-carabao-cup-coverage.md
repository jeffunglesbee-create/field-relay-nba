# CC-CMD-2026-08-08-efl-carabao-cup-coverage

**Repo:** field-relay-nba **and** jubilant-bassoon (paired, Rule 70)
**Branch:** main in both — commit directly, no feature branch, no PR

One-liner:
```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-08-08-efl-carabao-cup-coverage.md. Execute all tasks.
Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```

---

## ⚠️ Blocked by a P0 — read this first

`CC-CMD-2026-08-08-espn-site-api-403-p0` must land first. Relay-side ESPN
scoreboard reads currently 403 for **every** sport, so wiring the EFL Cup
now would add a competition onto a pipeline that returns nothing. Confirm
`/v2/games?sport=epl` returns 200 before starting.

## Real, probed facts (Rule 68 — measured, not assumed)

CI run [`31257247214`](https://github.com/jeffunglesbee-create/field-relay-nba/actions/runs/31257247214)
+ `html_probe` from the CF Worker IP, both 2026-08-08:

- **Slug: `eng.league_cup`.** `eng.efl_cup` and `eng.carabao` return
  HTTP 400 — they do not exist. Do not guess these.
- `leagues[0]`: `name='English Carabao Cup'`, `abbreviation='Carabao Cup'`,
  `id='3920'`, `midsizeName='ENG.LEAGUE_CUP'`, `slug='eng.league_cup'`.
- **It has already started.** Round 1 was live during probing
  (`Cambridge United vs Barnet`, `STATUS_FIRST_HALF`, 31'). 31 fixtures
  in the next 60 days.
- Real US broadcasts present on some ties: `Paramount+`.
- ESPN publishes a full round calendar for the season:
  Preliminary (Aug 1-3), First (Aug 6-10), Second (Aug 18-31), Third
  (Sep 1-28), Fourth (Sep 29-Nov 2), QF (Nov 3-Dec 28), SF (Dec 29-Feb 8),
  Final (Feb 9-May 31 2027).
- Neither repo has any `eng.league_cup` / Carabao entry today (grepped
  both, 2026-08-06 and re-confirmed 2026-08-08).

**Adjacent, deliberately OUT of scope** (found while probing, listed so a
future session doesn't re-discover them): `eng.trophy` = "English EFL
Trophy" (id 18481, 52 fixtures/60d), `eng.fa` = "English FA Cup"
(id 3918, 0 fixtures in window — starts later). Each needs its own
CC-CMD; do not add them here (Rule 69).

## Task 1 — Re-verify from HEAD before writing anything

- Re-probe `eng.league_cup` and confirm the name/abbreviation above still
  match; competitions get renamed by sponsor.
- Re-read the real current `LEAGUES`, `SOCCER_LEAGUE_LABELS`, and
  `V2_LEAGUES` in `src/index.js`, and `SOCCER_LEAGUES` in
  jubilant-bassoon `src/legacy/field.js`. Line numbers move — locate by
  name.

## Task 2 — Relay (deploys first, per Rule 70)

- `SOCCER_LEAGUE_LABELS`: add a key whose value is the label the archive
  and journalism layers should persist. **This is load-bearing:** the
  2026-08-06 soccer-label fix made all three archive-write sites send
  `sport: gm.league`, and `soccer-league-mislabel-scope-probe.yml` (weekly)
  asserts every WC-family-labelled row really is the World Cup. A new
  soccer competition that is absent from these tables is exactly the shape
  that regression guard exists to catch.
- `LEAGUES` (inside `handleJournalismCycle`): add
  `{sport:'soccer', league:'eng.league_cup', label:'<chosen label>'}` so
  the competition is seeded/caught-up/archived like every other league.
  **Whatever label is chosen must be identical in both places** — the
  archive `id` prefix is built from it.
- `V2_LEAGUES`: add an entry with `espnLeague:'eng.league_cup'` if the
  client is to read it via `/v2/games`; match the existing soccer entries'
  shape exactly (Rule 62).
- Do **not** touch `canonicalizeWC26Sport()` — a Carabao Cup label must
  never be normalized into the WC bucket.

## Task 3 — Client (only after the relay is deployed)

- `SOCCER_LEAGUES` in `src/legacy/field.js` is the **card-creation**
  mechanism — its own comment states V2/FD only overlay scores onto cards
  that already exist, so without an entry the competition renders zero
  cards no matter what the relay serves. Add
  `{ league:'eng.league_cup', section:'<section>', bundle:'<bundle>', leagueLabel:'<label>' }`.
- Broadcast bundle: real probed value is `Paramount+` on some ties.
  Reuse an existing bundle if one already maps Paramount+; only add a new
  one if none does (Rule 62). Do not invent a bundle for ties whose
  `broadcasts` array is genuinely empty — most Round 1 ties have none.
- Check `isDomesticLeagueInBreak` / `DOMESTIC_LEAGUE_BREAK_2026`: a cup
  running Aug-Feb must not be gated by an EPL-shaped break window.
- `node smoke.js index.html` must show 0 failed.

## Task 4 — Verification (Rule 89 — artifacts)

1. `probe_relay_route /v2/games?sport=<newkey>&date=<a real fixture date
   from the calendar above>` returning HTTP 200 with a non-empty `games`
   array and `league` equal to the chosen label — not a known-bad value,
   not `FIFA World Cup`.
2. A run of `soccer-league-mislabel-scope-probe.yml` in `verify` mode
   showing **0** mislabeled rows after the new competition has archived at
   least one fixture — proving the new label flows through the 2026-08-06
   fix correctly rather than landing in the WC bucket.
3. Client: `node smoke.js index.html` → 0 failed, plus the real rendered
   evidence pattern this repo requires for visual claims.

## Outbox

`outbox/cc-session-2026-08-08-efl-carabao-cup-coverage.md`: the re-probed
slug/name, the exact label chosen and every place it was written, the
relay deploy run ID, the client smoke count, and the Task 4 artifacts.

## Addendum 2026-11-26 — capture the Carabao Cup: `bsdLeagueId` 40 (built on the owner's "Capture the carabao cup")

**Why this is here (BUILD-ON-A).** This CC-CMD set `eflcup` to `bsdLeagueId: null` for the reason "no BSD id for this competition was verified", which was true on 2026-08-08. On 2026-11-26 the probe for the join (`docs/CC-CMD-2026-10-27-bsd-event-id-on-game-rows.md`, "Addendum 2026-11-26") found BSD's league list (`outbox/bsd-leagues-2026-11-04T16-25-21-491Z.json`) holds "Carabao Cup (England)" as league 40, and the owner then asked for the capture. **Outcome of this addendum:** built and deployed 2026-11-26; the live proof waits for a Cup match (STAGED below). Rulings read first: `docs/CC-CMD-2026-08-02-gate-bsd-club-league-capture.md` gates the capture's cadence to `*/5` and says no BSD rate limit was documented; it holds nothing against adding a league, and the cadence is unchanged.

### What a league id switches on (read from `src/index.js`, 2026-11-26)

`bsdLeagueId` has one reader: `BSD_LEAGUE_ID_TO_SLUG`, used by `runBSDClubLeagueEndgameCapture` (called on the `*/5` cron). That function already reads `/api/v2/events/live/` every tick for every league at once. For a live event whose league id is in the map, not finished, and at minute 80 or later (or not-started with kickoff 80 to 120 minutes ago), it writes `momentum.json`, `incidents.json`, `stats.json` (and `average-positions.json` when populated) to R2 under `bsd/<slug>/<bsd event id>/`, overwriting each tick. With the id set, the slug is `eflcup`. **Nothing else reads the id**: the join, the archive, the V2 routes and the seed manifest do not.

**Cost (Rule 78), from the function and pinned by the check:** the `/live/` read is made anyway, so a tick with no Cup match live costs nothing new. A Cup match in its window costs exactly 3 BSD requests per tick (momentum, incidents, stats), at most 9 ticks (minutes 80 to 120 at `*/5`), so at most 27 requests per match. A night of four Cup matches (a quarter-final round) is at most 108, plus the live reads that were being made. Of the competition, the archive shows rounds 1 to 4 played (35, 16, 8 and 8 ties on 2026-08-07 to 2026-10-29 by the rows read); the quarter-finals, semi-finals and final remain, at most 9 matches on the format (inferred from the 8 round-4 ties, not read from a calendar), so at most 243 requests for the rest of the season. BSD's quota is unknown (the pricing page says 7,500 a day and, unattributed, 100 a day; no `RateLimit` header: `outbox/bsd-request-budget-latest.json`); the capture already runs for ten leagues, including nights of dozens of matches.

**Effect on the next-goal census and grade:** the census counts a call as gradeable only when R2 holds an `incidents.json` for its event (`scripts/bsd-next-goal-census.mjs`), and takes the slug from the R2 directory name. So `eflcup` appears in `analysis.r2.eventsPerSlug` and, with ledger calls on those matches, in `gradeableBySlug` once a Cup match has been captured, with no change to either script. The registry's league-id set (`fieldLeagueIdsFromSource`) gains 40, which moves the informational counts "in a tracked league" and "tracked league without an incidents key"; the five census and probe checks, 241 + 102 + 96 + 66 + 126 assertions, pass unchanged.

### Done conditions (Rule 89, artifacts)

1. **The map and the behavior, offline, on the real code:** `scripts/check-bsd-club-capture-leagues.mjs` cuts `V2_LEAGUES`, `BSD_LEAGUE_ID_TO_SLUG`, `captureWithRetry`, `_bsdCaptureStatsWithAvgPositions` and `runBSDClubLeagueEndgameCapture` out of `src/index.js` and runs them against a scripted live feed and a recording R2: the ten-league map (`40: 'eflcup'`), a Cup match at 85' and one on the not-started fallback written under `bsd/eflcup/<id>/`, finished, early, untracked and out-of-window matches not, MLS unchanged, **3 requests per captured match and 13 for four matches plus the live read**. Against the old registry it failed 8 of 12 assertions; with the id it passes 12 of 12. `scripts/mutate-bsd-club-capture-leagues.mjs`: **17 of 17 mutations caught**, controls ok.
2. **Deploy:** run recorded in the session doc `outbox/cc-session-2026-11-26-carabao-cup-capture.md`.

### STAGED (Rule 74): the live capture of a real Cup match

- **What is staged:** R2 objects under `bsd/eflcup/` written by the cron from a real match.
- **What blocks it:** no Carabao Cup match has been live since the id was set (the next round, the quarter-finals, is not in this repo's data: ESPN lists a round's ties only once the round before has resolved, and the round-4 ties were played 2026-10-27 to 2026-10-29). And one thing is unverified until then: whether BSD's `/api/v2/events/live/` lists Cup matches at all (the 2026-07-14 comment records that it excludes national-team competitions; nothing says it excludes cups).
- **Unblocked when:** a Carabao Cup match reaches minute 80 on a `*/5` tick.
- **Verify with** (after that match): dispatch `bsd-next-goal-census.yml` on `main`, then `node -e "const a=JSON.parse(require('fs').readFileSync('outbox/bsd-next-goal-census-latest.json','utf8')); const n=a.analysis.r2.eventsPerSlug.eflcup; console.assert(n>=1, 'no eflcup directory: '+n)"`. If the match was played (the archive reader `read-archive-label-dates.yml` with `like` = `EFL Cup` shows a date after 2026-10-29) and `eflcup` is absent, BSD's live feed does not carry the Cup or the window was missed: investigate on the next Cup night: read `/api/v2/events/live/` with the relay's BSD token from a runner while the match is in its window and count the events whose `league_id` is 40 (counts only, no names), and read the `[BSD-CLUB-ENDGAME]` lines in the worker's logs; do not rationalize.
- **Automated:** a follow-up is scheduled for 2026-12-19 (after the likely quarter-final week) to run exactly this and report.

