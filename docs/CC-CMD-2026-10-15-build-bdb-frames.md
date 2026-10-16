# Claude Code Command — `build-bdb-frames`

**Branch:** main — commit directly, do not create a feature branch or PR
**Repo:** field-relay-nba
**Confidence gate:** >= 95 before any commit
**Filed:** 2026-10-15 by chat, against HEAD and measured probes
**Status:** NOT STARTED — not dispatched; no `outbox/cc-session-2026-10-15-build-bdb-frames.md` exists.

Unblocks four rejected metrics at once: **The Vault**, **Kinetic Separation**,
**The Root**, and the original NFL **Gravity Well**. All four were rejected for
the same reason and none of them is buildable until this exists.

The F# types are a **separate CC-CMD** in `field-laboratory`
(`CC-CMD-2026-10-15-bdb-frame-types.md`). Do not write F# here.

---

## Why this exists

FIELD's entire NFL tracking surface is six files served from `/nflverse/`:

| file | n | shape |
|---|---|---|
| `bdb_route_entropy` | 354 | `{name, team, pos, routesRun, distinctRoutes, entropyBits}` |
| `bdb_separation` | 250 | `{name, team, pos, targets, avgSepYds}` |
| `bdb_speed` | 1648 | `{name, team, maxSpeedMph, maxSpeedYps}` |
| `bdb_time_to_throw` | 32 | `{team, dropbacks, avgTimeToThrow}` |
| `bdb_xblock_pass_rush` | 321 | `{name, team, pos, rushSnaps, pressureRate, qbHitRate, avgTimeToPressure}` |
| `bdb_tendency_fingerprint` | 32 | `{team, plays, dropbackRate, playActionRate, topFormation}` |

**Zero coordinate keys across all six.** Every row is a per-player or per-team
season mean. The builder consumes tracking upstream and emits aggregates, so the
frames are discarded before anything reaches the relay and no decoder, type or
query can recover them.

Access is already settled by this repo's own probe. `scripts/bdb-access-probe.mjs`,
result in `outbox/bdb-access-probe-20260815T143125Z.log`:

```
kaggle-competition-download: HTTP 401     <- credentialed; creds exist
kaggle-dataset-download:     HTTP 404
nflverse-releases-tracking:  HTTP 404     <- nflverse publishes NO tracking
nflverse-pbp-participation:  HTTP 302
```

**Kaggle is the only route to frames**, and what it delivers is the archived
**2022** season. That is not negotiable and it is not a bug to fix — it is the
constraint the output must carry.

---

## TASK 0 — measure before extracting (blocking)

Do not download the full dataset as a first step.

1. Establish what the Kaggle dataset actually contains: **which weeks**, how many
   games per week, how many plays per game, the tracking sample rate, and the
   **bytes per week** on disk. Report all of it.
2. Confirm the event vocabulary. The metrics need frames named `ball_snap` /
   `snap` and `pass_forward`; `bdb_separation`'s builder uses `pass_arrived`.
   **Verify the exact event strings in the data** rather than assuming these
   names — report the distinct values and their counts.
3. Confirm `nflId` → name/team/position resolution exists in the dataset, and
   whether position is per-player or per-play.

**Stop condition:** if `pass_forward` is not an event string present in the
data, stop and report. Three of the four metrics are pinned to that frame by
design and a near-miss substitute would silently answer a different question —
which is exactly how `bdb_separation` (at `pass_arrived`) came to look like a
fallback for a measurement at release and is not one.

---

## TASK 1 — the size control, which is structural not incidental

**Emit one row per player per NAMED EVENT FRAME. Never per tick.**

Tracking is ~10 Hz over a ~4–6 second play, so a per-tick extraction is roughly
40–60 frames × 22 players per play. Restricting to two or three named events is
about a **20× reduction before any other bound applies**, and it loses nothing —
every one of the four metrics is defined at an instant, not over a series.

Then bound the scope on top of that:

- **One week, all teams.** Preferred over one team's games: the metrics need
  positional baselines across the league, and a single team gives 32× less
  cross-sectional coverage for the same volume.
- Pick the week in Task 0 from the measured sizes; **state which week and why**.

**Hard ceiling: the emitted artifact must be ≤ 2 MB.** If the chosen week
exceeds it, cut scope — fewer games, then fewer event frames — and say so. Do
not ship over the ceiling and do not compress your way under it; a 2 MB JSON
that gzips small is still 2 MB of parse and memory on a phone.

**The ceiling is a build gate, not a guideline.** The builder exits non-zero
when the artifact exceeds it. `index.html` in the client is already 2,695,613
bytes and has hit its own ceiling twice on ordinary feature work; this must not
become the next one.

**The artifact is fetched on demand, never bundled.** It is a `/nflverse/`
route like its six siblings.

## TASK 2 — the wire contract

```json
{
  "updated": "<ISO>",
  "season": 2022,
  "sourceDataset": "kaggle alexandermeau/nfl-big-data-bowl-archived-data-2025",
  "week": <int>,
  "metric": "event_frames",
  "events": ["ball_snap", "pass_forward"],
  "data": [
    { "gameId": 0, "playId": 0, "event": "pass_forward",
      "players": [
        { "nflId": 0, "team": "LA", "pos": "DT", "side": "defense",
          "x": 0.0, "y": 0.0 }
      ]
    }
  ]
}
```

**`season` and `sourceDataset` are mandatory on the envelope and must not be
omittable.** This is the whole point of the pipeline's contract: six BDB files
currently serve 2022 data under `targetYear: 2026` with **nothing in the payload
that says so** (`incident-2026-10-15-bdb-tables-2022-season-served-as-2026`).

Do **not** carry `targetYear` forward into this file. It is the field that made
the existing staleness invisible, and a consumer reading it as the data's season
is the defect, not a misuse.

Coordinate convention must be **stated in the envelope**, not inferred. Record
the origin, axis directions and units as data. The BSD contract declared a frame
it did not have (`field-laboratory docs/BSD-FRAME-DIAGNOSTIC-2026-10-15.md`), and
it did so because its only sample could not discriminate the declaration from
the truth. **Verify the declaration against a play where the two candidate
conventions differ**, and say which play.

## TASK 3 — allow-list and route

Add the artifact to the `/nflverse/` allow-list in `src/index.js` beside the six
BDB entries, with a comment naming its builder.

Note the warning already in that block: five files were removed 2026-08-15
because they *"were allow-listed but had NO builder and NO client consumer —
every request 404'd against a file nothing produced."* **An allow-list entry is
not evidence that data exists.** Add the entry in the same change that lands the
builder, never ahead of it.

## TASK 4 — verification, in this session

1. Fetch the deployed route and assert `season`, `sourceDataset`, `week`,
   `events` and a non-empty `data`.
2. Assert the artifact is under the ceiling, measured on the served response.
3. Pick one play and verify by hand that the 22 players resolve, that offense
   and defense split correctly, and that the coordinate convention matches the
   envelope's declaration.
4. Assert `pass_forward` frames exist for a majority of dropback plays, and
   report the figure rather than asserting coverage is fine.

## Done conditions

- Route live, under ceiling, envelope complete.
- Week, sizes and event vocabulary from Task 0 written down with numbers.
- Any scope cut taken to stay under the ceiling stated explicitly.
- `outbox/cc-session-2026-10-15-build-bdb-frames.md` is the **last** task
  (Rule 87), and names itself in `HANDOFF.md` (Rule 67).

## Constraints

- Rule 80: no credential value in any committed file, log or workflow output.
- Never `set -x` in a workflow touching Kaggle credentials.
- Do not modify the six existing BDB files or their builders in this CC-CMD.
  Their 2022 vintage is a separate open incident with its own consumers.
