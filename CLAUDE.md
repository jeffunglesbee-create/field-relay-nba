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

**PRIME DIRECTIVE: DO NOT RATIONALIZE (Rule 77 / NO-RATIONALIZE-A).** When something fails — CI, smoke, deploy, probe — the first response is investigation, not explanation. "That's expected because..." prevents investigation. Investigate first. Always. See jubilant-bassoon STANDARDS.md Rule 77 for full spec.

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
26. **Rule 68 — CC prompts include executable verification (PROBE-FIRST-A).** CC prompts must include runnable terminal commands, not prose. **PRE-BUILD:** before writing code that reads from an API or endpoint, include a probe command that extracts actual field names/shapes. CC runs it FIRST and writes code against the REAL shape. **POST-BUILD:** include assertion commands (curl + node -e + console.assert) that verify the output. "Verify the endpoint returns status" is a violation. `curl URL | node -e '...console.assert(d.status)...'` is correct. If sandbox blocks the probe, use CI-as-proxy or STAGED per Rule 61. See jubilant-bassoon STANDARDS.md Rule 68 for full spec and case study.
27. **Rule 69 — No unprompted rewrites (TOUCH-ONLY-A).** Only modify code specified in the prompt or required by its direct dependencies. "While I'm here" changes — reformatting, renaming, restructuring working functions, adding features not requested — are prohibited. If adjacent code has issues, document them in the outbox. Refactoring gets its own prompt, commit, and smoke run. See jubilant-bassoon STANDARDS.md Rule 69 for full spec.
28. **Rule 70 — Cross-repo atomic changes (ATOMIC-A).** When a change requires modifications to both relay and client, both MUST be planned in the same prompt. Relay deploys first, client matches. Never: (a) change a relay response shape without updating the client consumer in the same session, (b) write client code that reads fields the relay doesn't serve yet, (c) commit a client change depending on an undeployed relay change. See jubilant-bassoon STANDARDS.md Rule 70 for full spec and case study.
29. **Rule 71 — Read before write (CONTEXT-A).** Before modifying any function: (1) read the function body, (2) grep for every call site, (3) understand WHY the current code does what it does. If you cannot explain the current behavior, you don't understand it well enough to change it. Code from other sessions may look wrong but exist for a reason. See jubilant-bassoon STANDARDS.md Rule 71 for full spec.
30. **Rule 72 — Inherited claims must be re-verified (CHALLENGE-A).** Claims from prior sessions, Drive docs, HANDOFF, or memories that influence build decisions must be verified independently before acting. "The handoff says ESPN has stats" ≠ permission to write code depending on ESPN stats — probe the endpoint. See jubilant-bassoon STANDARDS.md Rule 72.
31. **Rule 73 — Drive doc claims require verification context (CLAIM-CONTEXT-A).** Every factual claim about data availability or API behavior must include: date verified, method, and conditions (live/completed/off-season). "ESPN provides stats" is a violation; must specify state and verification date. See jubilant-bassoon STANDARDS.md Rule 73.
32. **Rule 74 — STAGED requires explicit unblock criteria (STAGED-GATE-A).** STAGED features must document: what's staged, what blocks it, what unblocks it, and exact verify commands. Features without unblock criteria are orphaned. See jubilant-bassoon STANDARDS.md Rule 74.
33. **Rule 75 — CC prompt minimum specificity (PROMPT-SPEC-A).** CC prompts must name target files/functions, expected shapes, scope boundaries (what NOT to touch), and success criteria. "Fix the golf section" is a violation. See jubilant-bassoon STANDARDS.md Rule 75.
34. **Rule 76 — Fallback chain limit (FALLBACK-CAP-A).** Max 2 levels of fallback per data access path. 3+ levels = broken data contract → fix the contract (Rule 60), don't add another fallback. See jubilant-bassoon STANDARDS.md Rule 76.
35. **Rule 77 — Failure is failure (NO-RATIONALIZE-A).** When CI/smoke/deploy fails, investigate first — don't rationalize. "That's expected because..." prevents investigation. Read the error, reproduce, identify root cause, fix. See jubilant-bassoon STANDARDS.md Rule 77.
36. **Rule 78 — Rate-limited API guard (API-COST-A).** Before writing or modifying any external API call: identify rate limits, grep for caching patterns (`cacheEverything`, TTL, ETag), replicate exactly. A missing `cacheEverything` on a cron can burn a monthly quota in one cycle. See jubilant-bassoon STANDARDS.md Rule 78.
37. **Rule 79 — CC prompts resolve against current HEAD (PROMPT-HEAD-A).** CC prompts must: (1) reference only files that exist in target repo — `STANDARDS.md` in a relay prompt is wrong if relay has no STANDARDS.md, (2) not describe state that doesn't match HEAD, (3) include `git log --oneline -5` as first command. See jubilant-bassoon STANDARDS.md Rule 79.

### Governance Principle

"Be fast but don't hurry." — John Wooden

Fast: prepared, efficient, every edit verified, every push clean.
Hurry: skipping checks, patching instead of fixing, rationalizing failures.

Claude's governance obligations are independent of user pace. If the user asks for speed, Claude still verifies syntax, still checks for convention violations, still follows Rules 1-79. A deploy failure caught by CI is a governance failure — CI is a safety net, not the primary check. Claude maintains code integrity regardless of session pace.

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
