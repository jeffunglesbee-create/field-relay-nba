# CC-CMD AUTO-3: Mandatory output verification block

git pull. Read CLAUDE.md. Run `git log --oneline -3` first.
Write findings to outbox/cc-auto-3-output-verification-2026-06-22.md.

## WHAT

Every CC-CMD that generates briefs currently verifies at the pipeline level:
"did the endpoint return 200, did the INSERT succeed?"

It never verifies at the output level: "is the prose actually good?"

This prompt adds a /briefs/spot-check endpoint that reads N recent briefs
from D1, runs them through the quality scorer, and returns a pass/fail
verdict with flagged phrases. CC calls this as its verification step.
If it fails, the session is NOT done — CC documents the failure in outbox
and flags as carry-forward.

## STATE CHECK

```bash
grep -n "'/briefs/spot-check'\|briefs.*spot.*check\|spot_check" src/index.js
```

If it exists, report the shape. Build only what's missing.

## TASK 1: GET /briefs/spot-check

File: src/index.js — near /integrity or /backfill endpoints.

```javascript
if (pathname === '/briefs/spot-check' && request.method === 'GET') {
    if (!env.ARCHIVE_DB) return new Response(
        JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

    const n = Math.min(parseInt(url.searchParams.get('n') || '5', 10) || 5, 20);
    const source = url.searchParams.get('source') || null; // e.g. 'backfill'
    const briefType = url.searchParams.get('type') || null;

    let query = `SELECT id, brief_type, sport, brief_text, quality_score, source, date
                 FROM briefs WHERE brief_text IS NOT NULL`;
    const params = [];
    if (source) { query += ' AND source = ?'; params.push(source); }
    if (briefType) { query += ' AND brief_type = ?'; params.push(briefType); }
    query += ' ORDER BY date DESC, rowid DESC LIMIT ?';
    params.push(n);

    const rows = await env.ARCHIVE_DB.prepare(query).bind(...params).all();
    const briefs = rows.results || [];

    if (!briefs.length) return new Response(
        JSON.stringify({ ok: true, verdict: 'no_briefs', checked: 0 }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

    // Check each brief for known failure patterns
    const BANNED = [
        'automated ball-strike', 'abs challenge', 'challenge system',
        'stunned', 'shocked', 'thriller', 'instant classic', 'for the ages',
        'didn\'t disappoint', 'lived up to the hype', 'gave fans',
        'left fans', 'in a statement', 'marquee matchup',
    ];

    // Cross-sport contamination: non-basketball terms in a golf brief, etc.
    const CROSS_SPORT_SIGNALS = {
        'golf':  ['ppg', 'rebounds', 'assists', 'points per game', 'three-pointer',
                  'moneyline', 'puck', 'hat trick'],
        'wnba':  ['pitcher', 'home run', 'strikeout', 'hat trick', 'puck'],
        'FIFA World Cup 2026': ['ppg', 'rebounds', 'home run', 'strikeout'],
        'MLB':   ['ppg', 'hat trick', 'puck', 'xG', 'golden goal'],
    };

    const results = briefs.map(b => {
        const text = (b.brief_text || '').toLowerCase();
        const flagged = BANNED.filter(phrase => text.includes(phrase));
        const crossSport = (CROSS_SPORT_SIGNALS[b.sport] || [])
            .filter(term => text.includes(term));
        const wordCount = (b.brief_text || '').split(/\s+/).length;

        const pass = flagged.length === 0
            && crossSport.length === 0
            && wordCount >= 30
            && wordCount <= 120;

        return {
            id: b.id,
            brief_type: b.brief_type,
            sport: b.sport,
            date: b.date,
            source: b.source,
            quality_score: b.quality_score,
            word_count: wordCount,
            pass,
            flagged_phrases: flagged,
            cross_sport: crossSport,
            preview: (b.brief_text || '').slice(0, 150),
        };
    });

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;

    // Overall verdict: PASS only if all briefs pass
    const verdict = failed === 0 ? 'PASS' : 'FAIL';

    return new Response(JSON.stringify({
        ok: true,
        verdict,
        checked: results.length,
        passed,
        failed,
        results,
    }), { headers: { ...CORS, 'Content-Type': 'application/json',
                     'Cache-Control': 'no-store' } });
}
```

Add '/briefs' to ALLOWED_PREFIX at ~line 9583.

## TASK 2: Standard verification step for CC-CMDs

This is the standard block CC adds as the LAST task before session end
in any CC-CMD that generates or modifies briefs.

Document this block in outbox as the standard template.
Write it to docs/CC-CMD-TEMPLATE-brief-verification.md for reference:

```markdown
## OUTPUT VERIFICATION (run after deploy, before session end)

# Spot-check prose quality — must pass before declaring done
RESULT=$(curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/briefs/spot-check?n=5")
VERDICT=$(echo $RESULT | python3 -c "import json,sys; print(json.load(sys.stdin)['verdict'])")
echo "Spot-check verdict: $VERDICT"

if [ "$VERDICT" != "PASS" ]; then
  echo "QUALITY BAR NOT MET — session not done"
  echo "Flagged issues:"
  echo $RESULT | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d['results']:
    if not r['pass']:
        print(f'  {r[\"id\"]}: {r[\"flagged_phrases\"]} {r[\"cross_sport\"]}')
        print(f'    Preview: {r[\"preview\"]}')
"
  echo "Document failure in outbox. Add carry-forward to HANDOFF."
  echo "Do NOT update HANDOFF head or declare session done."
  exit 1
fi

echo "Quality verified. Proceeding to session end."
```
```

CC follows this pattern: if verdict is FAIL, document the specific failures
in the outbox manifest, do not call write_handoff, and leave a carry-forward
in the outbox doc for the next session to pick up.

## SCOPE

DO:
- Add /briefs/spot-check endpoint
- Add '/briefs' to ALLOWED_PREFIX
- Write standard verification template to docs/

DO NOT:
- Modify brief generation paths
- Touch the quality chain
- Touch the client repo

## SESSION END

1. node --check src/index.js
2. Single commit: "feat: /briefs/spot-check + verification template"
3. wrangler deploy
4. Verify the verifier: curl /briefs/spot-check?n=5&source=backfill
   Current backfill briefs should FAIL (ABS fixation, cross-sport).
   That's correct — the endpoint should surface existing problems.
5. Write outbox manifest
6. write_handoff via MCP with updated RELAY HEAD
7. codex_write: key="endpoint/spot-check", category="endpoint",
   title="/briefs/spot-check — mandatory output quality gate for all CC-CMDs"
