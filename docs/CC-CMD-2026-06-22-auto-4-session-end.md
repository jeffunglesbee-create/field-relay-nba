# CC-CMD AUTO-4: Mandatory session-end block

git pull. Read CLAUDE.md. Run `git log --oneline -3` first.
Write findings to outbox/cc-auto-4-session-end-2026-06-22.md.

## WHAT

HANDOFF.md is human-written and goes stale immediately.
The Codex has 21 entries instead of 50+.
CC sessions close without updating either.

This prompt does three things:
1. Adds a /session/record relay endpoint that CC calls at session end —
   it writes structured session state (HEADs, smoke, carry-forwards) to
   D1 and triggers HANDOFF.md auto-update.
2. Writes the standard SESSION-END block that goes in every CC-CMD.
3. Seeds the Codex with the full CLAUDE.md rule set so it has real content.

## STATE CHECK

```bash
grep -n "'/session/record'\|session.*record\|sessionRecord" src/index.js
# Also get current CLAUDE.md rule count
wc -l CLAUDE.md
grep -c '^## Rule\|^### Rule\|^RULE ' CLAUDE.md || grep -c 'Rule [0-9]' CLAUDE.md | head -1
```

## TASK 1: POST /session/record

File: src/index.js — near /archive endpoints.

CC calls this at the end of every session. It writes a session record to D1
and returns the updated HANDOFF anchor for memory.

```javascript
if (pathname === '/session/record' && request.method === 'POST') {
    if (!env.ARCHIVE_DB) return new Response(
        JSON.stringify({ ok: false, error: 'ARCHIVE_DB not bound' }),
        { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

    const body = await request.json().catch(() => null);
    if (!body) return new Response(
        JSON.stringify({ ok: false, error: 'invalid json' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

    // Required fields
    const {
        client_head,  // 7-char SHA e.g. "ed0d7d2"
        relay_head,   // 7-char SHA e.g. "2cf9f29"
        smoke,        // "723/3"
        sw_version,   // "2026-06-21c"
        session_type, // "relay" | "client" | "both" | "docs"
        summary,      // 1-2 sentence summary
        carry_forwards = [], // string[]
        drive_docs = [],     // { id, title }[]
    } = body;

    if (!client_head || !relay_head || !summary) return new Response(
        JSON.stringify({ ok: false, error: 'client_head, relay_head, summary required' }),
        { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    );

    const date = new Date().toISOString().slice(0, 10);
    const ts = new Date().toISOString();
    const id = `session_${date}_${relay_head}`;

    // Write session record to D1 (reuse codex table with category='session')
    await env.ARCHIVE_DB.prepare(`
        INSERT INTO codex (key, category, title, content, drive_refs, updated_at)
        VALUES (?, 'session', ?, ?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
            content = excluded.content,
            drive_refs = excluded.drive_refs,
            updated_at = datetime('now')
    `).bind(
        id,
        `Session ${date} — ${summary.slice(0, 80)}`,
        JSON.stringify({
            client_head, relay_head, smoke, sw_version,
            session_type, summary, carry_forwards, recorded_at: ts,
        }),
        drive_docs.length ? JSON.stringify(drive_docs) : null
    ).run();

    // Build HANDOFF anchor string for memory update
    const channel = session_type === 'client' ? 'CC' :
                    session_type === 'relay' ? 'CC' :
                    session_type === 'docs' ? 'chat' : 'CC';
    const anchor = `CLIENT HEAD ${client_head} · ${date} · via ${channel}. ` +
                   `RELAY HEAD ${relay_head} · ${date} · via ${channel}.`;

    // Write carry-forwards to codex as incidents (skip if empty)
    for (const cf of carry_forwards.slice(0, 10)) {
        const cfKey = `cf/${date}/${cf.slice(0, 40).replace(/\s+/g, '-').toLowerCase()}`;
        await env.ARCHIVE_DB.prepare(`
            INSERT INTO codex (key, category, title, content, updated_at)
            VALUES (?, 'incident', ?, ?, datetime('now'))
            ON CONFLICT(key) DO NOTHING
        `).bind(cfKey, cf.slice(0, 120), cf).run().catch(() => {});
    }

    return new Response(JSON.stringify({
        ok: true,
        session_id: id,
        anchor,
        carry_forwards_written: Math.min(carry_forwards.length, 10),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
```

Add '/session' to ALLOWED_PREFIX at ~line 9583.

## TASK 2: Standard SESSION-END block for all CC-CMDs

Write this to docs/CC-CMD-TEMPLATE-session-end.md:

```markdown
## SESSION END (mandatory — do not skip)

# 1. Run output verification (if briefs were generated/modified)
# curl /briefs/spot-check?n=5 — must return PASS before continuing

# 2. Get current smoke count
SMOKE=$(curl -s https://field-relay-nba.jeffunglesbee.workers.dev/deploy/verify | python3 -c "import json,sys; print('live')" 2>/dev/null || echo "check manually")
CLIENT_SMOKE=$(cd ~/jubilant-bassoon && node smoke.js index.html 2>/dev/null | tail -1)

# 3. Record session to relay
curl -s -X POST https://field-relay-nba.jeffunglesbee.workers.dev/session/record \
  -H "Content-Type: application/json" \
  -d '{
    "client_head": "'$(cd ~/jubilant-bassoon && git rev-parse --short HEAD)'",
    "relay_head": "'$(cd ~/field-relay-nba && git rev-parse --short HEAD)'",
    "smoke": "'$CLIENT_SMOKE'",
    "sw_version": "'$(grep SW_VERSION ~/jubilant-bassoon/index.html | head -1 | grep -o "[0-9-]*[a-z]*")'",
    "session_type": "relay",
    "summary": "[ONE SENTENCE: what shipped]",
    "carry_forwards": ["[carry-forward 1]", "[carry-forward 2]"],
    "drive_docs": [{"id": "[DRIVE_ID]", "title": "[TITLE]"}]
  }'

# 4. write_handoff via MCP — pass content from outbox manifest
# (The anchor string is returned by /session/record above)

# 5. Outbox manifest already written — confirm it's in outbox/
```

## TASK 3: Seed Codex with CLAUDE.md rules

Read CLAUDE.md in the relay repo. For each Rule (they appear as numbered
entries), write a codex_write entry with:
  key: "rule/{N}-{short-slug}"
  category: "decision"
  title: "Rule {N}: {rule name}"
  content: {full rule text}

There are 86 rules (Rules 1-86). Write them in batches of 10.
Use the FIELD Handoff codex_write MCP tool for each entry.

Do NOT skip this task. The Codex having all rules is what makes
session_health meaningful — open incidents can be linked to the
rules they violate.

## SCOPE

DO:
- Add /session/record endpoint
- Add '/session' to ALLOWED_PREFIX
- Write SESSION-END template to docs/
- Seed Codex with all 86 CLAUDE.md rules

DO NOT:
- Auto-update HANDOFF.md from the relay endpoint (write_handoff MCP tool
  handles this separately — don't add a GitHub write to /session/record)
- Modify any brief generation paths
- Touch client repo

## INSTRUCTIONS

1. Relay repo only.
2. git pull. Read CLAUDE.md. Read all 86 rules.
3. Add /session/record endpoint.
4. Add '/session' to ALLOWED_PREFIX.
5. Write SESSION-END template to docs/CC-CMD-TEMPLATE-session-end.md
6. node --check src/index.js
7. Single commit: "feat: /session/record + session-end template"
8. wrangler deploy
9. Write all 86 CLAUDE.md rules to Codex via codex_write MCP tool.
10. Verify: curl -X POST /session/record with test payload.
    Expect: { ok: true, session_id, anchor, carry_forwards_written }
11. Write outbox manifest
12. write_handoff via MCP with updated RELAY HEAD
13. codex_write: key="endpoint/session-record", category="decision",
    title="/session/record — automated session-end state recording"

This CC-CMD is itself the last one that requires you to manually remember
to update HANDOFF. After it ships, every future CC-CMD uses the SESSION-END
template which does it automatically.
