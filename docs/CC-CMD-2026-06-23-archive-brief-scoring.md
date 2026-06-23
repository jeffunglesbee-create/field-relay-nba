# CC-CMD — Wire runQualityChain into /archive/brief POST

**Repo:** field-relay-nba
**Date:** 2026-06-23
**Scope:** Single surgical edit to /archive/brief POST handler (src/index.js)

---

## BACKGROUND

`mlb_game`, `night_owl`, and `wc_matchup` brief types exist in D1 with
`quality_score = NULL` across 100+ rows. Root cause: these briefs are
generated client-side (jubilant-bassoon `archiveBrief()`) and POSTed to
`/archive/brief` with no quality_score. The relay currently persists
whatever the client sends without scoring.

Fix: when `/archive/brief` receives a POST with `quality_score` null/absent
AND `brief_text` is present, run `runQualityChain` on the text before
writing to D1. This retroactively scores all future client-archived briefs
without touching client code.

---

## PRE-BUILD PROBES (Rule 68 — run before writing any code)

```bash
# 1. Confirm /archive/brief handler location
grep -n "pathname === '/archive/brief'" src/index.js

# 2. Confirm runQualityChain is already imported
grep -n "runQualityChain" src/index.js | head -5

# 3. Confirm callProxy pattern — use the queue consumer version (L10840 area)
sed -n '10828,10870p' src/index.js

# 4. Confirm PROXY_URL constant exists
grep -n "PROXY_URL\|const PROXY" src/index.js | head -5

# 5. Confirm current /archive/brief body shape
sed -n '7076,7112p' src/index.js

# 6. Check brief_type → sport mapping needed for scoreThreshold
# mlb_game → 'MLB', night_owl → null (multi-sport), wc_matchup → 'FIFA World Cup 2026'
grep -n "scoreThreshold\|sport.*threshold" src/index.js | head -10
```

Write probe output to `outbox/cc-archive-brief-scoring-2026-06-23.md`.

---

## TASK 1 — Add quality scoring to /archive/brief POST

In `src/index.js`, find the `/archive/brief` POST handler. Currently ends at
the `await env.ARCHIVE_DB.prepare(...).bind(...).run()` call followed by
`return new Response('ok', ...)`.

**Replace the existing handler body** (from `let body;` to the final
`return new Response('ok', ...)`) with the version below. Read the current
source first — adjust line references to match actual HEAD.

### Pattern

```javascript
if (pathname === '/archive/brief' && request.method === 'POST') {
  await ensureBriefsTable(env);
  let body;
  try { body = await request.json(); }
  catch (_) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid JSON' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  const { id, brief_type, date, sport, game_id, brief_text,
          model, quality_score, context_hash, word_count, source } = body || {};
  if (!id || !brief_type || !date || !brief_text) {
    return new Response(JSON.stringify({ ok: false, error: 'missing required fields (id, brief_type, date, brief_text)' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // ── Quality scoring for client-archived briefs ────────────────────────────
  // mlb_game, night_owl, wc_matchup arrive with quality_score=null because
  // the client has no quality chain. Score them here if absent.
  let finalScore = typeof quality_score === 'number' ? quality_score : null;
  if (finalScore === null && brief_text && brief_text.length > 50 && env.FIELD_JOURNALISM) {
    try {
      const PROXY_URL = `https://field-relay-nba.jeffunglesbee.workers.dev/proxy/claude`;
      const callProxy = async (promptText) => {
        const resp = await fetch(PROXY_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-FIELD-Relay': 'field-relay-cron-2026',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1000,
            messages: [{ role: 'user', content: promptText }],
          }),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim() || null;
      };
      // Use a minimal re-scoring prompt — the original prompt is unavailable,
      // so we score the prose directly with a brief system framing.
      const scoringPrompt = `Score this sports brief for journalism quality:\n\n${brief_text}`;
      const qResult = await runQualityChain(scoringPrompt, brief_text, callProxy, {
        sport: sport || null,
        scoreThreshold: 90,
        maxRetries: 1,   // single pass — don't regenerate, just score
      });
      finalScore = qResult.score ?? null;
    } catch (_) { /* scoring failure must not break archival */ }
  }

  await env.ARCHIVE_DB.prepare(
    `INSERT INTO briefs
     (id, date, brief_type, sport, game_id, brief_text, model, quality_score, context_hash, word_count, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       brief_text = excluded.brief_text,
       word_count = excluded.word_count,
       quality_score = COALESCE(excluded.quality_score, briefs.quality_score),
       source = excluded.source`
  ).bind(
    id, date, brief_type,
    sport || null,
    game_id || null,
    brief_text,
    model || null,
    finalScore,
    context_hash || null,
    typeof word_count === 'number' ? word_count : brief_text.split(/\s+/).length,
    source || 'client'
  ).run();

  return new Response(JSON.stringify({ ok: true, scored: finalScore !== null }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
```

**Key changes from current:**
- Scoring block runs when `quality_score` is absent/null
- `maxRetries: 1` — score only, no regeneration (original prompt unavailable)
- `ON CONFLICT` now uses `COALESCE` so a previously-scored brief never gets
  overwritten with NULL
- Response is JSON `{ok:true, scored:bool}` instead of plain `'ok'` string
  (backward-compatible — client checks `ok` status, not body shape)

**PROXY_URL:** Verify the actual proxy URL from probe #4. If `PROXY_URL` is
a module-level constant already defined, use it directly. Do not define a
second copy.

---

## TASK 2 — Smoke assertions

Add to `smoke.js` in field-relay-nba (check existing pattern for location):

```javascript
// A-ARCHIVE-BRIEF-SCORE-1: /archive/brief POST with no quality_score triggers scoring
// Verify: POST body with brief_type='night_owl', quality_score absent
//         → response is JSON {ok:true}, not plain string 'ok'
// A-ARCHIVE-BRIEF-SCORE-2: COALESCE guard — existing quality_score not overwritten
//         → ON CONFLICT DO UPDATE uses COALESCE(excluded.quality_score, briefs.quality_score)
// A-ARCHIVE-BRIEF-SCORE-3: scoring failure is silent — brief still archived
//         → try/catch wraps runQualityChain, always reaches INSERT
```

---

## TASK 3 — Deploy and verify

```bash
# After deploy:

# 1. POST a test night_owl brief with no quality_score
curl -s -X POST "https://field-relay-nba.jeffunglesbee.workers.dev/archive/brief" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "night_owl_test_scoring_2026-06-23",
    "brief_type": "night_owl",
    "date": "2026-06-23",
    "sport": "MLB",
    "brief_text": "The Dodgers defeated the Cubs 5-2 in a tightly contested affair at Wrigley Field, with Freddie Freeman delivering the decisive two-run double in the seventh inning.",
    "source": "smoke_test"
  }' | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); console.log("ok:", d.ok, "scored:", d.scored)'

# 2. Query D1 to confirm quality_score populated
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/archive/query?brief_type=night_owl&limit=3" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); d.results.forEach(r => console.log(r.id, "score:", r.quality_score))'

# 3. Confirm /quality/report shows night_owl scored > 0
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/quality/report" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync("/dev/stdin","utf8")); const no=d.summary.find(r=>r.brief_type==="night_owl"); console.log("night_owl scored:", no?.scored, "/", no?.total)'
```

---

## SCOPE (Rule 69 — TOUCH-ONLY-A)

DO:
- Edit `/archive/brief` POST handler in `src/index.js` only
- Add 3 smoke assertions
- Single commit

DO NOT:
- Modify any other route
- Modify client code (jubilant-bassoon)
- Change callProxy definition at other call sites
- Touch runQualityChain or journalism-quality.js

---

## UNKNOWNS

- PROXY_URL: verify actual constant name/value from probe #4. If it's an
  env-derived URL (e.g. `env.PROXY_URL`), use that form.
- `runQualityChain` with `maxRetries:1` will score but not regenerate. This
  means the stored text is unchanged — only `quality_score` is added. This
  is intentional: client-generated prose is already delivered to the user;
  we're scoring for analytics, not regenerating for delivery.
- Existing NULL-scored rows in D1 are NOT retroactively scored by this change.
  They would need a separate backfill pass. Leave that for a future session.
