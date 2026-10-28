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
- NOT ESTABLISHED: any other match. One lower-division league, `websocket_plus: true`. A top-flight match may
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
| `node -e` import threw (`process.argv[1]` undefined) | the offline re-analysis | guard on `argv[1]` |

Rule 90: 33 mutations in `scripts/mutate-bsd-ws-capture.mjs`, 33 caught. The first pass had 2 survivors (an
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
