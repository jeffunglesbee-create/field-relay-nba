# Claude Code Command — BrowserDO Session Reuse (cut Browser Rendering cost)

**Branch:** main — commit directly, do not create a feature branch or PR.

git pull. Read CLAUDE.md.

Write all findings to outbox/cc-browserdo-session-reuse-2026-06-30.md.

## CONTEXT

Cloudflare billing (verified via GraphQL Analytics + dashboard invoice,
2026-06-30): 297 Browser Rendering hours over the May 30–Jun 29 billing
window, $25.83 for hours beyond the 10 free. BrowserDO (`src/browser-do.js`)
has only existed since 2026-06-22 (~8 days of the 30-day window), so this
is a genuinely high rate of accrual for what is chat-triggered, mostly
one-shot verification usage (viewport screenshots, tab checks, etc.).

ROOT CAUSE (read directly from source, not inferred): `_ensureBrowser()`
in `src/browser-do.js` does a blind `puppeteer.launch(this.env.BROWSER)`
on every cold session — no check for an already-running idle instance to
reuse first. Cloudflare Browser Rendering bills by browser-instance
wall-clock duration, not work performed. Since `browser_navigate` is
called without an existing `sessionId` for essentially every one-shot
check, each call launches and bills a brand-new instance instead of
reusing one of potentially several already-idle instances sitting in the
account's pool.

Compounding this: `_close()` calls `this.browser.close()`, which fully
terminates the instance. This throws away reuse potential even for
sessions that DO close cleanly — the correct pattern is `disconnect()`
(leaves the remote browser alive and idle, available for the next
`puppeteer.connect()`) not `close()` (kills it, forcing the next caller to
launch fresh again).

**This is not a novel pattern to design — it already exists, proven, in
this same Cloudflare account.** `fetchTaleo()` in `stat-job-watcher`'s
`src/adapters.js` (~line 538-544) does session reuse correctly:

```js
const sessions = await puppeteer.sessions(env.MYBROWSER);
const idle = sessions.filter(s => !s.connectionId);
if (idle.length > 0) {
  try { browser = await puppeteer.connect(env.MYBROWSER, idle[0].sessionId); } catch {}
}
if (!browser) browser = await puppeteer.launch(env.MYBROWSER);
```

Port this pattern into BrowserDO — same binding type (`@cloudflare/puppeteer`
against a Browser Rendering binding), same API, different repo. Note the
binding name differs: STAT's is `env.MYBROWSER`, FIELD's is `env.BROWSER`
— confirm the exact binding name in `field-relay-nba`'s wrangler.toml
before writing code, don't assume it matches STAT's naming.

## PRE-BUILD PROBE (read every symbol below from HEAD before writing anything — Rule 87)

```bash
grep -n "BROWSER" wrangler.toml
sed -n '60,75p' src/browser-do.js   # current _ensureBrowser()
sed -n '236,242p' src/browser-do.js # current _close()
grep -n "puppeteer.sessions\|puppeteer.connect\|puppeteer.launch" ../stat/src/adapters.js 2>/dev/null || echo "STAT repo not cloned locally — reference the pattern shown above verbatim, it was read directly from stat/src/adapters.js by chat this session"
```

Confirm `puppeteer.sessions()`'s exact return shape (`connectionId` field
used to detect idle vs in-use) matches what's used in STAT's pattern —
this is Cloudflare's own `@cloudflare/puppeteer` package API, should be
identical across bindings, but verify the installed package version in
`field-relay-nba`'s `package.json` matches or is compatible with what
STAT uses before assuming identical behavior.

## TASK 1: Session reuse in `_ensureBrowser()`

Replace the current blind-launch logic:

```js
async _ensureBrowser() {
  if (!this.browser || !this.browser.isConnected()) {
    this.browser = await puppeteer.launch(this.env.BROWSER, { protocolTimeout: 60000 });
    ...
  }
  ...
}
```

with idle-session-reuse-first, mirroring STAT's pattern exactly:

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

Wrap the `puppeteer.sessions()`/`connect()` attempt in try/catch exactly
as shown — a failure here must silently fall through to `launch()`, never
break the session (Rule 5).

## TASK 2: `disconnect()` instead of `close()` on normal session end

In `_close()`, change `await this.browser.close()` to
`await this.browser.disconnect()` — this returns the instance to
Cloudflare's idle pool for Task 1's reuse logic to find, instead of
terminating it. Keep the try/catch wrapper as-is.

**Trade-off to note explicitly in the outbox doc:** this means a browser
instance that nothing ever reconnects to will sit idle costing money until
Cloudflare's own platform-level reaping kicts in (not our 5-min alarm,
which only fires per-DO-instance, not per-underlying-browser). This is the
same trade-off STAT already accepted with this exact pattern in
production — treat it as validated, not speculative — but state it
explicitly so it's a known, chosen trade-off rather than a silent one.

## TASK 3: Verification — CC-side scope is build/CI only

Same constraint as every CC-CMD this session: CC's egress blocks
`*.workers.dev`. Done condition is code committed, CI green, deploy
completed (GitHub Actions API, not the live endpoint). State in the
outbox doc that live verification — confirming actual browser-hours drop
over the next several days via the GraphQL Analytics API — is a chat-side
follow-up (there's no way to verify a billing-metric improvement within a
single CI run; it requires observing real usage over time).

## TASK 4: Outbox manifest (last task)

Write `outbox/cc-browserdo-session-reuse-2026-06-30.md` covering: the
confirmed `env.BROWSER` binding name and any package-version notes from
the probe, the exact diff, CI/deploy status, and explicit confirmation
that the STAT-borrowed pattern was ported faithfully (not reinvented).
