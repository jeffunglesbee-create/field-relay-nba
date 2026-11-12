# CC session 2026-11-08 — NFL player stats move from the Worker to a runner (option B)

**HEAD:** `d6ce98a` → `00c4866` (runner job) → `a5c8da1` (Worker job retired) → this doc · **Branch:** main
**Task:** owner's "B" for `docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md`.

## Built

| commit | what | verified |
|---|---|---|
| `00c4866` | `scripts/build-nfl-player-stats.mjs`, `.github/workflows/nfl-player-stats.yml` (Wed 12:41 UTC + dispatch) | parser equal to Python `csv` on both real files (identical row hashes, 8,500 / 134,470 rows); Python totals agree on 3 QBs (EPA to 0.01, the old per-week rounding kept); self-test 17/17; 13/13 mutations |
| `a5c8da1` | `src/nfl-r2.js` → stub (`retired: true`, writes nothing); repro script loads `git show 00c4866:src/nfl-r2.js` | 229/230 secret-free guard commands identical on HEAD and change (the 1 is a sandbox-blocked fetch, same on HEAD); no VOID-listed file or function touched |

## End to end (Rule 61): VERIFIED for the file and, since 2026-11-12, for the memory

- **VERIFIED 2026-11-08T06:06Z** (`outbox/nfl-player-stats-2026-11-08T0606.log`): nflverse → runner → R2 (read back,
  sha256 `eab567cd49da9ec3`) → `/nflverse/player-stats.json` serving the same bytes, `X-Source: r2`. That URL is
  the one jubilant-bassoon `nflNGSInit` fetches; the shape and the fields it reads (`pos`, `attempts`, `name`, `team`,
  `passingEPA`) are unchanged. Not checked: the page's own render of `NFL_QB_STATS`.
- **VERIFIED 2026-11-12 01:30Z (was STAGED, Rule 74): 0 memory kills.** Read: `outbox/worker-cpu-read-localise-field-relay-nba-exceededMemory-2026-11-12T0130.log`, 14 days ending 2026-11-11, 15 buckets all on 2026-11-04 (the control), none on 2026-11-11; recorded in `docs/CC-CMD-2026-11-03-nfl-r2-player-stats-oom.md` ("Memory part, read 2026-11-12 01:30Z: PASS"). The text below is the staging as written. Blocked by: the next Wednesday window. Unblocked: ~~2026-11-11 after 16:00 UTC~~ 2026-11-12 00:00Z. CORRECTED 2026-11-11: `scripts/worker-cpu-read.mjs` reads UTC days ENDING YESTERDAY (it starts from today's UTC midnight, lines 251-253), so a dispatch on 2026-11-11 cannot see 2026-11-11. Readable from 2026-11-12 00:00Z; `days=14` also shows earlier Wednesdays as a positive control. Read by `trig_01LTk6nPpvHxA1JNxBbjrSVd` (2026-11-12T01:30Z).
  Verify: dispatch `worker-cpu-read.yml` with `mode=localise`, `worker=field-relay-nba`, `status=exceededMemory`;
  no bucket dated 2026-11-11. Also: `outbox/nfl-player-stats-2026-11-11T12*.log` ends `WRITTEN AND SERVED`.

## Corrections made this session

- The job did not fail on every tick: R2 held its 2026-11-04T12:00:23Z write (season 2016, 1,666 players). Corrected in
  both CC-CMDs that said so, and in the repro script's output line.
- A placeholder commit hash was written into `src/nfl-r2.js`'s header before checking; replaced with `00c4866` before commit.
- A drafted follow-up premise would have POSTed to the live write route to test whether it writes; replaced with a
  read-only check before filing.

## Filed

- `docs/CC-CMD-2026-11-08-retire-nfl-r2-callers.md`: remove the Wednesday cron call in `src/index.js` after 2026-11-24
  and after the CFL verdict commit. The admin route stays unless the owner says otherwise.

## Seen, not touched

- `src/mlb-savant-r2.js` uses the same naive CSV split.
- `POST /nfl-r2-update` authorises on a client-sent `X-FIELD-Admin: 1` header (writes nothing now).
