# Session 2026-10-28 — the BSD WebSocket frame shape, recorded from a live match

CC-CMD: `docs/CC-CMD-2026-10-16-bsd-ws-frame-shape.md` (field-laboratory).
HEAD progression: `60599499` at probe time → `c4c63860` (recorder) → `5f13bb2f` (mutations) →
`3f58fb3b` (nested ack, reconnect) → `07e3e783` (livedata as incidents) → `23c704ce` (commit through
`probe-commit-retry.sh`) → `ca75fb47` (league filter) → `f4c4855b` (final artifact).

## Result

Frames were recorded VERBATIM from one live match, event 602466 (Boyacá Chicó v Junior Barranquilla,
Categoría Primera A, `websocket_plus: true`), in three windows of the same match:

| run | window (Z, 2026-10-28) | frames | livedata | ended | landed |
|---|---|---|---|---|---|
| 40619254199 | 02:09:27 to 02:11:16 | 59 | 0 | socket closed 1006 at 109 s | `fed4ef3c` |
| 40619557017 | 02:12:33 to 02:22:34 | 335 | 6 | full duration | `29c76cd6` |
| 40621873322 | 02:36:03 to 02:46:04 | 334 | 8 | full duration | `f4c4855b` |

(Run 40619664790 recorded ten minutes and landed NOTHING; see "Defects".) Artifact of record:
`outbox/bsd-ws-frame-shape-latest.json`, preserved for this match at
`outbox/bsd-ws-frame-shape-602466.json`; raw frames `outbox/bsd-ws-frames-602466-*.jsonl`.
Coverage line, in the artifact: `334 frames over 600.6 s from 1 event (602466, Categoría Primera A); the
verdict describes this match on this tier, not every match`.

### The done condition's five facts (final window, 40621873322; run 40619557017 agrees)

1. **Keys and types.** Frame `type` counts: `ingest_debug` 300, `event` 25, `livedata` 8, `subscribed` 1.
   (Run 40619557017: 299, 26, 6, 1, plus `odds` 3.) Key union includes `event_id`, `uts`, `side`,
   `situation`, `coordinates`, `commentary`, `time`, `score`, `stats`, `websocket_plus`.
2. **`coordinates`.** Present only on `livedata` frames; `Array.isArray` true on 8 of 8, length 0 on 8 of 8
   (14 of 14 across both full windows).
3. **Element keys / identifiers.** None to report: there is no element. No `player_id|pid|id|team|side|home`
   inside a coordinate, because no coordinate exists. (`side` appears on the livedata frame itself, as
   `home` or `away`: it names the team the incident belongs to.)
4. **Distinct identifiers per `uts`.** 0 at all 8 `uts` values.
5. **Restarts and clock.**
   - Typed incidents on `livedata` frames, `situation` values seen: `freekick` 3, `substitution` 3,
     `shotofftarget` 1, `corner` 1 (final window); `freekick` 3, `corner` 2, `shotofftarget` 1 (earlier).
     `periodstart` appears only inside `ingest_debug.type_breakdown`. Throw-ins, goal kicks and fouls are NOT
     typed incidents in what was recorded: they exist as cumulative per-team counters in
     `event.stats.{home,away}` (`throw_ins`, `goal_kicks`, `free_kicks`, `corner_kicks`, `fouls`), which moved
     only on `event` frames (consecutive `event` frames 5 to 71 s apart in run 40619557017, one pair 71 ms apart).
   - `uts` is epoch SECONDS (1793155107 = 2026-10-28T02:38:27Z, inside the 02:36 to 02:46 window it was recorded in); smallest nonzero step between consecutive
     livedata frames, 16 s. The incident match clock `time.second` is `0` on 8 of 8 livedata frames (minute
     grain); `event` frames carry `time.minute` with `second: null`.

**Verdict: `COORDINATES-EMPTY`.** No coordinate element was observed in 14 livedata frames over about 20 minutes
of one match. That neither triggers the NOT MET branch (no identified coordinates at one `uts`) nor supports
"ball trail" (a trail needs elements). The spec's "ball x/y about every 5 s" was NOT seen: livedata cadence here
is incident-driven, 6 to 8 frames in ten minutes.

### What this does and does not establish

- ESTABLISHED, for this match and tier: the socket works with the spec's URL and subscribe message; the ack is
  `{type:'subscribed', event, livedata, odds}`; livedata frames are commentary incidents; `coordinates` is an
  empty array; `ingest_debug` reports what the server ingests (`raw_count` summed over its 300 pulls is 146, a figure that
  counts a still-visible item once per pull; `sent_count` summed is 8, equal to the 8 livedata frames;
  `drop_breakdown` reasons `duplicate` and `out_of_order`).
- NOT ESTABLISHED: any other match. One league (Categoría Primera A, Colombia's top division, outside the relay's tracked V2_LEAGUES), `websocket_plus: true`. A match in a tracked league may
  carry coordinates. That is `docs/CC-CMD-2026-10-28-bsd-ws-top-flight-sample.md`, with an automated wake at
  2026-10-28T11:20Z (trigger `trig_016L8y35g7iFsA2f4A1qUnBC`).
- An abnormal close (1006 after 109 s) happened once in three windows; the recorder now reconnects, bounded
  (0 reconnects were needed in the final window). Cause of the close is unknown.

## Defects found by running it, not by reading

| defect | what showed it | fix |
|---|---|---|
| the spec's frame shape was wrong: livedata rides INSIDE the subscribe ack, restarts are stat counters | run 40619254199's raw file | analyzer unfolds `subscribed.livedata[]`, reports `restartCounters` |
| `IDENTIFIER-LESS` for an empty `coordinates` array | run 40619557017's six frames | `COORDINATES-EMPTY` verdict, own test and mutation |
| state `captured` for a 109 s capture that met neither floor | run 40619254199's artifact | `stateOf`: only a full-duration capture is `captured` |
| a 10-minute run concluded success and committed nothing | `origin/main` had no commit for run 40619664790 | commit step now `scripts/probe-commit-retry.sh` (the repo's helper for exactly this); cause of the lost rebase is unread (log blob Forbidden), the inline loop's is-ancestor guard reading a half-rebased HEAD as landed is the documented mechanism, not a measurement of this run |
| Repo guards red on every push from `c4c63860` to `1fb8004e` (about 40 minutes) | step "No absence-collapse site appears beyond the baseline": `?? []` 22 > baseline 21, site `scripts/bsd-ws-capture.mjs :: lastRows = (await r.json()).events ?? []`. Mine; green was last seen at `60599499`, red began at my first commit. I read the red only after the capture work, not on the first push | a feed with no `events` array is now a thrown, logged failed poll; own test and mutation; green at `ba90529f` (run 40623279354), including the new BSD WS step |
| a second gate red, found by ANOTHER session, not by me: deploy.yml's 'no aggregate launders an unknown into a number' failed on `Number(o.raw_count) || 0` in two reduces (`scripts/bsd-ws-capture.mjs:214-215`). deploy.yml only runs on `src/**` pushes, so my script-only pushes never ran it and the BSD-join session, holding a src push, found it locally and messaged me. The real fault: a frame lacking `raw_count` summed as a confident zero | sums go through `scripts/lib/summary-invariants.mjs` `total()`; frames without a number are reported (`rawCountFramesWithoutNumber`); own test and 2 mutations. Afterwards I ran all 146 `check-*`/`absence-*` commands named in deploy.yml and guards.yml locally: 6 non-zero, 4 need `RELAY_SHARED_SECRET` or the network, 2 failed only under my parallel run and pass alone at HEAD and at `60599499`; none mention this file. Green at `e89004df` (Repo guards, run on that SHA) |
| `node -e` import threw (`process.argv[1]` undefined) | the offline re-analysis | guard on `argv[1]` |

Rule 90: 36 mutations in `scripts/mutate-bsd-ws-capture.mjs`, 36 caught. The first pass had 2 survivors (an
unreachable guard, an unasserted error event); both fixed, not excused. Wired into `guards.yml` ("the BSD WS
recorder fails when it is broken on purpose").

## Found, not fixed (Rule 69), with a CC-CMD (Rule 87.4)

`docs/CC-CMD-2026-10-28-bsd-ws-fanout-field-names.md`. The relay's REAL `_bsdOnFrame`, run over the recorded
frames: `bsd:stats` broadcasts have no `minute` or `period` (the frame holds them at `time.minute`,
`time.period`), `shotmap`/`momentum` are `null` (the frames have neither); `bsd:ball` has `coords: null`; the
`subscribed` ack is dropped. And the client's `_bsdRepaint` reads `_bsdBallPos.x` while the relay sends
`coords: {x,y}`: a ball would not draw even with data.

Also seen in the raw frames, unfixed, in no CC-CMD yet: `event.time.period` alternates between the string
`"2T"` (15 frames) and the number `2` (10 frames) inside one window.

## Integration state (Rule 65)

- Relay contract: none changed. `bsd-ws-capture.yml` is read-only against BSD and writes only `outbox/bsd-ws-*`.
- Client consumer: none. The artifact is read by field-laboratory `docs/CC-CMD-2026-10-15-empowerment-metrics.md`
  Tasks 0.2 and 2 (notes added there).
- Status: VERIFIED for the recorder and for this match's frames; the population note's wider claim is STAGED on
  the top-flight sample (unblocked when a listed-league `websocket_plus` match is live; verify:
  `node -e "const a=require('./outbox/bsd-ws-frame-shape-latest.json');console.assert(a.state==='captured'&&[1,3,4,5,7,8].includes(a.event.league_id))"`).

## Part 2 — the fan-out fix (docs/CC-CMD-2026-10-28-bsd-ws-fanout-field-names.md)

Run in the same session after "next". HEAD progression: `e89004df` → `9f7b61c5` (AmbientDO) → `9cb03d01`
(/bsd/contract examples) → `b63fec56` (check) → `2fd2901a` (CONTRACTS.md) → `069de491` (docs, pushed, deployed) →
`8a95a202` (live verifier). Client repo: `f3bcce2` (CONTRACTS.md only).

- **Done:** `_bsdOnFrame` forwards `time` on `bsd:stats` and `side`, `time`, `commentary` on `bsd:ball`; nothing
  computed. `/bsd/contract` `frameShapes.livedata` and `.stats` replaced with recorded shapes (the old examples were
  invented). `scripts/check-bsd-ws-fanout.mjs` replays 55 event and 14 livedata recorded frames through the real
  function in strict mode, exact key set, plus 17 synthetic cases (populated coordinates, shotmap, missing id,
  non-JSON), coverage derived from the data; RED on 69 frames before the fix, GREEN after; 41 of 41 mutations.
  Deployed (run 40631193919); live `/bsd/contract` 25 of 25 (run 40632008540).
- **Review:** a 4-lens adversarial workflow (35 agents, each finding re-verified by a skeptic) returned 27 confirmed
  and 4 refuted findings; every confirmed one was fixed or recorded: the check could not see a populated
  `coordinates` path, extra keys, shotmap/momentum, or sloppy-vs-strict mode; the served notes quoted one capture's
  counts as all frames; the coverage line was hard-coded; and the client mismatch had no owner (now top-flight CC-CMD
  Task 3, STAGED).
- **A wrong word I wrote and the review caught:** "lower-division" for Categoría Primera A, which is Colombia's top
  division. Corrected in six files; the accurate statement is "a league outside the relay's tracked V2_LEAGUES".
- **Not done, with unblock criteria (Rule 74):** the end-to-end stream proof. Blocked by: no live `websocket_plus`
  match when this was written. Unblocked when one is live. Verify:
  `node -e "const a=require('./outbox/bsd-fanout-live-verify-latest.json');console.assert(a.state==='verified')"`.
  Run dispatched ~04:30Z (345 min wait); the 11:20Z wake re-dispatches until verified or 2026-10-29T00:00Z.
- **Defect found by CI, not by me (twice the same lesson):** Repo guards 'No new bare empty catch' went red on `8a95a202`
  and `196e0004`: `await fetch(...).catch(() => null)` in the new live verifier made the bare count 113 against 112. I had
  seen `check-empty-catches.mjs --control` exit 1 locally and attributed it to the sandbox (it did exit 1 on a clean
  checkout), which is the rationalisation Rule 77 names: the real cause was tree-sitter absent, so the gate could not run
  and could not have told me. `pip install tree-sitter tree-sitter-javascript` made it runnable; it then reproduced the
  failure and the fix (a try/catch that logs) took it to 112. Before gating locally, install the control's dependency.
- **Client:** no code change. `_bsdOnSSEFrame`/`_bsdRepaint` read `_bsdBallPos.x`, the relay sends `coords`; both
  inert while `coords` is null on 14 of 14 frames. Owned by the top-flight CC-CMD Task 3.

## Part 3 — the 11:20Z wake (2026-10-28)

- **Live verifier, first dispatch (run 40632211489, 04:25Z to 10:09Z):** state `no-qualifying-event`, 683 polls over 345
  minutes, committed as `1bb12a6b`. Not a pass and not a finding about the relay: `/bsd/coverage` at 11:22Z shows
  football `live_now: 0` and `last_event_at` 2026-10-28T01:05Z, so BSD listed no football event in play between about
  02:00Z and 11:30Z. The step exits 3 and the workflow concludes `failure` by design; the artifact says why.
- **Re-dispatched 11:24Z, both with a 340-minute wait:** `bsd-ws-capture.yml` (league_ids 1,3,4,5,7,8, 10-minute
  window) and `bsd-fanout-live-verify.yml` (150 s listen). They poll until about 17:05Z.
- **Tool note:** `gh workflow run` fails in this sandbox (it needs GraphQL, which Claude Code sessions are denied); the
  GitHub MCP `actions_run_trigger` does the same dispatch. `gh run list/view` work.
- **Next wake:** 17:10Z, to collect both artifacts and re-dispatch for the evening kickoffs (last dispatch before
  2026-10-29T00:00Z).

### 17:13Z evening collection (collected by the scheduled wake)

- **Live verifier, run 40679565426 (11:23Z to 16:05Z):** `no-frames-through-relay`: it picked event 601989
  (Veikkausliiga, minute 0), subscribed ok, received 0 `bsd:stats` and 0 `bsd:ball` in 150 s. I treated it as a finding
  about the deployed AmbientDO (Rule 77) and read the live feed instead of retrying. `/bsd/events/live` rows carry TWO
  flags: `live_websocket` and `websocket_plus`. 601989 had `live_websocket: false, websocket_plus: true`. My `pickEvent`
  only tested `websocket_plus`, so the tool, not the relay, had picked a match BSD does not stream. Fixed in `846ef015`
  (both flags required; new test and mutation, 37 of 37 caught). The verifier's artifact now records `live_websocket`.
- **Live verifier, run 40734070210 (17:16Z), after the fix:** `verified`. Event 602346 (DFB Pokal, SC Paderborn 07 v VfB
  Stuttgart, both flags true): 7 `bsd:stats`, 29 `bsd:ball`, 8 other SSE events in 150 s through the deployed relay;
  11 of 11 assertions pass. The AmbientDO's outbound socket works in production. Fan-out CC-CMD is DONE.
- **Capture, run 40679561469 (11:23Z to 17:03Z):** `no-qualifying-event`, 673 polls: no match in league ids
  1, 3, 4, 5, 7, 8 was live and streamed in that window.
- **A capture in a different league, run 40734621854 (17:20Z):** event 602352 (DFB Pokal, SG Dynamo Dresden v FC Schalke
  04, both flags true), 409 frames in 600 s: 82 `livedata`, 25 `event`, 300 `ingest_debug`. League 43 is not in the
  tracked list the CC-CMD names; it was taken because the match was live and streamed, and the match is a different
  kind of feed from the Primera A one (next section).

