# CC session — 11 pre_game briefs never scored

**Date:** 2026-08-14
**Repo:** field-relay-nba (sole)
**Branch:** main throughout — confirmed `git branch --show-current` = `main`
**CC-CMD:** `docs/CC-CMD-2026-08-14-unscored-pre-game-backlog.md`
**Commits:** `0cf8545` (discriminator), `64e0c91` (backfill script), `60d417f` (timeline),
`d8bd788` (mechanism query), `93ce859` (the fix), + this doc
**Deploy run:** 31804447440 — **success**
**Dispatches:** 5 × `archive-gap-probe.yml` (discriminator, backfill dry, timeline, backfill apply, triage verify)

## Done condition — met

`outbox/jq-unscored-triage-2026-08-14T13-25-32-902Z.log`, run against the live relay
after deploy:

```
unscored rows (repo-wide, not window-scoped): 0
```

All 11 scored, none failed, no row needed a per-row exception.

## What the CC-CMD got wrong, and how the data said so

The spec's leading hypothesis — mine — was that `src/index.js` ~8486 is the bug,
because it is the **only** writer in the file that hardcodes `quality_score` as a
literal `NULL`, and it writes `brief_type='pre_game'`. That reading was clean, and
the CC-CMD required running the discriminator query anyway before acting on it.

The query killed it (`outbox/jq-pre-game-discriminator-*.log`):

```
source                model                      n   unscored
cron                 gemini-3.1-flash-lite     116         11

pre_game + source='cron' rows WITH a score: 105
=> NOT A CLEAN CLUSTER — the reading from code does not fully explain the data.
```

**105 of 116 rows from that same "broken" writer are scored.** The literal NULL is by
design, not the defect. Had I skipped the discriminator and "fixed" the insert, I'd
have changed working code and left the real gap open.

## Two more hypotheses, both falsified before any edit

**"The manual backfill endpoint just hasn't reached them."** `/backfill/brief-scores`
selects `LENGTH(brief_text) > 50 ... ORDER BY created_at DESC LIMIT ?`. That
`LENGTH` clause is a *permanent* exclusion, so I measured it first rather than
running anything: all 11 rows are 168–351 chars, and the endpoint's own dry run
agreed (`found: 11`). Not the cause — but the `DESC` matters later.

**"The write path started scoring at some point; these predate it."** That predicts a
clean time boundary. `outbox/jq-pre-game-timeline-*.log`:

```
days where every pre_game row is unscored : 2026-07-18
days with BOTH (mixed)                    : 4
=> NO CLEAN BOUNDARY — scored and unscored pre_game rows interleave in time
```

Four mixed days — 07-22, 07-25, 07-31, 08-01 — each with scored *and* unscored rows.
Intermittent, not a one-time regression. The script said "do NOT skip TASK 2" and it
was right to.

## The actual mechanism

`context_hash` is the discriminator. The cron writer never sets it; the
`/archive/brief` upsert (~L11639) does, and that path scores server-side then upserts
with `quality_score = COALESCE(excluded.quality_score, briefs.quality_score)`. An
in-place backfill `UPDATE` would leave `context_hash` NULL.

```
scored, has context_hash (archive/brief upsert)  n= 105  2026-07-19 .. 2026-08-14
unscored                                         n=  11  2026-07-18 .. 2026-08-01
```

**105/105.** Every scored pre_game brief was scored by a **client round-trip** — the
client re-posts the brief, the relay scores it, the upsert fills the row. Where that
round-trip never happened, the row stayed NULL forever. That is why it looks
intermittent: it tracks client behavior, not a code path that is broken or working.

## TASK 2 — respec'd, and why

The spec said "fix the write path so future pre_game briefs are scored on write."
The premise was falsified, so I did not do that literally. Scoring inside the ESPN
enqueue loop would add an unbounded number of inference calls to a live cron (Rules
24 and 78), to fix a gap that is ~11 rows a month.

What I fixed instead is the actual defect: **server-side completeness depended on a
client action.** `93ce859` adds a bounded score-fill to the existing dead-hours
block, beside the sibling sweeps that already live there (Rule 62 — the convention
existed; I didn't invent a mechanism):

- max **5 per tick**, dead hours only, never during live generation
- wrapped so failure can never break the cron (Rule 5)
- covers **every** `brief_type`, not just `pre_game`
- **`ORDER BY created_at ASC`, and this is load-bearing.** The existing endpoint
  orders `DESC`, so with any backlog larger than its `LIMIT` the oldest rows can
  never be selected — the tail starves permanently. Oldest-first cannot starve its
  own tail. This is the same bug shape as the backlog itself.
- cost: bounded at 5 scoring calls per dead-hour tick and only when unscored rows
  exist; steady state is one indexed SELECT returning zero rows.

`scoreFillResult` is wired into the cycle's return value and its `ok`/early-return
conditions, so a tick whose only real work was score-fill isn't reported as "backfill
complete" (Rule 63 — no assigned-but-unread variable).

## Disclosed consequence of the backfill

The 11 rows were **scored today, under era-3 code, but carry no `scoring_version`** —
that column is NULL on every recent brief, because stamp-on-write is still unbuilt
(already gated: `docs/CC-CMD-2026-08-13-stamp-scoring-version-on-write.md`). The
calibration read derives era from the brief's **date**, so these 11 July-dated rows
will be attributed to **era 2** despite being scored by era-3 code.

Impact is small (11 rows against 601 in the game_recap window) and none are
`game_recap`, the only era-scoped type today. But it is worth naming precisely
because it is this session's recurring defect — *a stored derived value with no
stored provenance* — reappearing as a side effect of fixing something else. It
strengthens the case for the stamping CC-CMD rather than needing a new one.

## Confidence gate

**Score: 96 / 100.** Above the 95 threshold; committed.

- Three hypotheses were tested and falsified before any code changed; the one that
  survived is supported 105/105 by a discriminator that would have shown otherwise.
- The done condition is a live post-deploy artifact reading `0`, not a claim.
- The fix follows an existing in-repo convention rather than a new mechanism, is
  bounded, guarded, and its result variable is consumed.
- Name-collision check run against the pre-change file for all 8 new identifiers
  (0 collisions) — the check that caught a near-miss duplicate earlier in this session.

The 4 points withheld: the score-fill has not yet been **observed firing** (it runs
dead hours only, UTC 02:00–10:00, and there is currently nothing for it to score, so
its first real exercise needs a future NULL row); and the era-attribution consequence
above is disclosed rather than resolved.

## Rule compliance

- **Rule 48 / 71** — did not modify the insert I believed was the bug; asked the data first.
- **Rule 69** — the write path was left alone once measurement showed it wasn't broken.
- **Rule 62** — used the repo's own `/backfill/brief-scores` for the backfill and the
  existing dead-hours sweep pattern for the fix; no second scorer invented.
- **Rule 5** — score-fill wrapped in try/catch; cannot break the journalism cron.
- **Rule 78** — bounded per tick, dead hours only, zero-cost in steady state.
- **Rule 66** — `node --check src/index.js` clean before commit; deploy verified green.
