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
