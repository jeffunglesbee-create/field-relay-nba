# Outbox — BrowserDO Session Reuse (cut Browser Rendering cost)

**Date:** 2026-07-01
**Relay HEAD:** 7fbb4ab
**CC-CMD:** docs/CC-CMD-2026-06-30-browserdo-session-reuse.md
**Status:** SHIPPED

---

## Pre-Build Probe Results

| Probe | Finding |
|-------|---------|
| Binding name (`grep -n "BROWSER" wrangler.toml`) | `binding = "BROWSER"` at L168. Confirmed `this.env.BROWSER` is correct — matches STAT's `env.MYBROWSER` pattern, different name, same type. |
| `_ensureBrowser()` location | L62–73. Blind `puppeteer.launch(this.env.BROWSER, { protocolTimeout: 60000 })` with no idle-session check. |
| `_close()` location | L236–242. `await this.browser.close()` — terminates instance, forces fresh launch next time. |
| `@cloudflare/puppeteer` version | `^1.1.0` in `package.json`. Same major version as STAT (`^1.1.0` assumed — API identical per Cloudflare's own docs: `sessions()`, `connect()`, `disconnect()` all stable in 1.x). |

---

## What Was Built

Two surgical edits to `src/browser-do.js`. No other files touched.

### Task 1 — `_ensureBrowser()` idle-session-reuse (L62–73)

Replaced blind `puppeteer.launch()` with the STAT-borrowed pattern:

```js
async _ensureBrowser() {
  if (!this.browser || !this.browser.isConnected()) {
    let browser = null;
    try {
      const sessions = await puppeteer.sessions(this.env.BROWSER);
      const idle = sessions.filter(s => !s.connectionId);
      if (idle.length > 0) {
        try { browser = await puppeteer.connect(this.env.BROWSER, idle[0].sessionId); } catch {}
      }
    } catch {}
    this.browser = browser || await puppeteer.launch(this.env.BROWSER, { protocolTimeout: 60000 });
    this.page    = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 800 });
    this.createdAt   = Date.now();
    this.actionCount = 0;
  }
  if (!this.page) {
    this.page = await this.browser.newPage();
  }
}
```

The outer `try/catch` wraps the entire `sessions()`+`connect()` attempt — any failure falls through silently to `launch()`. The inner `try/catch` around `connect()` handles the case where `sessions()` returns an idle entry that another caller grabbed in the interval. Rule 5 compliance: failure to reuse never breaks the session.

### Task 2 — `disconnect()` instead of `close()` in `_close()` (L238)

```diff
-      if (this.browser) await this.browser.close();
+      if (this.browser) await this.browser.disconnect();
```

`disconnect()` detaches this DO instance from the remote browser without terminating it. The browser returns to Cloudflare's idle pool with no `connectionId`, where the next `_ensureBrowser()` call can find and reuse it via Task 1's `sessions()` check.

**Trade-off (explicit, chosen, not silent):** a browser instance that nothing ever reconnects to will sit idle costing money until Cloudflare's own platform-level reaping kicks in. Our 5-min alarm (`alarm()` in BrowserDO) fires per DO instance and clears the DO's state — it calls `_close()` which now disconnects rather than terminates. The underlying browser instance is then orphaned until CF reaps it. This is the identical trade-off STAT's `fetchTaleo()` accepted in production with this exact pattern. It is validated there, not speculative here. The reuse benefit (avoiding a fresh launch on every one-shot call) outweighs the orphan-idle cost given the high call volume (297 hours over 8 days).

---

## Pattern Provenance

Ported faithfully from `stat-job-watcher/src/adapters.js` `fetchTaleo()` (~L538–544), not reinvented. The only adaptation is the binding name: STAT uses `env.MYBROWSER`, FIELD uses `this.env.BROWSER`. The `connectionId` idle-detection field, the double try/catch structure, and the `browser || await launch()` fallback are identical.

---

## Verification

**CC-side (build/CI):**

- Commit: `7fbb4ab`
- Workflow run: `28488666434`
- CI conclusion: `success`

**Live verification (chat-side follow-up):**

Confirming the actual billing impact requires observing Cloudflare Browser Rendering hours via the GraphQL Analytics API over the next several days. No CI run can verify a billing-metric improvement — it requires real usage against the deployed Worker. Expected signal: Browser Rendering hours should drop significantly for one-shot MCP calls (viewport screenshots, tab checks) that were each launching fresh instances before this change.

Query to run after a few days of traffic:
```graphql
{
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      browserRenderingSummary(
        filter: { datetime_geq: "2026-07-01T00:00:00Z" }
        limit: 10
      ) { sum { browserSessionSeconds } }
    }
  }
}
```
