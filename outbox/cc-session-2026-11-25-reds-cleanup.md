# CC session 2026-11-25 — cleaning up the reds and the ESPN core API mirror failures

**Task:** the owner's "clean up reds and ESPN core API mirror failures" (2026-11-25). No `src/` change, no deploy. The laboratory half (verify's mutate-copy step, the unreachable ledger): field-laboratory `outbox/cc-session-2026-11-25-mutate-copy-protocol.md`.

## The ESPN core API mirror (field-relay-nba)

- **Symptom:** every run from at least 2026-11-25 10:15Z to 17:45Z (runs 611 to 639, 29 of 29) ended red; each printed `site golf leaderboard: event 401850982 lists no competitors` and `site golf leaderboard wanted 1, answered 1, written 0, failed 1`. Soccer was clean in every one (`failed 0`).
- **Cause, measured, not assumed.** ESPN is not reachable from the sandbox, so `scripts/espn-golf-leaderboard-probe.mjs` (dispatch-only workflow, `outbox/espn-golf-leaderboard-shape-2026-11-25T18-05-46-597Z.json`) read the leaderboard from a runner: HTTP 200 on the mirror's read, the relay's event-specific read and the scoreboard. The first event is the Hero World Challenge (401850982), `status.type.state` `pre`, starting 2026-12-03T05:00Z, and its `competitions[0]` has no `competitors` key at all: the field is not published yet. The mirror counted that as a failed read; the relay's own reader (`getGolfLeaderboardFacts`) already treats a missing array as an empty list.
- **Fix** (`d35a69c`): `golfFieldOf(ev)` in `scripts/espn-core-mirror.mjs` names three cases: a field (any array, empty too), "no field yet" (not an array and state `pre`), a failed read (not an array and any other state, or none). Only the last is counted. An event under way or finished with no competitors is still red, and so is one with no status.
- **Checks:** `scripts/check-espn-core-mirror.mjs` 39 of 39 (was 30), its `--self-test` 19 of 19 mutants (eight new: the old rule, an excuse in every state, only under way, an unknown state excused, an empty array refused, a pre event's field turned into a wait, golfPass not asking the function, golfPass counting a wait).
- **Done condition, as an artifact:** ESPN core API mirror run 45672225522 on `d35a69c`: conclusion `success`; its log has `golf: Hero World Challenge (401850982) has not started and lists no field yet` and `site golf leaderboard    wanted 1, answered 1, written 0, failed 0`; every kind `failed 0`; 721 s (seven live-game passes).

## The other reds

- **Repo guards** on `431c0cc` and `9953f89` were red at one step, "HANDOFF close-outs name a session doc that exists" (8 without, budget 6); two close-outs of mine said "session doc <path>" with no colon. Fixed in `0240be6` (6 without). Green on `0240be6` and on `d35a69c`.
- **field-laboratory:** guards red on `b3127b7` and verify red on `49f53f0e` since my ESPN core scripts were not in `docs/unreachable-scripts.txt` (declared, `8be63509`); verify then failed at "The mutate scripts break a copy, never the tracked tree" because two harnesses of mine did not follow the copy protocol (fixed, `bc6059d6`). A red verify skips deploy, so the published build stayed behind and `live-check` failed at "The deploy landed" (45663912109). See the laboratory's session doc.

## Result of the laboratory chain (read from the runs)

verify 45676518707 on `bc6059d6` success; deploy 45678111888 success; live-check on `292c7b9` success; relay Repo guards success on `8fa66ef` (the one red between, on `aa5531b`, was my close-out naming the laboratory's session doc without its repo, fixed in `8fa66ef`). Mirror runs 641 (my dispatch) and 642 (the relay cron's own) both success on `d35a69c`.

## Not verified

- Whether the ESPN leaderboard keeps omitting `competitors` until the Hero World Challenge's field is published: the rule does not depend on it (a published field is a field).
