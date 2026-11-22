# Claude Code Command — an NFL or CFB game at halftime is served `pre`

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (owns the contract, Rule 60); consumer field-laboratory
**Filed and built:** 2026-11-22 by a field-laboratory session, from the first real halftime body (Rule 87.4: found, fixed, not carried)
**Confidence gate:** >= 95 before any commit
**Status:** DONE for football 2026-11-22 (built `8bdac8e`, deployed, read after the fix at 22:30:39Z and on the field-laboratory page at 22:31:00Z: see "Done condition"); the basketball flag (the section at the end) and the MLB adapter remain open.

---

## What was measured (Rule 73)

Method: field-laboratory's `live-shape-capture.yml` dispatched for `sport=nfl date=2026-11-22` (the relay's `/v2/games`, read from a runner), and ESPN read through the session's `get_espn_game`.
Conditions: Sunday 2026-11-22, the 18:00Z kickoffs, in play.

| capture | what it held |
|---|---|
| 19:10:18Z (`outbox/live-capture-nfl-2026-11-22-1910Z.json`) | 7 games `live`, all Q2 (clocks 8:27 to 0:59), 4 `pre` (later kickoffs) |
| **19:41:15Z** (`-1941Z.json`) | Bills v Dolphins 20-6, Bears v Saints 16-10, Cowboys v Titans 27-9: `state` **`pre`**, `periodNum` 2, `periodLabel` `""`, `clock` `0:00`, scores non-null, `situation` an object with `possession` null. Three other games `live` in Q3, one `live` Q2 0:03. |
| ESPN, same minutes | `get_espn_game` for Bears v Saints: `CHI 16 vs NO 10 | Halftime` |

So a game at halftime was served as a game not started. The cause is in `adaptESPNFootball` (the only caller is the `/v2/games` ESPN branch): `STATUS_IN_PROGRESS` was the only live status, as `adaptESPNBasketball` was before CC-CMD-2026-10-22 gave it `type.state === 'in'`. **Not read:** the status NAME ESPN uses for the NFL break (the summary text said `Halftime`; the fix reads the name `STATUS_HALFTIME`, as the soccer adapter does, and every status ESPN marks `type.state` `in`).

## What was built

`adaptESPNFootball` (NFL and CFB): `state` is `live` for `STATUS_IN_PROGRESS`, `STATUS_HALFTIME` or any `type.state` `in`; `periodLabel` `Q<n>` as before (halftime reads `Q2`, clock `0:00`); `situation.isHalftime` is true exactly when the name is `STATUS_HALFTIME` and is carried even when ESPN sends no situation; every football situation object now has the key. Additive: no key was renamed or removed. Consumers: field-laboratory reads `situation.isHalftime` on any sport and shows `Half time`; AmbientDO's live counting reads `state` and now counts a break as live, as it does for basketball since 2026-10-24.

Checks: `scripts/check-v2-games-nba-board.mjs` (run by `deploy.yml` with `--mutate`) gains the football board: 7 NFL events (in progress, halftime with and without ESPN's situation, end of quarter, final, scheduled, postponed), 7 assertions F1 to F5; self-test 23 ok; `--mutate` **14 of 14 caught** (four new: a football break read as pre again, read by name alone, never flagged, the flag lost without a situation). `check-ambient-capture-dedup`, `check-v2-games-ambient-no-briefs` and `sport-key-check` pass. Not checked: `sport=cfb` (the same adapter), the MLB adapter.

## Not done, with the command that does it

The MLB adapter (`adaptESPNMLB`) reads only `STATUS_IN_PROGRESS` as live, so a rain delay or a break between innings may be served `pre`; its ESPN status names are not read. Out of season on 2026-11-22. Unblocked when an MLB game is in a delay or a break. Verify: `live-shape-capture.yml` (field-laboratory) with `sport=mlb` and the ET date during a game, then print each game's `state` and `periodLabel`; any game ESPN calls delayed or in a break that reads `pre` is the defect, and the fix is the same one line.

## Done condition (Rule 90 artifacts)

1. `deploy.yml` green for the commit that adds this file (the board check and its `--mutate` run inside it).
2. A relay body for an NFL game at halftime reads `state` `live`, `periodLabel` `Q2`, `situation.isHalftime` `true`: a committed field-laboratory capture `outbox/live-capture-nfl-2026-11-22-<HHMM>Z.json` taken at the halftime of the late games (kickoff about 21:05Z to 21:25Z, halftime about 22:20Z to 23:00Z). Command: `node -e 'const j=require("./outbox/<file>");console.log(j.v2.body.games.filter(g=>g.situation&&g.situation.isHalftime).map(g=>[g.espnEventId,g.state,g.periodLabel,g.clock]))'`; a non-empty list, every `state` `live`.
3. Optionally the card: a field-laboratory `live-score-probe.yml` manifest with a card reading `Half time`.

## Added 2026-11-22 21:5xZ: the same flag for basketball

The first NBA halftime body (field-laboratory capture `outbox/live-capture-nba-2026-11-22-2141Z.json`, 21:41:15Z): Hawks v Pistons, `state` `live`, `periodNum` 2, `periodLabel` `Q2`, `clock` `0.1`, scores 51-52, `situation` `{ quarter: 2, clock: "0.1", possession: null }`, no flag; ESPN's own summary for the game read `Halftime`. So basketball was right on `state` (CC-CMD-2026-10-22) and the card could only show `Q2 0.1`. `adaptESPNBasketball` (NBA, WNBA, AFL) now sets `situation.isHalftime` true exactly for `STATUS_HALFTIME`; the board check holds it (N9; `--mutate` 15 of 15 caught). **Not read:** the status NAME ESPN uses at an NBA halftime (the flag is false and the card unchanged if it is not `STATUS_HALFTIME`). Done condition 2b: a field-laboratory capture at a later NBA halftime (Heat v Thunder tipped 23:00Z, halftime about 23:55Z; the 00:00Z games about 00:55Z) with `situation.isHalftime` true: `node -e 'const j=require("./outbox/<file>");console.log(j.v2.body.games.filter(g=>g.situation&&g.situation.isHalftime).map(g=>[g.espnEventId,g.state,g.periodLabel,g.clock]))'`.

## Done condition 2 and 3, read 2026-11-22 (football)

2. **Read.** field-laboratory capture `outbox/live-capture-nfl-2026-11-22-2230Z.json` (22:30:39Z, after the deploy): Jets at Chargers (`401873074`) `state` `live`, `periodNum` 2, `periodLabel` `Q2`, `clock` `0:00`, scores 10 (home) and 17 (away), `situation` `{ down: 1, distance: 10, yardLine: 35, possession: null, isRedZone: false, isHalftime: true }`; ESPN's summary for the game read `LAC 10 vs NYJ 17 | Halftime`. Because the flag is set by the name `STATUS_HALFTIME` alone, ESPN's NFL halftime status name is `STATUS_HALFTIME`. Other games in the same body: `live` Q2 with `isHalftime` false, `post` with `situation` null.
3. **The card.** field-laboratory `live-score-probe` manifest `outbox/live-score-manifest-2026-11-22-20261122-2232Z.json` (22:31:00Z, deployed `db3b9b53`): verdict PASS, `halfTimeMarker` true, Jets @ Chargers `In progress` `17–10` with the note `Half time`.
