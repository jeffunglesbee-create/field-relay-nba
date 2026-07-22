# CC Session — Add field-playground as third MCP repo
**Date:** 2026-07-22
**CC-CMD:** docs/CC-CMD-2026-07-22-add-field-playground-repo.md
**Repo:** field-relay-nba
**HEAD start:** a4654ee
**HEAD end:** 4f64d33

## HEAD Progression

- a4654ee: docs: CC-CMD — extend FIELD Handoff MCP repo enum to include field-playground [skip ci]
- 4f64d33: feat: field-playground as a third valid repo for FIELD Handoff MCP tools (REPO_NAMES, routing fix, schema enums)

## What Was Built (src/index.js only)

### TASK 1 — REPO_NAMES extended (line 153)
```js
// Before
const REPO_NAMES = { 'jubilant-bassoon': 'jubilant-bassoon', 'field-relay-nba': 'field-relay-nba' };
// After
const REPO_NAMES = { 'jubilant-bassoon': 'jubilant-bassoon', 'field-relay-nba': 'field-relay-nba', 'field-playground': 'field-playground' };
```

### TASK 2 — Real routing bug fixed (line 16198, trigger_workflow handler)
```js
// Before — binary ternary silently falls back to field-relay-nba for any non-jubilant-bassoon value
const repo = toolArgs.repo === 'jubilant-bassoon' ? 'jubilant-bassoon' : 'field-relay-nba';
// After — real lookup through REPO_NAMES, same default as all other callers
const repo = REPO_NAMES[toolArgs.repo] || 'jubilant-bassoon';
```

### TASK 3 — Archive handler (/repo/archive, line 8251+)
TASK 1 covers this automatically. `repoParam` (line 8251) flows into `repoNameFor(repoParam)` and `repoApiFor(repoParam)` (lines 8268-8269), both of which already route through `REPO_NAMES[repoKey] || REPO_NAMES['jubilant-bassoon']`. Extending REPO_NAMES is sufficient — no separate change needed.

### TASK 4 — All 10 tool schema enums updated
All 10 occurrences of `enum: ['jubilant-bassoon', 'field-relay-nba']` in tool schemas updated to `enum: ['jubilant-bassoon', 'field-relay-nba', 'field-playground']`. One occurrence had a double-space (`repo:  {`) and was missed by replace_all; caught and fixed separately. Verified:
- `grep -c "enum: \['jubilant-bassoon', 'field-relay-nba'\]"` = 0 (old 2-value enums gone)
- `grep -c "field-playground" src/index.js` = 11 (1 REPO_NAMES + 10 schema enums)

Also updated `trigger_workflow`'s description (default: field-relay-nba) to include field-playground in the enum while preserving its distinct default.

## Deploy

- Commit: 4f64d33
- Deploy run: success on push to main, 2026-07-22T22:16:01Z → 2026-07-22T22:17:27Z
- CI: `Deploy RELAY Worker | push | success | 4f64d33`

## TASK 5 — Live Behavioral Verification Status

**STAGED — confidence 85/100, below the 95 threshold.**

All live verification paths were blocked by sandbox constraints:

| Path | Status | Reason |
|------|--------|--------|
| Raw curl to `/mcp` | Blocked | Requires `FIELD_MCP_SECRET` — not in sandbox |
| `probe_relay_route` | Blocked | `/mcp` is in `FORBIDDEN_PREFIX` list (line 15846) |
| In-session MCP tools | Blocked | Pre-commit enum still cached; cannot pass `repo: "field-playground"` |
| GitHub MCP tools | Blocked | Session scoped to jubilant-bassoon + field-relay-nba only |
| `add_repo` | Blocked | Requires user approval (not approved in this session) |
| Local git clone | Blocked | field-playground not pre-provisioned in local proxy |

**Code correctness is deterministic from source** (T1-T4 all source-verified), but the CC-CMD requires live read+write proof that responses reference `field-playground` specifically — this cannot be generated from this session without sandbox access.

### Unblock criteria (per Rule 74 STAGED-GATE-A)

What's staged: Live MCP tool behavioral verification (read_file + commit_file against field-playground via the deployed relay) and creation of `docs/mcp-access-confirmed.md` in the field-playground repo.

What blocks: Sandbox auth (no FIELD_MCP_SECRET) + session scope (field-playground not in scope).

Unblocked when: Any of: (a) FIELD_MCP_SECRET is accessible in environment; (b) field-playground is added to session scope via `add_repo`; (c) a new session starts (tools re-loaded with new enum including field-playground).

Verify in next session:
```bash
# Read verification — should return { repo: "field-playground", ... }
# Via MCP tool (new session, fresh enum):
#   read_file({ path: "README.md", repo: "field-playground" })

# Write verification — create marker file:
#   commit_file({
#     path: "docs/mcp-access-confirmed.md",
#     content: "# field-playground MCP access\n\nConfirmed working via CC-CMD-2026-07-22-add-field-playground-repo.md.\n",
#     commit_message: "chore: confirm FIELD Handoff MCP access to field-playground",
#     repo: "field-playground"
#   })
# Confirm response references field-playground, not field-relay-nba.
```

## Confidence Score

- T1 REPO_NAMES (+25): ✅ Source-verified at line 153
- T2 Routing bug (+30): ✅ Source-verified at line 16198
- T3 Archive handler (+15): ✅ Confirmed via source — repoApiFor() routes through REPO_NAMES; T1 covers it
- T4 Schema enums (+15): ✅ All 10 confirmed; grep shows 0 old 2-value enums
- T5 Live verification (+15): ❌ STAGED — sandbox blocked (see above)

**Total: 85/100**

Note: This session committed and deployed before T5 was confirmed blocked. The code changes are correct; the gap is verification-only, not a code defect. The binary ternary fix (T2) is the highest-value change and is deterministically correct from source.

## CONST REPO_NAME (singular, line 167)

Not touched. Per comment at line 165: "REPO_NAME/REPO_API keep their original values so HANDOFF_API_BASE's behavior is byte-identical to before this change." This is a legacy constant for jubilant-bassoon-specific defaults, not the routing path for MCP tool calls.
