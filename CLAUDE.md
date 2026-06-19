# CLAUDE.md — field-relay-nba (FIELD Relay Worker)

## What is this?
Cloudflare Workers relay for the FIELD Global Sports Intelligence PWA. Handles data proxying, journalism generation, Durable Objects, MCP server, and archive endpoints. Companion to jubilant-bassoon (the browser client).

## Key Files
- `src/index.js` — main worker (~5600 lines). All routes, cron handlers, fetch handler.
- `src/journalism-quality.js` — 6-layer quality chain (J0-J7)
- `src/game-do.js` — GameDO Durable Object (live score fan-out via WebSocket)
- `src/ambient-do.js` — AmbientDO (cross-sport SSE)
- `src/bracket-do.js` — BracketDO (WC bracket state)
- `src/user-do.js` — UserDO (per-user state, no PII)
- `src/soccer-wp.js` — Poisson + Dixon-Coles live win probability
- `src/wc-tournament-projections.js` — Monte Carlo WC projections
- `src/finals-context.js` — NBA/NHL Finals narrative context
- `src/mcp-oauth.js` — OAuth 2.1 for claude.ai MCP connector
- `wrangler.toml` — Cloudflare config (TOML format, not JSONC)

## Rules (non-negotiable)

### Core principles
1. **RELAY-IS-DUMB (Rule 47 / ADR-002)** — The relay performs arithmetic and classification ONLY. It NEVER computes drama scores, watch verdicts, interest levels, or editorial recommendations. It stores and serves facts. The browser does all intelligence. This is the single most important rule in this repo.
2. **DO NOT INVENT** — Never fabricate data, stats, scores, or content.
3. **DO NOT ASSUME** — Verify before acting. Read the code, don't guess. Five assumption classes: (A) system state — verify deployed state, not code; (B) limits/quotas — check the actual account; (C) model/API validity — search before declaring invalid; (D) root cause — eliminate alternatives before committing; (E) capability — verify before claiming impossible.
4. **Single-concern commits** — One logical change per commit. Each commit independently revertable.
5. **Archive failure must NEVER break primary functions** — Any D1/R2 write for archival purposes MUST be wrapped in try/catch. Journalism cron, score fan-out, and MCP must never fail because an archive write failed.

### Code review gate (STANDARDS Rule 13)
Before committing, run `git diff --staged` and check:
- Does this change touch a function called from multiple places?
- What routes or cron handlers depend on the code being changed?
- List every caller of any function being modified.
The CSS Grid escalation in jubilant-bassoon (9ce7ef2, reverted) is the case study: an invasive architectural change shipped without impact analysis and broke the production layout.

### Execution path contracts (STANDARDS Rule 24)
Before changing any function that handles live data, map its call chain:
- How often does this function fire? (cron every 5 min? every 15 min? per-request?)
- What triggers it? (cron tick? HTTP request? DO alarm? Queue consumer?)
- Does it write to KV/D1/R2? (if yes, what's the TTL? what reads from it?)
`handleJournalismCycle` fires every 15 min via cron. Any change that adds latency or error paths affects every journalism refresh cycle.

### Infrastructure change protocol (STANDARDS Rule 39)
Before modifying any route, cron handler, binding, or deployment config:
1. Map every dependency
2. Audit every consumer
3. Write the diagnostic before any commit

### Five-minute novel thinking (STANDARDS Rule 42)
If a fix hasn't worked after 3 attempts, STOP. Look at what the system is literally showing. Change approach entirely.

### No legal verdicts (STANDARDS Rule 45)
Do not make legal assessments about data sourcing, API terms, or patent compliance. Flag for human review.

### Claude Code trusted-but-unverified (STANDARDS Rule 59)
CC commits pass CI but lack session context. Chat sessions verify: smoke delta, feature wiring, no invented patterns, no unauthorized structural changes.

## Bindings Reference (wrangler.toml)
| Binding | Type | Purpose |
|---------|------|---------|
| PUSH_SUBS | KV | Push notification subscriptions |
| FIELD_JOURNALISM | KV | Pre-rendered journalism prose (TTL) |
| MCP_OAUTH | KV | OAuth tokens for MCP |
| GAME_DO | DO | Per-game score push |
| USER_DO | DO | Per-user state |
| BRACKET_DO | DO | WC bracket |
| AMBIENT_DO | DO | Cross-sport SSE |
| WC2026_DB | D1 | World Cup group standings + results |
| ARCHIVE_DB | D1 | Game archive (field-archive, cc49101c) |
| DB | D1 | Shared field-d1 (legacy WC2026 alias) |
| FIELD_DATA | R2 | Analytics data (Savant, GSAX, clutch, NFL) |
| JQ_ANALYTICS | AE | Journalism quality metrics |
| JOURNALISM_QUEUE | Queue | Async journalism pipeline |

## CORS
Global headers at line ~560: `Access-Control-Allow-Origin: *`. Use for all new routes.


### Cross-Session Integration Rules (added June 18 2026 — golf layer incident)

18. **Rule 60 — Relay owns the data contract.** This relay defines response field names and nesting for every endpoint. The client (jubilant-bassoon) consumes as-is. If the client needs a normalization layer, the relay is wrong — fix it here. Match client field names exactly (grep jubilant-bassoon for destructuring patterns before building endpoints).
19. **Rule 61 — End-to-end before done.** A feature is not done until the full path works: data source → relay → client → DOM. If the session cannot verify (sandbox limits), document as STAGED with exact curl + expected shape in the outbox. Never declare SHIPPED without integration proof.
20. **Rule 62 — Follow existing conventions.** grep this repo before writing new code. Date handling (handleV2Games converts YYYY-MM-DD → YYYYMMDD), response shapes (stats nested in objects), cache patterns — conventions exist. Do not invent new ones.
21. **Rule 63 — No dead code in commits.** Every endpoint must have a consumer. Every function must have a caller. If staged for future use, mark with // STAGED comment and document in outbox.
22. **Rule 64 — Band-aid detection.** If a client-side fix compensates for a relay bug (field mapping, date conversion), fix it in the relay. The relay is the source of truth.
23. **Rule 65 — Session handoff includes integration state.** Document: relay contract (URL, response shape, field names, TTL), client consumer (function, expected shape), integration status (VERIFIED/STAGED/UNTESTED), known mismatches.

24. **Rule 66 — Mandatory smoke/syntax check before push.** After every file edit: . Before every push: verify deploy workflow will succeed. Cannot be overridden by time pressure.
25. **Rule 67 — CC sessions must document to Drive.** Every CC session that produces code changes MUST write a session doc: date, HEAD progression, what was built per commit, what was verified E2E vs STAGED, open carry-forwards. If CC cannot access Drive, write to `outbox/cc-session-{date}-{scope}.md`. HANDOFF.md must reference the session doc. Absence = violation. See jubilant-bassoon STANDARDS.md Rule 67 for full spec.

### Governance Principle

"Be fast but don't hurry." — John Wooden

Fast: prepared, efficient, every edit verified, every push clean.
Hurry: skipping checks, patching instead of fixing, rationalizing failures.

Claude's governance obligations are independent of user pace. If the user asks for speed, Claude still verifies syntax, still checks for convention violations, still follows Rules 1-66. A deploy failure caught by CI is a governance failure — CI is a safety net, not the primary check. Claude maintains code integrity regardless of session pace.

## Deploy
- Sole deploy path: `.github/workflows/deploy.yml`
- Trigger: push to main (auto-deploys via wrangler)
- Cron: `*/5 * * * *` (push heartbeat) + `*/15 * * * *` (journalism cycle)

## Git
- `git config user.email "claude@field.dev"` / `git config user.name "FIELD CI"`
- Commit prefixes: `feat:`, `fix:`, `ci:`, `docs:`

## Key Functions
- `handleJournalismCycle(env)` — line ~2893. Every 15 min. Generates slate brief, stores in FIELD_JOURNALISM KV.
- Route section starts at line ~3329. Pattern: `pathname === '/...'` or `pathname.startsWith('/...')`.
- Archive routes at line ~3835 (`/archive/*`) — currently read-only GET endpoints.
- MCP probe allow-list — hardcoded array in the `/mcp` route handler. New routes that should be probeable must be added here.

## Journalism Model
The relay calls field-claude-proxy (separate worker) which routes to Gemini 3.1 Flash-Lite (primary, Paid Tier 1) with Claude Haiku 4.5 fallback. The proxy handles model routing — this relay sends prompts and receives prose.

## What NOT to do
- Do NOT modify wrangler.toml bindings without explicit approval
- Do NOT add new Durable Object classes (requires migration entries)
- Do NOT change cron frequencies
- Do NOT remove or rename existing routes (clients depend on them)
- Do NOT store interest levels, drama scores, or engagement metrics in any binding
- Do NOT change the journalism prompt structure without reading src/journalism-quality.js first
- Do NOT make structural changes to the fetch handler routing without authorization (see CSS Grid case study)
