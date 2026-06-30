# CC-CMD — Round Label + Two-Legged Aggregate (RELAY)

**Repo:** field-relay-nba ONLY
**Date:** 2026-06-30 (split from CC-CMD-2026-06-30-round-label-aggregate.md)
**Baseline:** field-relay-nba HEAD e4e9aeac
**Companion doc:** docs/CC-CMD-2026-06-30-round-label-client.md (jubilant-bassoon
— separate CC-CMD, separate session, run after this one ships and deploys)
**Builds on:** CC-CMD-2026-06-30-soccer-stats-dual-source.md (shipped —
relay HEAD 4daaf058 — widened /soccer/xg to extractStats(), added
_hasMatchStats and the /soccer/season-form route)

git pull. Read CLAUDE.md. Run `git log --oneline -5` first.

Write findings to outbox/cc-round-label-relay-2026-06-30.md.

---

## NETWORK CONSTRAINT — READ FIRST, DO NOT TRY TO ROUTE AROUND

This sandbox cannot reach `*.workers.dev` from bash, and Chromium in this
sandbox has hit the same block on prior sessions. This means: you can write
and commit code here, but you CANNOT verify it against the live relay/app
from inside this session. This has been true on every CC-CMD this session
(tournament-multiplexer, dual-source, AVV-MLS) — it is not a one-off, do
not spend time trying workarounds (no proxy tricks, no alternate fetch
methods, no retry loops hoping it resolves).

**What this means practically:** once your code is committed and pushed,
and the deploy/CI gate for this repo passes (that part runs on GitHub's
infrastructure, not your sandbox, so it works normally), STOP. Write
STAGED in the outbox with exactly what couldn't be checked from here and
why. Chat will independently verify against the live system and trigger
any dedicated CI workflow (e.g. adapter-visible-value.yml) after this
session ends — that is expected, not a gap in your work.

Do not mark something as definitively verified if the only check available
was from inside this sandbox's network-restricted bash or browser.

## WHY THIS IS SPLIT FROM THE CLIENT WORK

The original combined doc required one CC session to operate across both
repos in sequence. A real session hit exactly the failure mode that risks:
CC was opened against field-relay-nba, the spec doc lived in jubilant-bassoon
(per the two-repo separation rule — spec files always live in jubilant-bassoon
regardless of target repo), and CC correctly couldn't find it. Splitting into
two single-repo, self-contained CC-CMDs removes the cross-repo juggling
entirely — this doc only ever touches field-relay-nba, start to finish.

**This doc does NOT depend on the client doc.** The client doc DOES depend on
this one shipping and deploying first for the soccer-specific badge (round
label + aggregate). The client doc's NBA/NHL/UFL/MLS-tournament round badge
has no dependency on this doc at all — that data already exists in
postseason_games today.

---

## BACKGROUND

Confirmed live 2026-06-30: `adaptESPNWCSoccer` (the generic ESPN-soccer
adapter used for every espnLeague-configured competition — not just WC26;
also EPL, La Liga, Serie A, Bundesliga, Ligue 1, MLS-via-ESPN, UCL, Europa
League) hardcodes `round: ''` and never reads `comp.notes`, even though
ESPN's bare scoreboard response already carries it for free. Live-verified:
a UCL Round-of-16 fixture (Arsenal at Bayer Leverkusen, event 401862578)
returned `notes: [{"headline": "1st Leg"}]` directly on `competitions[0]`
in the `/scoreboard` response. The tennis adapter elsewhere in this file
already does exactly this pattern (`match.notes?.[0]?.headline`) — just
never ported to the soccer adapter.

For two-legged ties, ESPN's `/summary` endpoint (already fetched by
`/soccer/xg` solely to resolve competitor names) carries a `series` object
on `header.competitions[0]` that's currently discarded entirely:

```json
"series": {
  "title": "Round of 16", "completed": false, "leg": 1, "totalCompetitions": 2,
  "competitors": [
    {"id": "131", "aggregateScore": 1, "team": {"$ref": "..."}},
    {"id": "359", "aggregateScore": 1, "team": {"$ref": "..."}}
  ],
  "events": [{"id": "401862578"}, {"id": "401862581"}]
}
```

`aggregateScore` is pre-computed by ESPN across both legs (handles the
home/away flip between legs correctly) — no goal-summing needed FIELD-side.

**IMPORTANT — scope boundary confirmed 2026-06-30 (HANDOFF b5ab3142):** this
`series`/`aggregateScore` mechanism is ESPN-native and ONLY applies to
ESPN-sourced soccer (the leagues in `handleJournalismCycle`'s LEAGUES array
and `adaptESPNWCSoccer`'s callers). A real two-legged tie was found in the
TELUS Canadian Championship (stats-api-sourced, via the tournament
multiplexer, landed in `postseason_games`) — that source has NO aggregate
field; its two legs are just two independent rows linked only by team-pair
and date proximity. This doc does NOT solve that case. Document it as an
explicit known gap (see KNOWN GAPS below) — do not attempt to handle
stats-api-sourced two-legged ties here.

WC26 soccer already gets a `round` value via a separate mechanism (BSD
group_name lookup, gated to `sport === 'wc26'` only) that overwrites the
adapter's round value after `adaptESPNWCSoccer` runs. That block is correct,
runs after, and is more specific (actual group letter) — it must not be
touched.

---

## PRE-BUILD PROBES (Rule 68)

```bash
# 1. Re-confirm adaptESPNWCSoccer still hardcodes round: '' (may have changed)
grep -n "function adaptESPNWCSoccer" -A 65 src/index.js | grep -n "round:"

# 2. Re-confirm tennis's notes-reading pattern (copy this exact pattern)
grep -n "match.notes" src/index.js

# 3. Re-confirm /soccer/xg's summary fetch + current payload shape — this route
#    was modified 2026-06-30 by the soccer-stats-dual-source CC-CMD (added
#    _hasMatchStats). Confirm the payload object you're adding _series to
#    still has the shape this doc expects (_hasXG, _hasMatchStats, _source,
#    home, away) before editing — if it's drifted further, re-read and adjust.
grep -n "header?.competitions?.\[0\]\|_hasMatchStats" src/index.js

# 4. Confirm the WC26 BSD round-overwrite block is unchanged (must not touch it)
grep -n "group_name) _g.round" -B 3 src/index.js

# 5. Confirm handleV2Games' cfg.espnLeague branch start (Task 2 insertion point)
grep -n "if (cfg.espnLeague)" src/index.js
```

---

## TASK 1 — Round label on every ESPN-sourced soccer game

File: `src/index.js`, `adaptESPNWCSoccer`.

Replace:
```javascript
round:       '',
```
With:
```javascript
round:       comp.notes?.[0]?.headline || comp.notes?.[0]?.text || '',
```

Additive only — the WC26 BSD block runs afterward and still overwrites this
with the more specific group_name when found. Do not modify that block.

---

## TASK 2 — Two-legged aggregate, conditionally fetched

### 2a. Widen `/soccer/xg`'s existing summary fetch

File: `src/index.js`, `/soccer/xg` route. The summary fetch already happens;
extract `series` from the same response instead of discarding it.

After the existing competitor-extraction loop, add:

```javascript
const seriesData = summaryData?.header?.competitions?.[0]?.series?.[0] || null;
let seriesPayload = null;
if (seriesData) {
    const homeAgg = seriesData.competitors?.find(c => c.id === homeId)?.aggregateScore;
    const awayAgg = seriesData.competitors?.find(c => c.id === awayId)?.aggregateScore;
    seriesPayload = {
        title: seriesData.title || null,
        leg: seriesData.leg ?? null,
        totalLegs: seriesData.totalCompetitions ?? null,
        completed: seriesData.completed ?? null,
        homeAggregate: homeAgg ?? null,
        awayAggregate: awayAgg ?? null,
        otherLegEventId: (seriesData.events || []).find(e => e.id !== eventId)?.id || null,
    };
}
```

Add `_series: seriesPayload` to the existing response `payload` object,
alongside `_hasXG`/`_hasMatchStats`.

### 2b. Conditional fetch in `/v2/games` — only call `/soccer/xg` for likely second legs

File: `src/index.js`, inside the `cfg.espnLeague` branch of `handleV2Games`,
after `espnGames` is built.

Do NOT call `/soccer/xg` for every game in the slate — only for games whose
cheap `round` value (from Task 1) indicates a second leg, to avoid an N+1
`/summary` fetch across the full day's schedule:

```javascript
// ── Two-legged aggregate enrichment — only for likely second legs ─────────
// Cheap pre-filter on the free `round` string avoids fetching /summary
// (one extra request per game) for the ~95% of soccer games that aren't
// part of a multi-leg tie. False negatives just mean no aggregate badge —
// degrades silently, never blocks the card.
if (cfg.espnSport !== 'baseball' && !['basketball','australian-football'].includes(cfg.espnSport)) {
    const secondLegGames = games.filter(g =>
        /2nd leg|second leg/i.test(g.round || '')
    );
    if (secondLegGames.length) {
        const relayBase = env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
        await Promise.all(secondLegGames.map(async g => {
            try {
                const eid = (g.espnEventId || '').toString();
                const resp = await fetch(
                    `${relayBase}/soccer/xg?league=${encodeURIComponent(cfg.espnLeague)}&event=${encodeURIComponent(eid)}`
                );
                if (!resp.ok) return;
                const d = await resp.json();
                if (d?._series) g.series = d._series;
            } catch (_) { /* non-blocking */ }
        }));
    }
}
```

Place after the existing AFL/BSD enrichment blocks, same pattern
(non-blocking, try/catch per game, never aborts the response).

---

## TASK 3 — Smoke assertions

field-relay-nba has no smoke.js (confirmed absent 2026-06-30). Verify these
conditions directly instead, per Task 4 below — do not create a new smoke
framework for this.

- `/soccer/xg` response includes a `_series` key (null when not applicable)
- `/v2/games` does NOT call `/soccer/xg` for games where `round` doesn't
  match `/2nd leg|second leg/i`

---

## TASK 4 — Verify end-to-end (live, post-deploy)

```bash
# 1. Round label now populated for a live club-league game (not just WC26)
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/v2/games?sport=epl&date=$(date -u +%Y-%m-%d)" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); [print(g.get('round'), g['home']['name'], 'v', g['away']['name']) for g in d.get('games',[])]"

# 2. Series/aggregate populated for a confirmed second-leg fixture — find one
#    via live ESPN scoreboard search first (the June 2026 UCL example used
#    during doc-writing has long since resolved):
curl -s "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard?dates=$(date -u +%Y%m%d)" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); [print(e['id'], e['competitions'][0].get('notes')) for e in d.get('events',[])]"
# Then test that event id:
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/soccer/xg?league=uefa.champions&event={EVENT_ID}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('_series'))"
# If no live second-leg fixture exists today, this step may need to wait for
# one — note this in the outbox rather than fabricating a pass.

# 3. Confirm N+1 avoidance — a full day's EPL/La Liga slate triggers zero
#    /soccer/xg calls unless a real second-leg fixture exists (rare in normal
#    league play; confirms the pre-filter, not a false "always fetches" path)
```

---

## DEPLOY — CRITICAL, do not skip

**This changes runtime code.** Do NOT include `[skip ci]` in the commit
message — a prior session in this repo did exactly that by reflex (copying
the pattern from doc-only commits) and silently suppressed the deploy for a
real code change, caught only by a post-commit live probe. After pushing:

```bash
# Confirm the push triggered deploy.yml automatically (it watches src/**)
curl -s -H "Authorization: token $FIELD_PAT" \
  "https://api.github.com/repos/jeffunglesbee-create/field-relay-nba/actions/runs?per_page=1" \
  | python3 -c "import json,sys; r=json.load(sys.stdin)['workflow_runs'][0]; print(r['status'], r.get('conclusion'), r['head_sha'][:10])"
# If it didn't trigger (e.g. you also touched [skip ci] somewhere), manually
# dispatch: POST .../actions/workflows/deploy.yml/dispatches {"ref":"main"}
# Wait for completion (poll every 30s) before running Task 4 verification —
# testing against an undeployed bundle will produce false negatives.
```

---

## SCOPE (Rule 69 — TOUCH-ONLY-A)

Repo: field-relay-nba only.

DO:
- `adaptESPNWCSoccer` round fix (Task 1)
- `/soccer/xg` series extraction (Task 2a)
- Conditional second-leg enrichment in `handleV2Games` (Task 2b)
- Confirm deploy actually ran (not just pushed)
- Single commit (or tightly sequenced commits with no gap — GitHub Contents
  API is one-file-per-call; if editing index.js only, this is naturally one
  commit)

DO NOT:
- Touch the WC26 BSD round-overwrite block
- Fetch `/soccer/xg` unconditionally for every soccer game
- Build FIELD-side aggregate-score computation — ESPN's `aggregateScore`
  already does this correctly
- Attempt to solve stats-api-sourced two-legged ties (TELUS Canadian
  Championship and similar) — different data model, no aggregate field,
  needs its own spec
- Touch jubilant-bassoon — that's the companion doc, separate session
- Include `[skip ci]` in any commit message for this work

---

## KNOWN GAPS TO DOCUMENT (not solve here)

1. Domestic cups with occasional two-legged early rounds may phrase ESPN's
   `notes` differently than "1st/2nd Leg" — the regex pre-filter may miss
   some. Note any misses found during Task 4 verification.
2. **Stats-api-sourced two-legged ties have no aggregate-score data model.**
   Confirmed present in production data (TELUS Canadian Championship
   Quarterfinals, Jul 9–14 2026, two legs as independent `postseason_games`
   rows with no linking field). This doc's `series`/`aggregateScore`
   mechanism is ESPN-specific and does not — cannot — cover this. A future
   CC-CMD would need to either (a) compute aggregate scores FIELD-side from
   the two linked rows once a leg-pairing scheme exists, or (b) accept that
   stats-api tournaments show round label only, no aggregate, until that's
   built. Out of scope here.

---

## OUTBOX MANIFEST (last task)

Write `outbox/cc-round-label-relay-2026-06-30.md` with: probe results
(especially probe 3 — confirm the dual-source-modified payload shape),
Task 4 verification output, any "1st/2nd Leg" phrasing variants found,
final relay HEAD sha, and explicit confirmation the deploy actually ran
(workflow run id + conclusion).
