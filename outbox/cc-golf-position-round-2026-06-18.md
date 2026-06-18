# Golf position + round fix — 2026-06-18 (US Open R1 emergency)

## Bug

`/v2/golf/enriched?date=20260618` returned `position: null` and `round: null`
for every player during US Open R1. Client leaderboard couldn't render Pos
column or "Round 1" header.

## Root cause

Prior extraction at `src/index.js:1924` (pre-fix):

```js
position:  c.status?.position?.displayName || c.position || null,
round:     c.status?.period || null,
```

ESPN's live competitor objects during active rounds carry only these keys:
`athlete, id, linescores, order, score, statistics, type, uid`. Neither
`c.status` nor `c.position` exist while play is in progress, so both fields
resolved to `null` for all 156 players. `ev.status.period` is also unset
during live rounds — the top-level `round` was likewise null.

## Fix (commit `af23280`)

### Position — tied groups from `c.order` + `c.score`

```js
const scoreGroups = new Map();
for (const c of entries) {
    const score = c.score ?? null;
    const order = Number(c.order) || null;
    if (score === null || order === null) continue;
    const g = scoreGroups.get(score);
    if (g) { g.count++; if (order < g.firstOrder) g.firstOrder = order; }
    else   scoreGroups.set(score, { firstOrder: order, count: 1 });
}
const positionForScore = (score) => {
    if (score === null || score === undefined) return null;
    const g = scoreGroups.get(score);
    if (!g) return null;
    return g.count > 1 ? `T${g.firstOrder}` : String(g.firstOrder);
};
```

Verified against the spec's worked example:

| order | score | name    | output |
|-------|-------|---------|--------|
| 1     | -3    | Clark   | `"1"`  |
| 2     | -2    | Stevens | `"T2"` |
| 3     | -2    | Stout   | `"T2"` |
| 4     | -2    | Rahm    | `"T2"` |
| 5     | -1    | McIlroy | `"5"` (if alone) / `"T5"` (with peers) |

Note: McIlroy's position is "T5" only when other players tie at -1; alone
it's "5". The algorithm follows the spec's explicit "group.length > 1 → T"
rule. The spec's "T5" expected output presumes additional unshown -1
players, which is standard for golf leaderboards.

### Round — derived from `linescores`

```js
const currentRoundFromLinescores = (lsArr) => {
    if (!Array.isArray(lsArr)) return null;
    const n = lsArr.filter(x =>
        (x?.displayValue !== null && x?.displayValue !== undefined) ||
        (Array.isArray(x?.linescores) && x.linescores.length > 0)
    ).length;
    return n > 0 ? n : null;
};
```

- Future rounds carry `displayValue: null` AND `linescores: []` → don't count.
- Active rounds carry `displayValue` set OR a non-empty per-hole `linescores`
  array → count.

Per-player `round` uses each competitor's own linescores. Top-level `round`
uses the first competitor's linescores (the leader's round is the
tournament round).

Both fall back to `c.status.period` / `ev.status.period` when ESPN provides
it (off-play windows pre-/post-round).

### Test outputs from node verification

```
R1 in progress  → 1
R2 in progress  → 2
pre-tournament  → null
```

## Cache keys bumped (defense)

KV cache TTLs are 300s (scoreboard) and 180s (enriched). To prevent stale
null-position payloads from leaking through the rollout window, bumped:

| Path | Old | New |
|------|-----|-----|
| `handleESPNGolfScoreboard` | `v2:golf:scoreboard:{date}` | `v2:golf:scoreboard:r2:{date}` |
| `handleGolfEnriched`       | `golf:enriched:v2:{date_clean}` | `golf:enriched:v3:{date_clean}` |

Old keys age out naturally (TTL); new keys serve correct data immediately.

## What was NOT changed

- `handleGolfEnriched`'s canonical mapper (already reads `entry.position`
  and `entry.round` verbatim — new values flow through unchanged).
- `handleGolfPlayerStats`, `handleGolfCompetitorStats`, `handleGolfEventlog`.
- jubilant-bassoon or any stat repo (Rule: FIELD relay only).
- ADR-002 boundary (no drama scoring, no interest computation).

## Deploy + verification

- **Commit**: `af23280`
- **Workflow run**: `27795773997` (in progress at write time;
  verification probe to follow once deploy completes)
- **Probe plan** (Rule 61):

```bash
curl -s 'https://field-relay-nba.jeffunglesbee.workers.dev/v2/golf/enriched?date=20260618' \
  | python3 -c "
import sys,json
d = json.load(sys.stdin)
lb = d.get('leaderboard') or []
# top-level round populated
assert d.get('round') is not None, 'top-level round is null'
# top 5 positions populated
for p in lb[:5]:
    assert p.get('position') is not None, f\"{p.get('name')}: position is null\"
print(f\"top round={d.get('round')}, top-5 positions:\", [p.get('position') for p in lb[:5]])
print('OK')
"
```

Expected: top-level `round: 1` (US Open R1), top-5 positions populated
(e.g. `"1", "T2", "T2", "T2", "T5"` or similar tied pattern).
