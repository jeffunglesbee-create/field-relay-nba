# CC-CMD — Retroactive scoring of NULL-scored briefs

**Repo:** field-relay-nba
**Date:** 2026-06-23
**Scope:** New GET /backfill/brief-scores endpoint + execute it

---

## CONTEXT (verified from source, no assumptions)

- `JOURNALISM_CLAUDE_PROXY` = `'https://field-claude-proxy.jeffunglesbee.workers.dev'` (L3415)
- `runQualityChain` already imported (L52)
- `/backfill/game-briefs` at L7458 is the established batch pattern — follow it exactly
- `/archive/brief` POST at L7076 now scores new arrivals — this CC-CMD handles the ~325
  pre-existing NULL rows for brief_types: `mlb_game`, `night_owl`, `wc_matchup`,
  `game_recap` (lowercase sport), `wnba_game`, `standings_snapshot`
- `quality_score = COALESCE(excluded.quality_score, briefs.quality_score)` is already
  the ON CONFLICT pattern at L7131 — reuse it

---

## PRE-BUILD PROBES (run before writing any code)

```bash
# 1. Confirm JOURNALISM_CLAUDE_PROXY constant name and value
grep -n "JOURNALISM_CLAUDE_PROXY" src/index.js | head -3

# 2. Confirm runQualityChain import
grep -n "runQualityChain" src/index.js | head -3

# 3. Count NULL-scored rows by brief_type (exact numbers)
# Use /archive/query endpoint — it accepts brief_type param
# Or read via D1 MCP if available. Either way, report counts before coding.

# 4. Confirm /backfill/ route block location for insertion point
grep -n "pathname.*backfill" src/index.js

# 5. Confirm MCP allow-list includes /backfill/brief-scores
grep -n "backfill" src/index.js | grep -i "allow\|ALLOW\|prefix\|MCP" | head -5
# If not present, add '/backfill/brief-scores' to the MCP allow-list alongside
# '/backfill/game-briefs'
```

Write probe output to `outbox/cc-backfill-brief-scores-2026-06-23.md`.

---

## TASK 1 — Add GET /backfill/brief-scores endpoint

Insert immediately after the closing `}` of `/backfill/game-briefs` handler.
Find the exact insertion line from probe #4.

```javascript
// ── GET /backfill/brief-scores ─────────────────────────────────────────────
// Retroactively scores briefs where quality_score IS NULL.
// Targets client-archived types: mlb_game, night_owl, wc_matchup,
// game_recap (cased variants), wnba_game, standings_snapshot.
// Runs runQualityChain (maxRetries:1, score-only — never regenerates prose).
// Scoring failure per-row is swallowed (Rule 5); archival always succeeds.
// Query params:
//   limit  — rows per call, default 20, max 50
//   dry    — true → return count only, no scoring
//   type   — filter to one brief_type (optional)
if (pathname === '/backfill/brief-scores' && request.method === 'GET') {
  if (!env.ARCHIVE_DB) {
    return new Response(JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
      { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);
  const dryRun = url.searchParams.get('dry') === 'true';
  const typeFilter = url.searchParams.get('type') || null;

  const typeClause = typeFilter ? `AND brief_type = ?` : '';
  const binds = typeFilter ? [typeFilter, limit] : [limit];

  const nullRows = await env.ARCHIVE_DB.prepare(`
    SELECT id, brief_type, sport, brief_text
    FROM briefs
    WHERE quality_score IS NULL
      AND brief_text IS NOT NULL
      AND LENGTH(brief_text) > 50
      ${typeClause}
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(...binds).all().catch(() => ({ results: [] }));

  const rows = nullRows.results || [];

  if (dryRun) {
    return new Response(JSON.stringify({
      ok: true, dry_run: true, found: rows.length,
      by_type: rows.reduce((acc, r) => {
        acc[r.brief_type] = (acc[r.brief_type] || 0) + 1; return acc;
      }, {}),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const callProxy = async (promptText) => {
    const resp = await fetch(JOURNALISM_CLAUDE_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FIELD-Relay': 'field-relay-cron-2026' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: promptText }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    return data ? (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim() || null : null;
  };

  const scored = [], failed = [];
  for (const row of rows) {
    try {
      const scoringPrompt = `Score this sports brief for journalism quality:\n\n${row.brief_text}`;
      const qResult = await runQualityChain(scoringPrompt, row.brief_text, callProxy, {
        sport: row.sport || null,
        scoreThreshold: 90,
        maxRetries: 1,
      });
      const score = qResult?.score ?? null;
      if (score !== null) {
        await env.ARCHIVE_DB.prepare(
          `UPDATE briefs SET quality_score = ? WHERE id = ? AND quality_score IS NULL`
        ).bind(score, row.id).run();
        scored.push({ id: row.id, brief_type: row.brief_type, score });
      } else {
        failed.push({ id: row.id, reason: 'null score' });
      }
    } catch (e) {
      failed.push({ id: row.id, reason: e.message?.slice(0, 80) || 'error' });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    processed: rows.length,
    scored: scored.length,
    failed: failed.length,
    results: scored,
    errors: failed,
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
```

---

## TASK 2 — Add to MCP allow-list

From probe #5: if `/backfill/brief-scores` is not already in the MCP
allow-list, add it alongside `/backfill/game-briefs`. Find the allow-list
array and insert the string `'/backfill/brief-scores'`.

---

## TASK 3 — Execute the backfill

After deploy, run the endpoint in batches until all NULL rows are scored.
Do this inside the CC session — do not leave it as a carry-forward.

```bash
# Dry run first — confirm row count
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/backfill/brief-scores?dry=true" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.log(JSON.stringify(d, null, 2))'

# Score in batches of 20 until processed = 0
# Run this loop (adjust N passes based on dry-run count / 20):
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17; do
  echo "=== Pass $i ==="
  curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/backfill/brief-scores?limit=20" \
    | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.log(`scored:${d.scored} failed:${d.failed} processed:${d.processed}`)'
  sleep 2
done

# Final dry run — confirm 0 NULL rows remain for target types
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/backfill/brief-scores?dry=true" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.log("remaining:", d.found)'
```

---

## TASK 4 — Verify via /quality/report

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/quality/report" \
  | node -e '
    const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8"));
    const targets=["mlb_game","night_owl","wc_matchup","wnba_game","standings_snapshot"];
    d.summary.filter(r => targets.includes(r.brief_type)).forEach(r =>
      console.log(r.brief_type, "scored:", r.scored, "/", r.total, "avg:", r.avg_score)
    );
  '
```

All target types should show `scored > 0`. Any remaining NULLs are briefs
where scoring genuinely failed (proxy error) — acceptable. Report final
counts in the outbox manifest.

---

## TASK 5 — Write outbox manifest

Write `outbox/cc-backfill-brief-scores-2026-06-23.md` with:
- Commit hash
- Dry-run count before
- Scored / failed counts after all passes
- /quality/report output for target types
- Any remaining NULL count

---

## SCOPE (Rule 69 — TOUCH-ONLY-A)

DO:
- Add `/backfill/brief-scores` route block in `src/index.js`
- Add to MCP allow-list if missing
- Execute the backfill loop inside this session
- Write outbox manifest

DO NOT:
- Modify `/archive/brief` handler (already fixed, commit 5c0b63e)
- Modify `/backfill/game-briefs`
- Touch journalism-quality.js or context-assembler.js
- Regenerate any brief text — score-only (maxRetries:1)
- Touch jubilant-bassoon

---

## DONE CONDITION

Session is complete when:
1. `/backfill/brief-scores?dry=true` returns `found: 0` (or close to 0 —
   remaining failures are proxy errors, not logic gaps)
2. `/quality/report` shows `scored > 0` for `mlb_game`, `night_owl`,
   `wc_matchup`
3. Outbox manifest committed
