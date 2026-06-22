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
