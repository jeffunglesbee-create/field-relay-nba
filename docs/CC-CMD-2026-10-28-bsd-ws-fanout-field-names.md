# Claude Code Command — AmbientDO's BSD fan-out reads field names the frames do not have

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba (relay deploys first); jubilant-bassoon consumes (Rule 70)
**Filed:** 2026-10-28, by CC, from `docs/CC-CMD-2026-10-16-bsd-ws-frame-shape.md` (field-laboratory)
**Confidence gate:** `node scripts/bsd-ws-capture.mjs --self-test` and the Task 2 assertion below
**Status:** FILED, not started.

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

Limits: one match, one lower-division league, two ten-minute windows. Whether a
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

Replay the committed raw frames through the extracted function and assert the
broadcast now holds the fields. `scripts/check-bsd-ws-fanout.mjs` (new, with
`--self-test` and a Rule 90 mutation script) reads
`outbox/bsd-ws-frames-602466-2026-10-28T02-12-33-452Z.jsonl` and asserts, over its 26
`event` and 6 `livedata` frames, that every broadcast carries `time.minute` and
`time.period` (event) and `side` and `time.minute` (livedata). The check must go red
against HEAD before Task 1 and green after.

## Task 3 — the client (Rule 70, same session)

`_bsdOnSSEFrame` in jubilant-bassoon `src/legacy/field.js` sets `_bsdBallPos = data`
for a `bsd:ball` frame and `_bsdRepaint` then reads `_bsdBallPos.x` and `.y`, while the
relay sends the position as `data.coords` (`{x, y}`): read 2026-10-28, a ball would not
draw even from a populated frame. That is a Rule 60 mismatch, and the relay owns the
contract: settle which side moves (the relay can add `x`/`y` beside `coords`, or the
client read `data.coords`), and also confirm `_bsdRepaint` is safe when `coords` is null,
which every recorded `bsd:ball` is (it also arrives for `substitution` incidents). Confirm
by grep that nothing reads `bsd:stats.minute` or `.period`. Edit `src/legacy/field.js`
only, never `index.html`'s script block.

## Done conditions

1. The Task 2 check is red on the commit before Task 1 and green after, both outputs
   in the session doc under `outbox/`.
2. The relay is deployed by `deploy.yml` on push; the deploy run id and the check's
   green output are in the session doc.
3. `CONTRACTS.md` updated for `bsd:stats` and `bsd:ball`, with a note that the
   jubilant-bassoon copy must be synced (Rule 86).
