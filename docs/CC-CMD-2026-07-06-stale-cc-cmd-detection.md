# CC-CMD: Surface stale pending CC-CMDs in session_health

**Date:** 2026-07-06
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Honest scope, stated up front:** this does NOT make CC-CMDs execute
themselves. There is no mechanism for a Claude Code session to start
autonomously — a human still has to paste the one-liner. What this
*does* do: make chat automatically see, at the start of every single
session (session_health is already called every session per Rule 85),
which pending CC-CMDs have gone stale — instead of that only surfacing
when someone manually asks "is X done?" and chat cross-references git
log against Codex by hand. This is detection automation, not execution
automation — the honest version of "automate follow-ups" given real
constraints (no notification channel exists anywhere in this repo,
confirmed via grep before writing this doc).

**Target time:** ~15 min

## PROBE BLOCK
```bash
sed -n '12403,12412p' src/index.js   # existing open_incidents block — pattern to replicate
grep -n "category = 'incident'" src/index.js
```
Confirm the citation matches before editing — replicate this exact
query/mapping shape, don't invent a new pattern.

## TASK 1 — Add `stale_pending_cc_cmds` to session_health

Immediately after the existing `open_incidents` block (after line
~12410's `out.open_incidents = ...`), add:

```javascript
try {
    const cq = await env.ARCHIVE_DB.prepare(`
        SELECT key, title, updated_at,
               ROUND((julianday('now') - julianday(updated_at)) * 24, 1) AS hours_stale
        FROM codex
        WHERE category = 'cc-cmd-queue' AND title LIKE 'PENDING%'
        ORDER BY updated_at ASC LIMIT 15
    `).all();
    out.stale_pending_cc_cmds = (cq.results || [])
        .filter(r => r.hours_stale >= 2)
        .map(r => ({ key: r.key, title: r.title, hours_stale: r.hours_stale }));
} catch(_) { out.stale_pending_cc_cmds = 'unavailable'; }
```

2-hour threshold: long enough that a CC-CMD dispatched minutes ago
doesn't falsely show as "stale" the moment it's checked, short enough
to actually catch same-day drift. Same try/catch shape as every other
block in this function — a failure here must never break the rest of
session_health's response.

## TASK 2 — Verification

- `node --check src/index.js`
- Query the real `codex` table directly for `category='cc-cmd-queue'
  AND title LIKE 'PENDING%'` and manually confirm at least one real
  entry's `hours_stale` computes correctly against its actual
  `updated_at` (do the arithmetic by hand against wall-clock time, don't
  just trust the SQL ran without erroring).
- Call the deployed `session_health` tool/endpoint post-deploy and
  confirm `stale_pending_cc_cmds` appears with real data, or an empty
  array if nothing currently qualifies — report which case was
  actually observed.

## DONE CONDITIONS
- [ ] Probe block confirms citation before editing
- [ ] `stale_pending_cc_cmds` added, same try/catch shape as surrounding blocks
- [ ] 2-hour threshold applied correctly
- [ ] Verified against real codex data with hand-checked arithmetic, not just clean execution
- [ ] Outbox states plainly that this is detection-only, not execution automation
- [ ] Outbox written

## CONFIDENCE SCORING TABLE
+40  Query added correctly, matches existing pattern exactly, same try/catch safety
+30  Verified against real data with hand-checked hours_stale arithmetic
+20  Live session_health call confirmed the new field appears correctly post-deploy
+10  Outbox honestly scopes this as detection, not execution, automation

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-06-stale-cc-cmd-detection.md. Add the
stale_pending_cc_cmds field to session_health, matching the existing
open_incidents query pattern exactly. Verify against real codex data
with hand-checked arithmetic, and confirm live post-deploy. State
plainly in the outbox that this is detection-only automation, not
execution automation -- Claude Code still requires a human to paste the
one-liner. Do not commit unless confidence >= 95. If score < 95, report
verbatim and stop.
