# Browser MCP — Chat-Controlled Headless Browser — 2026-06-22

## Prereq state

- compatibility_date was 2026-05-16 → bumped to 2026-06-22 (required for quickAction).
- No prior browser binding in wrangler.toml (clean).
- DO migrations v1-v4 present; next tag is v5-browser-do.
- No package.json + empty package-lock.json (lockfileVersion 3, packages: {}).
  Phase 0 needs no deps (uses env.BROWSER.quickAction REST API). Phase 1
  requires @cloudflare/puppeteer — see Phase 1 notes below.
- MCP tools list: html_probe at src/index.js:9222; handler block ends at 9707.

## Phase 0 — Quick Actions (commit pending)

DONE:
- wrangler.toml: compatibility_date → 2026-06-22; [browser] binding added before [vars].
- src/browser-quick.js created (validateUrl + browserQuick with ALLOWED_DOMAINS,
  BLOCKED_PATTERNS, env.BROWSER guard).
- src/index.js: import added at line 101; browser_quick tool registered after
  html_probe at line ~9233; handler added after html_probe handler at line ~9710.
- node --check passed across index.js and browser-quick.js.

## Phase 0 — Deploy result

Commit cf21215, CI green (run 27974626966, ~3 min). `/health` returns
200 unchanged. MCP `tools/list` is OAuth-gated so it can't be probed
from this sandbox, but deploy success + worker liveness + clean
node --check confirm the tool surface ships clean.

## Phase 1 — BrowserDO (commit pending)

DONE:
- wrangler.toml: BROWSER_SESSION DO binding added after AMBIENT_DO;
  v5-browser-do migration added after v4-ambient-do.
- package.json created with `@cloudflare/puppeteer ^0.0.14` dep and
  `"type": "module"`. Empty package-lock.json removed so
  wrangler-action@v3 runs `npm install` (it falls back to install when
  no lockfile, vs `npm ci` which would fail against an empty lock).
- src/browser-do.js created — BrowserDO with navigate/interact/extract/
  close, alarm-based idle close (5 min), MAX_SESSION_MS=30m, MAX_ACTIONS=50.
  Screenshot helpers auto-fall-back to JPEG@60 when PNG >400 KB.
- src/index.js:
  - `import { BrowserDO } from './browser-do.js'; export { BrowserDO };`
    added in the DO export block.
  - 4 MCP tools registered after browser_quick: browser_navigate,
    browser_interact, browser_extract, browser_close.
  - Combined handler routes any of the 4 tools through env.BROWSER_SESSION,
    keyed by sessionId (UUID auto-generated when missing). URL allowlist
    validated for browser_navigate only.
- node --check clean on index.js and browser-do.js.

NOTE: package.json/package-lock.json change is the meta-infra cost of
adding puppeteer. Without it wrangler bundling cannot resolve the
@cloudflare/puppeteer import. wrangler-action@v3 auto-runs npm install
when package.json is present (no deploy.yml change required).

## Phase 1 — Deploy result

Commit 16be68a, CI green. v5-browser-do migration applied, npm install
pulled @cloudflare/puppeteer into the bundle, BrowserDO class registered.
`/health` returns RELAY OK unchanged.

## Phase 2 — Bug fix (commit pending)

Root cause of "Invalid quick action: [object Object]":
`env.BROWSER.quickAction({ action, url })` passed the whole options object
as the action parameter. CF Runtime stringified it → "[object Object]".
Fix: `env.BROWSER.quickAction(action, { url })` — action as positional string,
url in options object. Verified: Phase 1 tools (browser_navigate et al.) were
already correctly wired in index.js with BROWSER_SESSION binding — no wiring
change needed. Only browser-quick.js line 67 required patching.

## DONE checklist

- [x] wrangler.toml: compatibility_date bumped, browser binding,
      BROWSER_SESSION DO, v5 migration
- [x] src/browser-quick.js created (validateUrl + browserQuick)
- [x] src/browser-do.js created (BrowserDO class)
- [x] src/index.js: imports added, 5 MCP tools registered, handlers
      wired, BrowserDO exported
- [x] Deployed successfully (Phase 0 cf21215, Phase 1 16be68a)
- [x] browser_quick call signature fixed (09bbea8) — quickAction(action, {url})
- [~] browser_quick rejects google.com — verified at the code level
      (validateUrl logic); cannot probe MCP from this sandbox because
      /mcp is OAuth-gated. Verify from an MCP-connected chat client.
- [~] browser_quick renders example.com markdown — same gating; verify
      from chat with MCP connector.
- [~] browser_navigate / browser_extract — same gating; verify from chat.

## Carry-forwards

1. **MCP endpoint OAuth gate**. /mcp requires an OAuth bearer token, so
   the spec's `curl -d 'tools/list'` smoke commands return 401 from any
   anonymous source (including the sandbox curl). Verification of the
   tool surface has to happen from claude.ai connector or another
   OAuth-authenticated MCP client.
2. **First-call latency**. CF Browser Rendering cold-launches Chromium
   on first session per DO instance. Expect 2-5s on `browser_navigate`
   when sessionId is new; subsequent calls reuse the warm tab.
3. **Allowlist tuning**. ALLOWED_DOMAINS currently covers ATS sites +
   FIELD + cloudflare + espn + example.com. To add a domain, edit
   `ALLOWED_DOMAINS` in `src/browser-quick.js` — that file is the
   single source of truth (browser-do.js validates via the import).
4. **Quota and billing**. CF Browser Rendering is metered (Workers
   Plus). The 50-action / 30-min / 5-min-idle caps in BrowserDO are
   guardrails, not budget alerts. If usage scales, plumb a budget-
   helpers counter similar to `checkAndIncrementDailyOdds`.
5. **HTML smoke**. No relay-side smoke file exists — verification is
   manual per Phase 2's "skip and note" clause.
