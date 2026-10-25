# CC session 2026-10-24 — the NBA board moves to ESPN; closing capture run 1; coverage gaps DONE; NBA CC-CMD DONE

**Date:** 2026-10-24 · **Repo:** field-relay-nba (+ jubilant-bassoon CONTRACTS.md)
**HEAD:** `36e44f1` → `9c976bc` → `b85fd31` → `eedb26c` → `37f5411` → `5919cab` → `f8560d0` → `0b7c89d` → `a9e56de` → `0c9e434` → the close-out commit
**Branch:** main. Commit identity `claude@field.dev` / FIELD CI (owner, 2026-10-23).

## Per commit

| commit | what |
|---|---|
| `9c976bc` | docs: anchored the four byPair citations from `36e44f1`. Repo guards were red on the citation ratchet (13 against a budget of 9) and are green again (run 40047083973) |
| `b85fd31` | docs: closing-capture done condition 3, run 1 PASS (closed day 10-23, 0.8x, run 40088714137). Coverage gaps DONE |
| `eedb26c` | ci: `nba-cdn-egress-probe.yml` and `scripts/nba-cdn-egress-probe.mjs`, the runner probe for TASK 0 premise 2 (self-test 7/7, 5 of 5 mutations). Its log is `37f5411`: VERDICT `cdn-refuses-the-worker` |
| `5919cab` | fix: the NBA board on `/v2/games` is ESPN's (docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md TASK 1). Deploy run 40102174240 |
| `f8560d0` | docs: the NBA CC-CMD's TASK 0 and TASK 1 results; CONTRACTS.md /v2/games NBA contract; notes added to the 18x and brief-route CC-CMDs |
| `0b7c89d` | docs: two new CC-CMDs filed, v2-final-word (owner's decision) and v2-games-callers-ask-utc-date |
| jubilant-bassoon `b45a46d1` | docs: CONTRACTS.md synced; identical to the relay copy |
| `a9e56de` | docs: Live check 1 (the first NBA closing line, 21:50:12Z, exact spend) |
| `0c9e434` | docs: Live check 2 (premise 1 confirmed in live play; the break reads `'live'`) |
| close-out commit | docs: Live check 3 (all 8 lines, 6 calls, 18 credits), the NBA CC-CMD DONE, the box-score CC-CMD filed, HANDOFF, this doc |

## How the NBA change was made

1. **Found by run 1.** 7 of 10-23's 18 demanded games went unbought, all NBA. The
   board answered `nba-cdn-empty` for every date, and there have been 0 NBA
   capture rows since 10-15.
2. **BUILD-ON-A.** `docs/CC-CMD-2026-10-22-nba-cdn-403-in-season.md` already
   owned the finding and was filed but undispatched, with no holds. It was built,
   not re-filed.
3. **Premise 2** from a runner. **Premise 3** and the TASK 1 design from a
   read-only map plus a critic (workflow wf_c5379dd3-9f6).
4. **Adversarial review** (workflow wf_b338e9b9-f0d): 7 confirmed, 2 refuted.
   - Fixed before the push: breaks read as `'pre'` (AmbientDO could send
     `all_final` early), a fixture date that would have blocked deploys on
     2026-11-07, a wc26 control, and stale comments.
   - Filed: GameDO's UTC date. Added to an existing CC-CMD: the brief-route
     `espn:` id.
5. **Gates:** 132 of 134 deploy and guards steps on a clean tree, twice. The 2
   failures need a secret or a GitHub list call that the sandbox lacks.
6. **Pushed** at 14:22Z, inside a capture gap (14:20-15:40Z). Repo guards
   40102174221 and the deploy are green.

## Integration state (Rule 65)

- **RELAY CONTRACT:** `GET /v2/games?sport=nba&date=YYYY-MM-DD`
  - 200 `{sport, date, games, count, source:'espn-wc', ts}`.
  - 502 when ESPN refuses; 500 when the fetch throws.
  - Games: `id 'espn:<id>'`, `espnEventId`, `league 'NBA'`,
    `state 'pre'|'live'|'final'`.
  - Cache: `max-age=15`.
  - Written into CONTRACTS.md in both repos.
- **CLIENT CONSUMERS:**
  - AmbientDO closing capture: matches `espnEventId` to the archive's
    `espn_event_id`.
  - jubilant-bassoon `fetchV2Games` / `mapV2ToESPN`: no change needed, because
    the final word is kept.
- **VERIFIED, live at 14:29Z:**
  - 10-24 returns 8 games, every `espnEventId` equal to the archive's;
  - 10-23 returns 12 finals.
- **VERIFIED, live 2026-10-24 and 10-25 (was STAGED):**
  - **Premise 1.** At 23:09:30Z game 401909853 was `'live'` (Q2 1:47) while the
    relay's `/nba/liveData/scoreboard/todaysScoreboard_00.json` answered 403.
  - **The break.** At 23:19:58Z, clock `0.0` with two quarters in `linescores`,
    the board answered `'live'`, `periodLabel 'Q2'`, and AmbientDO listed the
    game in `liveGames`. ESPN's raw status name for the break (halftime or
    end-of-period) was not observed; `check-v2-games-nba-board.mjs` N1 covers
    both names.
  - **The slate.** 8 closing lines for 8 games, each verified and 9:47 to 9:59
    before its own `start_time`; 0 of 8 rows with `closing_odds IS NULL`; 6
    calls and 18 credits for 6 kickoff groups. The budget windows from 18:33Z
    tie to the credit.
  - **Unattributed:** one 3-credit call on closed day 10-24 before 18:33Z has
    no `change_log` row. It precedes the first NBA capture. Noted in the 18x
    CC-CMD for run 2.
- **KNOWN MISMATCHES:**
  - WNBA and AFL finals say `'post'`, which the client reads as live
    (`docs/CC-CMD-2026-10-24-v2-final-word.md`, the owner's call).
  - The client's brief route reads a key nothing writes
    (`docs/CC-CMD-2026-10-22-journalism-game-route-prefixed-ids.md`).

## Open, each with a home

- The client box-score and play-by-play paths on `/nba/*`, still 403:
  `docs/CC-CMD-2026-10-25-nba-boxscore-path-cdn-403.md` (FILED; the direction is
  the owner's, and its TASK 0 premises are listed there).
- **Rule 45:** whether ESPN may serve the NBA board is for human review. The
  journalism cron already reads the same URL.
- Run 2 of the closing-capture done condition: 2026-10-25 11:07Z. Its prompt now
  splits 10-24's NBA groups at the deploy instant.
- The shared join (`docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`)
  is held locally until after run 2 and lands through
  trig_011RY5nqXRt4WB71e45va5Rd at 10-25 12:30Z. The patch is
  `outbox/staged-shared-join-2026-10-24.patch`.
