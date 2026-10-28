# Claude Code Command — AmbientDO's BSD fan-out reads field names the frames do not have

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (relay deploys first); jubilant-bassoon consumes (Rule 70)
**Filed:** 2026-10-28, by CC, from `docs/CC-CMD-2026-10-16-bsd-ws-frame-shape.md` (field-laboratory)
**Confidence gate:** `node scripts/bsd-ws-capture.mjs --self-test` and the Task 2 assertion below
**Status:** DONE 2026-10-28. Built and deployed (relay `069de491`, deploy run 40631193919; client CONTRACTS.md `f3bcce2`), and proven end to end through the deployed relay: `bsd-fanout-live-verify.yml` run 40734070210, state `verified`, 11 of 11 assertions, 7 `bsd:stats` and 29 `bsd:ball` over 150 s from event 602346 (DFB Pokal), `outbox/bsd-fanout-live-verify-latest.json` (artifact commit `105cdd9b`). Task 3 (the client) is owned by `docs/CC-CMD-2026-10-28-bsd-ws-top-flight-sample.md` Task 3.

---

## Related, read before building (BUILD-ON-A)

Searched 2026-10-28 by content (`_bsdOnFrame`, `bsd:stats`, `bsd:ball`, `frame.minute`)
across `docs/CC-CMD-*.md` and `outbox/*.md` in both repos.

- `docs/CC-CMD-2026-06-25-D-bsd-websocket.md`: wrote `_bsdOnFrame` from the spec's
  field names. This CC-CMD changes nothing it ruled on; it corrects names the
  recorded frames show to be wrong.
- `docs/CC-CMD-2026-07-03-gap-sweep-relay.md` (A6): added the "handle both an array
  and an object" `coordinates` code and the `shotmap`/`momentum` forwarding, each
  marked as inferred, "not directly observed on a raw WS frame". The recorded frames
  now answer both (below).
- `docs/CC-CMD-2026-10-16-bsd-ws-frame-shape.md` (field-laboratory): produced the
  frames. Nothing here reopens its verdict or the empowerment lock.

## What was measured (Rule 73: date, method, conditions)

2026-10-28, runs 40619557017 and 40621873322 of `bsd-ws-capture.yml` (the table is run
40619557017's; the second window agrees), one live match (event 602466, Categoría
Primera A, `websocket_plus: true`), raw files `outbox/bsd-ws-frames-602466-*.jsonl`.
The relay's own `_bsdOnFrame`, extracted from `src/ambient-do.js` and run over the
recorded frames of run 40619557017:

| frame `type` | frames | broadcast by `_bsdOnFrame` | what the broadcast carries |
|---|---|---|---|
| `event` | 26 | 26 as `bsd:stats` | `score`, `stats`; **`minute` and `period` absent** (the frame holds them at `time.minute`, `time.period`); `shotmap: null`, `momentum: null` (the frame has neither key) |
| `livedata` | 6 | 6 as `bsd:ball` | `uts`, `situation`, **`coords: null`** (the frame's `coordinates` is `[]`); `side`, `time`, `commentary` dropped |
| `subscribed` | 1 | 0 | nothing: this ack holds the current `event` snapshot, the `livedata` backlog and `odds` |
| `ingest_debug` | 299 | 0 | nothing (a server-side diagnostic; not meant for clients) |
| `odds` | 3 | 0 | nothing (REST serves odds, by design) |

Limits: one match, in Categoría Primera A (Colombia's top division, outside the relay's tracked leagues), two ten-minute windows. Whether a
top-flight match carries non-empty `coordinates` is NOT established
(`docs/CC-CMD-2026-10-28-bsd-ws-top-flight-sample.md`).

## Probe block (run first, against HEAD)

```bash
git log --oneline -5
grep -n "frame.minute\|frame.period\|frame.coordinates\|frame.shotmap\|frame.momentum" src/ambient-do.js
node scripts/bsd-ws-capture.mjs --self-test | tail -2
```

## Task 1 — carry the fields the frames have

In `_bsdOnFrame` (`src/ambient-do.js`), and only there:

1. `bsd:stats`: pass `time` through whole (`minute`, `period`, `status`, and whatever
   else the frame carries) instead of `minute: frame.minute, period: frame.period`.
   Keep `score` and `stats`. Remove the `shotmap`/`momentum` lines or keep them as
   `null` only if jubilant-bassoon's `data.shots || data.shotmap` needs the key;
   the recorded frames carry neither.
2. `bsd:ball`: pass `side`, `time` and `commentary` through with `uts` and
   `situation`. `coords` stays as it is for a populated array.
3. Nothing is computed (Rule 47): every added value is a vendor field forwarded
   unchanged.

## Task 2 — the assertion that proves it

`scripts/check-bsd-ws-fanout.mjs` (with `--self-test` and `scripts/mutate-bsd-ws-fanout.mjs`, Rule 90)
extracts the real `_bsdOnFrame` and replays every recorded frame in
`outbox/bsd-ws-frames-*.jsonl` (55 event and 14 livedata frames of one match, on
2026-10-28) through it, strict mode as in production. It asserts the payload carries the
frame's `time`, `score`, `stats`, `shotmap`, `momentum` (event) and `uts`, `side`,
`situation`, `time`, `commentary`, `coords` (livedata) under the frame's own names, with
an EXACT key set (nothing computed rides along), that other frame types are not
broadcast, and, as a separately counted SYNTHETIC section, the shapes no recording
contains yet: a populated or bare-object `coordinates`, a present `shotmap`/`momentum`,
a missing event id, a non-JSON message. The check went red on HEAD before Task 1
(69 recorded frames misrepresented) and green after.

## Task 3 — the client (Rule 70)

Determined 2026-10-28 by reading `src/legacy/field.js`: `_bsdOnSSEFrame` sets
`_bsdBallPos = data` and `_bsdRepaint` reads `_bsdBallPos.x != null` then `.x` / `.y`,
while the relay sends the position as `data.coords`. It is a Rule 60 mismatch, but both
sides are inert today: `coords` is null on 14 of 14 recorded frames and `_bsdRepaint`
is safe on null (the `!= null` guard skips it; reviewed, not run in a browser). Nothing
reads `bsd:stats.minute` or `.period` (grep, three repos). Inventing a flat `x`/`y` from
a coordinate element no recording contains would be inventing data, so the client is
NOT edited here. The fix needs one recorded element and is owned by
`docs/CC-CMD-2026-10-28-bsd-ws-top-flight-sample.md` Task 3, which runs on a scheduled
wake (2026-10-28T11:20Z). STAGED per Rule 74: blocked by no recorded coordinate element;
unblocked by a capture with `analysis.coordinates.maxElements` above 0.

## Done conditions

1. MET. The Task 2 check was red on the commit before Task 1 (69 recorded frames
   misrepresented: 55 event, 14 livedata) and is green after (`9f7b61c5`); 41 of 41
   mutations caught (`b63fec56`).
2. MET. Deploy run 40631193919 success. The live `/bsd/contract` passes 25 of 25
   assertions including the three new ones (run 40632008540,
   `outbox/bsd-contract-verify-latest.txt`). End to end: run 40734070210 of
   `bsd-fanout-live-verify.yml` subscribed the deployed AmbientDO to event 602346 (DFB
   Pokal, `live_websocket` true, `websocket_plus` true) over the public routes and
   received 7 `bsd:stats` and 29 `bsd:ball` through `/live/ambient` in 150 s; all 11
   assertions pass (exact key sets, a numeric `time.minute`, no top-level minute/period).
   The deployed AmbientDO's outbound BSD socket does work in production.
   The first live attempt (run 40632211489, 04:25Z to 10:09Z) found no football in play;
   the second (run 40679565426) picked event 601989 (Veikkausliiga), received no frame in
   150 s, and the cause was my event selection: that row had `websocket_plus` true and
   `live_websocket` FALSE. Selection now requires both (`846ef015`).
3. MET. `CONTRACTS.md` declares `bsd:stats` and `bsd:ball` in both repos, identical
   (relay `2fd2901a`, client `f3bcce2`; identity check green after one re-run: it had
   run 2 seconds before the client commit landed, relay-first as Rule 70 orders).
