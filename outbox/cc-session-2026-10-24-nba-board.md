# CC session 2026-10-24 — the NBA board moves to ESPN; closing capture run 1; coverage gaps DONE

**Date:** 2026-10-24 · **Repo:** field-relay-nba (+ jubilant-bassoon CONTRACTS.md)
**HEAD:** `36e44f1` → `9c976bc` → `b85fd31` → `eedb26c` → `5919cab` → `f8560d0` → `0b7c89d` → this doc
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
- **STAGED (Rule 74):** NBA closing lines bought tonight.
  - Blocked by: no NBA kickoff until 22:00Z.
  - Unblocked by: the 22:00Z tip.
  - Verify: D1 `change_log` `closing_odds_capture` rows for
    `NBA_2026-10-24_%`. Expect 8, each verified once, with ≤ 18 credits of NBA
    capture spend.
  - Scheduled: 22:03Z (first line, plus premise 1 during live play), 23:08Z
    (halftime reads `'live'`), 02:40Z (all 8, spend).
- **KNOWN MISMATCHES:**
  - WNBA and AFL finals say `'post'`, which the client reads as live
    (`docs/CC-CMD-2026-10-24-v2-final-word.md`, the owner's call).
  - The client's brief route reads a key nothing writes
    (`docs/CC-CMD-2026-10-22-journalism-game-route-prefixed-ids.md`).

## Open, each with a home

- The client box-score path on `/nba/*`, still 403. The NBA CC-CMD names it as
  its own decision.
- **Rule 45:** whether ESPN may serve the NBA board is for human review. The
  journalism cron already reads the same URL.
- Run 2 of the closing-capture done condition: 2026-10-25 11:07Z. Its prompt now
  splits 10-24's NBA groups at the deploy instant.
- The shared join (`docs/CC-CMD-2026-10-21-historical-closing-join-misses-four-sports.md`)
  is held locally until after run 2 and lands through
  trig_011RY5nqXRt4WB71e45va5Rd at 10-25 12:30Z. The patch is
  `outbox/staged-shared-join-2026-10-24.patch`.
