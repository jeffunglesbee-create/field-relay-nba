# CC-CMD-2026-08-08-fa-cup-coverage

**Status 2026-11-07: BUILT. UNBLOCKED 2026-11-06; relay half BUILT, DEPLOYED and VERIFIED live (route and archive); laboratory half LIVE; client half BUILT and pushed (jubilant-bassoon `dfd5712`, owner's order "Add a new key"), LIVE: the first push `dfd5712` failed the deploy gate's Rule 99 ratchet (a `|| 0` in the render harness under `outbox/`) and deployed nothing; the fix `bbed0c0` plus a dispatched Deploy gate (run `42386741813`) `success`, its own confirm step reading the live site serving `SW_VERSION 2026-11-07a`; the Live Deploy Verify Probe (run `42387005410`, `outbox/live-deploy-verify-20261107T153503Z.txt` in jubilant-bassoon) read HTTP 200, 2139112 bytes, `SW_VERSION = "2026-11-07a"`, slugs `eng.fa`, `eng.league_cup`, `eng.trophy` and labels `"EFL Cup"`, `"EFL Trophy"`, `"FA Cup"` in the deployed bundle; Smoke Test + Live Verify (run `42386735228`) `success`. Open: Task 6 (past-date navigation), and the first live FA Cup match on the deployed page (2026-11-08).**
- **Task 1, the unblock probe: DONE.** The criterion below is measured, not inferred: `scripts/probe-fa-cup-season.mjs` (runner run
  `42311014646`), artifact `outbox/probe-fa-cup-season-2026-11-06T23-18-47-844Z.json`. 4 of 6 reads answered with a payload (the `dates=` range
  shape answered HTTP 400 on both hosts, so the first fixture date came from the default scoreboard): all 4 `UNBLOCKED`, `season.year` 2026,
  type `First Round`, "2026-27 English FA Cup", two events dated 2026-11-06 (Bristol Rovers v Cambridge United 19:30Z, Oxford City v Leicester
  City 19:45Z). The ESPN league id `3918` in this document is from 2026-08-08 and was not re-read (the probe records no `id`): UNVERIFIED.
  An earlier probe (`probe-efl-cup-slug.yml`, run `42309071973`) printed only the league name and `events=2`; it did not read the criterion.
- **Tasks 2 and 3, the relay half: BUILT** in the push of 2026-11-07 (`feat: FA Cup (eng.fa) on the relay`, with the gate edits it needed).
  The three sites named below plus two more the newer gates require: `detectSportClass` (`'fa cup'`, `'facup'`) and
  `FAMILIES.soccer.labels` in `src/morning-report.js`, and the verifier's independent copy in `scripts/lib/morning-report-oracle.mjs`.
  Task 3's artifact: `check-leagues-label-contract.mjs` prints SOCCER_LEAGUE_LABELS 18 -> 19, LEAGUES rows 21 -> 22 (15 -> 16 soccer),
  V2_LEAGUES soccer keys 17 -> 18, `uncovered=[]`. The "scope boundary" below is amended: those extra sites were required, and
  `check-individual-sports-not-archived.mjs` `EXPECTED` 22 -> 23.
- **Task 5, live verification of the relay: DONE for the route, STAGED for the archive.** Deploy RELAY Worker run `42322923778` `success`.
  `probe_relay_route /v2/games?sport=facup&date=2026-11-06` returned HTTP 200, `"league":"FA Cup"`, `"round":"English FA Cup, First Round"`,
  `count: 2` (Bristol Rovers 2-0 Cambridge United; Oxford City 2-4 Leicester City; the home side is the venue's club in both); the route was read 2026-11-07 for the game date 2026-11-06.
  Still owed: a date that was not already over (2026-11-07..09) and the archive rows. The archive row check is
  `SELECT sport, COUNT(*) FROM regular_season_games WHERE sport = 'FA Cup' GROUP BY sport` after the 10:00Z row creation of a day with fixtures.
- **Task 5, archive and a day not over: VERIFIED 2026-11-07.** `regular_season_games` holds `sport = 'FA Cup'` rows: 2 for 2026-11-06 and 33 for
  2026-11-07 (D1 read 12:11Z, after the 10:00Z creation); `/v2/games?sport=facup&date=2026-11-07` returned HTTP 200, `"league":"FA Cup"`, `"state":"pre"`,
  `"round":"English FA Cup, First Round"`, 15:00Z kickoffs; `date=2026-11-08` returned 4 games (Stafford Rangers v Grimsby Town 12:00Z, Cray Wanderers v
  Stockport County 14:15Z, Wimborne Town v Crawley Town 15:00Z, Oldham Athletic v Sheffield Wednesday 17:15Z).
- **The laboratory half is LIVE as of 2026-11-07 12:50Z** (see the deploy note in `outbox/cc-session-2026-11-07-lineup-join-and-fa-cup.md`): the page for 2026-11-07
  holds 75 soccer cards, 42 BSD-covered plus 33 FA Cup by arithmetic (`outbox/lineups-live-manifest-2026-11-07T12-57-19.json`); a read of the FA Cup sport group
  itself was not made.
- **Task 4, the client half: BUILT 2026-11-07 in jubilant-bassoon `dfd5712`; the CC-CMD's bundle was contradicted by the probe and the owner ruled "Add a new key".**
  Task 4 below says `bundle: 'EFL'` (Paramount+/Fubo/Hulu). `/v2/games?sport=facup&date=2026-11-08` serves ESPN+ on all 4 games, but ESPN's own scoreboard for
  2026-11-07 lists ESPN+ on only 2 of 33 (`outbox/probe-fa-cup-scoreboard-limit-2026-11-07T14-27-37-477Z.json`: 31 empty broadcasts arrays), so "every FA Cup game
  streams on ESPN+" is false (it was said to the owner, from the 4 games of 11-08, and is corrected here). Built: `BUNDLES.FA_CUP = ["espnplus"]` (a new key, the
  only one that is ESPN+ alone); the `SOCCER_LEAGUES` entry `{ league: 'eng.fa', section: 'FA Cup', bundle: 'FA_CUP', leagueLabel: 'FA Cup', limit: 100,
  bundleIfListed: 'espn+' }` (`limit` because the default of 30 dropped 3 of the 33 games of 11-07; `bundleIfListed` so ESPN+ is attached only where ESPN lists it,
  in `fetchSoccerFixtures` and the date sweep; delete it for the static behaviour of every other entry); and the `'fa cup'` token at ten soccer routers
  (`classifySport` first: without it `findScore` returns null for a live game, found by an independent review before the push; executed on a live 2-1,
  HEAD `null`, now `2-1`). Task 4's artifact, executed (smoke FA-6): `isDomesticLeagueInBreak('FA Cup', d)` false on 2026-11-07, 2027-01-10, 2027-03-07 and
  2027-05-16, `Bundesliga` control true on 2026-07-01. Smoke 1066 -> 1074, units 70 -> 76, 25 of 25 mutants caught, `SW_VERSION` 2026-11-07a.
  Session doc `outbox/cc-session-2026-11-07-fa-cup-client.md` in jubilant-bassoon.
- **Task 6 (open, added 2026-11-07 by the review of the client half): past-date navigation has no FA Cup.** `goToDate` for a date before today calls
  `fetchRelayDateSections`, which walks `FIELD_V2_SOURCES` and looks each key up in `V2_SECTION_LABEL`; neither has `facup`, `eflcup` or `efltrophy`, so
  "Yesterday" on 2026-11-08 shows no FA Cup games (the same gap the two EFL cups already have; reproduced by the review, not a regression). Blocked by: nothing on the
  relay (`/v2/games?sport=facup&date=` already answers); it is a client edit in `FIELD_V2_SOURCES` and `V2_SECTION_LABEL` plus the injector pair
  `scripts/check-v2-section-labels.mjs` enforces, and a decision whether the two EFL cups join it. Verify: on a past date with FA Cup games, `goToDate(iso)` renders
  a section labelled `FA Cup` (`scripts/check-relay-date-sections.mjs` is the executed home for it). Also recorded: the date sweep caches its result for the tab
  session, so a stream decision made from ESPN's listing at first load is not revisited (pre-existing cache behaviour, consequence not shown).
- **Task 4, the client half (as written before that probe):** Blocked by: Rule 70 (the relay deploys first) and the live verification above. The laboratory half
  (LAB-FIRST: `Sport.FACup` in `Desk.fs`, `sport-registry-check` count) is the consumer the owner named on 2026-11-06 ("fa cup is missing").
  The jubilant-bassoon `SOCCER_LEAGUES` entry (card creation on the served page) remains owed by this CC-CMD.
- **Found while building, filed:** `docs/CC-CMD-2026-11-07-wc-results-club-contamination.md` (club games are written into the World Cup tables,
  FA Cup would add four more writing rounds from January).

Wire the FA Cup (`eng.fa`) into relay + client, following the pattern
already proven twice: `eng.league_cup` (EFL Cup) and `eng.trophy` (EFL
Trophy). This exists as its own CC-CMD rather than being executed in the
EFL Trophy session because of a real external block, stated below with
its unblock criterion (Rule 74) — not because the work was deferred.

## Why this is blocked, and what unblocks it

Probed 2026-08-08 from CF-Worker egress
(`site.web.api.espn.com/apis/site/v2/sports/soccer/eng.fa/scoreboard?dates=20260801-20261031`,
HTTP 200):

```
id 3918, "English FA Cup", slug eng.fa
season: { year: 2025, displayName: "2025-26 English FA Cup",
          type: { name: "Final" } }
events: []
```

The distinguishing fact versus the EFL Cup case: it is not merely that
`events` is empty for a future round — for `eng.fa` **ESPN's league
`season` object itself is still the finished 2025-26 season sitting at
type `Final`.** ESPN has not rolled this competition over to 2026-27 at
all. Compare `eng.trophy` probed in the same minute, which returned
`season.year: 2026`, `"2026-27 EFL Trophy"`, type `Group Stage`, with
real fixtures. Wiring `eng.fa` against a season ESPN has not opened
would ship a permanently-empty section with no way to verify it
end-to-end (Rule 61), and no way to confirm the label the adapter
actually emits.

**UNBLOCKED WHEN** the probe below reports `season.year` 2026 (or later)
— i.e. ESPN opens 2026-27. FA Cup First Round Proper is historically
early November, and qualifying rounds are typically not carried by ESPN,
so expect this around Oct–Nov 2026.

**Unblock probe (run this first; if it still says 2025, stop and change
nothing):**

```
mcp html_probe -> https://site.web.api.espn.com/apis/site/v2/sports/soccer/eng.fa/scoreboard
  assert leagues[0].season.year >= 2026
  assert leagues[0].season.type.name != "Final"
```

`html_probe` rather than curl: this sandbox's proxy returns
`CONNECT tunnel failed, response 403` for ESPN hosts (confirmed
2026-08-08 via `curl -sS`), and `site.api.espn.com` additionally 403s
Cloudflare Worker egress — which is why the relay was re-pointed to
`site.web.api.espn.com` in the ESPN P0 fix. Use `ESPN_API_BASE` from
`src/index.js`, do not write the host from memory.

## Tasks

1. **Probe block.** Run the unblock probe above. Then re-read, from
   current HEAD rather than from this document:
   - `src/index.js` — the three `efltrophy` sites (`V2_LEAGUES`,
     `SOCCER_LEAGUE_LABELS`, and `LEAGUES` inside
     `handleJournalismCycle`). `grep -n "efltrophy" src/index.js`.
   - `src/legacy/field.js` (jubilant-bassoon) — the `eng.trophy` entry
     in `SOCCER_LEAGUES`.
   Record the real ESPN `id`, `slug`, and first fixture date.

2. **Relay half, deployed first (Rule 70).** Add the same three coupled
   entries, keyed `facup`:
   - `V2_LEAGUES.facup` → `espnLeague: 'eng.fa'`, `bsdLeagueId: null`
     (do not invent a BSD id — Rule 2), `season` per the probe
   - `SOCCER_LEAGUE_LABELS.facup = 'FA Cup'`
   - `LEAGUES` (journalism cron) → `{sport:'soccer', league:'eng.fa', label:'FA Cup'}`

   The two label strings must be **byte-identical**. Three archive-write
   sites send `sport: gm.league`; that value persists into the archive
   `sport` column and leads the archive id, so a mismatch splits one
   competition across two id namespaces — the exact cleanup
   `CC-CMD-2026-07-15-wc-label-fragmentation` had to perform for WC26.

   `'FA Cup'` and not ESPN's `"English FA Cup"`: consistent with the
   `EFL Cup` / `EFL Trophy` labels already in the table, and the FA Cup
   has carried sponsor names (Emirates FA Cup) that must not enter the
   archive id.

   **Do NOT write curly-brace characters in comments inside
   `SOCCER_LEAGUE_LABELS`.** The deploy's "Soccer league label contract
   check" parses that literal with a body class excluding both braces; a
   single brace truncates the match and fails the step with
   "SOCCER_LEAGUE_LABELS constant not found" (run 31276384066).

3. **Run the label contract check locally before pushing.** Extract the
   base64 payload from the `Soccer league label contract check` step in
   `.github/workflows/deploy.yml` and run its two regexes against your
   edited `src/index.js`.
   **Artifact:** the printed `labels` count, `routed` count, and
   `uncovered` list. Both counts must increase by exactly 1 versus
   pre-edit, and `uncovered` must be `[]`.

4. **Client half (jubilant-bassoon).** Add to `SOCCER_LEAGUES`:
   `{ league: 'eng.fa', section: 'FA Cup', bundle: 'EFL', leagueLabel: 'FA Cup' }`
   — reuse an existing `BUNDLES` key, confirmed against the probed
   `broadcasts[]`; do not invent a bundle. `SOCCER_LEAGUES` is the
   card-CREATION mechanism (V2/FD only overlay scores onto cards that
   already exist), so the competition renders zero cards without it.

   Bump `SW_VERSION` in `src/legacy/field.js` AND `sw.js` (must match),
   then `node scripts/sync-source.mjs`. Never edit `index.html`'s script
   block directly.

   **Artifact:** `node smoke.js index.html` printing `0 failed`, and the
   executed output of `isDomesticLeagueInBreak('FA Cup', d)` for four
   dates spanning the competition — all must be `false`, with a
   positive control (`'Bundesliga'` on a date inside its winter break)
   returning `true`. Execute the function; do not reason about the
   substring match.

5. **Live verification.**
   - Relay: `probe_relay_route /v2/games?sport=facup&date=<a date with
     fixtures from Task 1>`.
     **Artifact:** HTTP 200 and `"league":"FA Cup"` in the body — the
     chosen label, not the raw key `facup`, and not any WC label.
   - Client: `html_probe` the live client URL and grep the deployed
     bundle for `eng.fa`.
     **Artifact:** the literal string `eng.fa` present. Do not assert on
     unminified spacing — the pipeline runs esbuild + strip-comments,
     which is why a `section: 'FA Cup'`-shaped grep would report NOT
     FOUND for a feature that shipped fine (this happened on run
     31278050296).

## Done condition

All four artifacts above produced: label check `uncovered=[]` with both
counts +1; smoke `0 failed`; relay returning `"league":"FA Cup"` for a
date with real fixtures; `eng.fa` present in the live client bundle.

If Task 1's unblock probe still reports `season.year: 2025`, the done
condition is instead: **no code changes, and an outbox note recording
the probe output and the date checked.** Do not wire a competition ESPN
is not serving.

## Scope boundary

Only the entries named above. Do not touch `adaptESPNWCSoccer`,
`canonicalizeWC26Sport`, any archive-write site, `BUNDLES`, or
`DOMESTIC_LEAGUE_BREAK_2026`.
