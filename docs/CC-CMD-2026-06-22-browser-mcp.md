# Claude Code Command — Browser Rendering MCP (Chat-Controlled Headless Browser)
# Spec: Drive 1Fite5hBaJviHxvqp33EwR-vqnOeHXYe9fli6C34_cuE

git pull. Read CLAUDE.md. Run `git log --oneline -3` first.

Write running notes to outbox/cc-browser-mcp-2026-06-22.md as you go.

---

## CONTEXT

This adds a headless browser to Claude chat via the relay MCP server.
Chat → MCP tool call → relay Worker → Cloudflare Browser Rendering → Chromium.
Works from iPad. No Claude in Chrome extension required.

Two phases in this commit:
  Phase 0: Stateless Quick Actions (screenshot/json/markdown/links) — no DO needed
  Phase 1-4: Full BrowserDO with session persistence, click/type/extract

Complete ALL phases in one session. Deploy and verify after each phase.

---

## PREREQUISITE CHECKS

Run these before writing any code. Stop and report if anything is wrong.

```bash
# Verify wrangler.toml has no existing browser binding
grep -n 'browser\|BROWSER\|puppeteer\|Browser' wrangler.toml

# Check current DO migration tags
grep -n 'tag.*=\|new_classes' wrangler.toml

# Verify src/index.js MCP tool listing location
grep -n 'browser_navigate\|browser_quick\|html_probe\|tools.*list\|inputSchema' src/index.js | head -20

# Check compatibility_date — needs 2026-03-24+ for quickAction()
grep 'compatibility_date' wrangler.toml

# Verify CLAUDE.md DO pattern reference
grep -n 'BracketDO\|GameDO\|AmbientDO' src/index.js | head -5
```

---

## PHASE 0: Quick Actions MCP (~20 min)

Stateless one-shot browser operations. No Durable Object. Verifiable immediately.

### 0.1 — wrangler.toml: add browser binding and bump compatibility_date

In wrangler.toml:

1. Update compatibility_date to `"2026-06-22"` (required for quickAction())

2. Add browser binding (after the R2 bucket block, before [vars]):

```toml
# ── Browser Rendering (Browser MCP — June 22 2026) ───────────────────────────
# Headless Chromium for MCP-driven browser automation from Claude chat.
# Enables browser_quick (Phase 0) and browser_navigate/interact/extract (Phase 1).
# Workers Plus required (active since May 31 2026).
[browser]
binding = "BROWSER"
```

### 0.2 — New file: src/browser-quick.js

```javascript
/**
 * browser-quick.js — Phase 0 Browser MCP
 * Stateless Quick Actions via Cloudflare Browser Rendering REST API.
 * No session state, no DO. One URL → one result.
 * Phase 1 (BrowserDO) adds session persistence for multi-step workflows.
 */

// URL allowlist — only these domains may be browsed
const ALLOWED_DOMAINS = [
  /^https?:\/\/[^/]*\.icims\.com/,
  /^https?:\/\/[^/]*\.myworkdayjobs\.com/,
  /^https?:\/\/[^/]*\.greenhouse\.io/,
  /^https?:\/\/[^/]*\.lever\.co/,
  /^https?:\/\/[^/]*\.taleo\.net/,
  /^https?:\/\/[^/]*\.successfactors\.com/,
  /^https?:\/\/[^/]*\.cloudflare\.com/,
  /^https?:\/\/[^/]*\.espn\.com/,
  /^https?:\/\/field-relay-nba\.jeffunglesbee\.workers\.dev/,
  /^https?:\/\/jubilant-bassoon\.pages\.dev/,
  /^https?:\/\/example\.com/,  // for verification
];

// Blocked patterns (checked after allowlist)
const BLOCKED_PATTERNS = [
  /password/i,
  /payment/i,
  /checkout/i,
  /bank/i,
  /gmail\.com/,
  /outlook\.com/,
  /twitter\.com/,
  /facebook\.com/,
];

/**
 * Validate URL against allowlist + blocklist.
 * Returns { ok: true } or { ok: false, reason: string }
 */
export function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'Invalid URL format' };
  }

  // Must be http or https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reason: 'Only http/https URLs allowed' };
  }

  // Check allowlist
  const allowed = ALLOWED_DOMAINS.some(pattern => pattern.test(url));
  if (!allowed) {
    return { ok: false, reason: `Domain not in allowlist. Allowed: ATS sites (iCIMS, Workday, Greenhouse, Lever, Taleo, SuccessFactors), cloudflare.com, espn.com, FIELD app.` };
  }

  // Check blocklist
  const blocked = BLOCKED_PATTERNS.some(pattern => pattern.test(url));
  if (blocked) {
    return { ok: false, reason: 'URL matches blocked pattern' };
  }

  return { ok: true };
}

/**
 * Execute a Quick Actions browser operation.
 * @param {object} env - Worker env with env.BROWSER binding
 * @param {string} url - URL to browse
 * @param {string} action - "screenshot" | "json" | "markdown" | "links"
 * @returns {object} result
 */
export async function browserQuick(env, url, action) {
  const validation = validateUrl(url);
  if (!validation.ok) {
    return { error: validation.reason, allowed: false };
  }

  const validActions = ['screenshot', 'json', 'markdown', 'links'];
  if (!validActions.includes(action)) {
    return { error: `Invalid action. Must be one of: ${validActions.join(', ')}` };
  }

  try {
    const result = await env.BROWSER.quickAction({
      action,
      url,
    });

    if (action === 'screenshot') {
      // result is ArrayBuffer of PNG bytes
      const bytes = new Uint8Array(result);
      const base64 = btoa(String.fromCharCode(...bytes));
      return {
        action,
        url,
        screenshot: base64,
        mimeType: 'image/png',
        note: 'Render complete. Base64 PNG returned.',
      };
    }

    // json/markdown/links return text or object
    if (action === 'json') {
      return { action, url, data: typeof result === 'string' ? JSON.parse(result) : result };
    }

    return { action, url, content: result };

  } catch (err) {
    return { error: err.message, url, action };
  }
}
```

### 0.3 — src/index.js: import + MCP tool registration + handler

**Step A: Import** (add near top with other imports):
```javascript
import { validateUrl, browserQuick } from './browser-quick.js';
```

**Step B: MCP tools list** — find the array where tools like `html_probe`,
`read_handoff`, `get_head_sha` etc. are listed. Add:

```javascript
{
  name: 'browser_quick',
  description: 'Open a URL in a headless browser and return a screenshot, structured JSON, markdown text, or all links. Stateless — no session is maintained between calls. Use browser_navigate for multi-step interactive sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Full URL to open (must be in allowlist: ATS sites, cloudflare.com, espn.com, FIELD app)',
      },
      action: {
        type: 'string',
        enum: ['screenshot', 'json', 'markdown', 'links'],
        description: 'screenshot: PNG image of rendered page | json: structured data extracted from page | markdown: page content as markdown | links: all links on page',
      },
    },
    required: ['url', 'action'],
  },
},
```

**Step C: MCP tools/call handler** — find the switch/if block handling tool calls.
Add case for browser_quick:

```javascript
case 'browser_quick': {
  const { url, action } = toolInput;
  if (!url || !action) {
    return mcpError('browser_quick requires url and action');
  }
  const result = await browserQuick(env, url, action);
  return mcpResult(JSON.stringify(result, null, 2));
}
```

(Use whatever helper pattern the existing tool handlers use — mcpResult/mcpError
or direct content array. Match the existing pattern exactly.)

### 0.4 — Deploy and verify Phase 0

```bash
# Deploy
npx wrangler deploy

# Verify MCP lists browser_quick
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | grep -o 'browser_quick'

# Verify it rejects non-allowlisted URL
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"browser_quick","arguments":{"url":"https://google.com","action":"markdown"}}}' \
  | grep -o 'not in allowlist'

# Verify it accepts example.com
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browser_quick","arguments":{"url":"https://example.com","action":"markdown"}}}' \
  | grep -o '"content"\|"error"'
```

Write verification results to outbox/cc-browser-mcp-2026-06-22.md before continuing.

---

## PHASE 1: BrowserDO — Session Persistence

Durable Object holding a Puppeteer session alive across multiple MCP calls.
Same lifecycle pattern as GameDO (alarm-based cleanup).

### 1.1 — wrangler.toml: add BrowserDO binding and migration

Add to [[durable_objects.bindings]] section:

```toml
# BrowserDO — holds Puppeteer browser session across MCP calls (June 22 2026)
# Session ID (UUID) maps to one DO instance per active browser tab.
# Auto-closes after 5 min idle via alarm. Hard cap: 50 actions, 30 min lifetime.
[[durable_objects.bindings]]
name       = "BROWSER_SESSION"
class_name = "BrowserDO"
```

Add migration (use next tag after v4-ambient-do):

```toml
# Migration: introduce BrowserDO (June 22 2026).
[[migrations]]
tag         = "v5-browser-do"
new_classes = ["BrowserDO"]
```

### 1.2 — New file: src/browser-do.js

```javascript
/**
 * browser-do.js — Phase 1 Browser MCP
 * Durable Object holding a Puppeteer session alive across MCP calls.
 * Session ID (UUID) → one DO instance → one persistent browser tab.
 *
 * Supported actions (via POST JSON body):
 *   { tool: 'browser_navigate', args: { sessionId, url, waitUntil?, viewport? } }
 *   { tool: 'browser_interact', args: { sessionId, action, selector?, value?, pressEnter? } }
 *   { tool: 'browser_extract',  args: { sessionId, mode, expression? } }
 *   { tool: 'browser_close',    args: { sessionId } }
 */

import puppeteer from '@cloudflare/puppeteer';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;   // 5 minutes
const MAX_SESSION_MS  = 30 * 60 * 1000;  // 30 minutes
const MAX_ACTIONS     = 50;

export class BrowserDO {
  constructor(state, env) {
    this.state = state;
    this.env   = env;
    this.browser      = null;
    this.page         = null;
    this.createdAt    = null;
    this.actionCount  = 0;
  }

  async alarm() {
    // Idle timeout fired — close browser
    await this._close();
  }

  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const { tool, args } = body;

    try {
      // Enforce lifetime cap
      if (this.createdAt && Date.now() - this.createdAt > MAX_SESSION_MS) {
        await this._close();
        return this._json({ error: 'Session expired (30 min max lifetime). Call browser_navigate without sessionId to start a new session.' });
      }

      // Enforce action cap
      if (this.actionCount >= MAX_ACTIONS) {
        await this._close();
        return this._json({ error: `Session action cap reached (${MAX_ACTIONS} actions). Start a new session.` });
      }

      // Reset idle alarm
      await this.state.storage.setAlarm(Date.now() + IDLE_TIMEOUT_MS);

      switch (tool) {
        case 'browser_navigate': return await this._navigate(args);
        case 'browser_interact': return await this._interact(args);
        case 'browser_extract':  return await this._extract(args);
        case 'browser_close':    return await this._closeAction();
        default:
          return this._json({ error: `Unknown tool: ${tool}` });
      }
    } catch (err) {
      return this._json({ error: err.message, tool });
    }
  }

  // ── Launch browser if not running ─────────────────────────────────────────

  async _ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch(this.env.BROWSER);
      this.page    = await this.browser.newPage();
      await this.page.setViewport({ width: 1280, height: 800 });
      this.createdAt   = Date.now();
      this.actionCount = 0;
    }
    if (!this.page) {
      this.page = await this.browser.newPage();
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async _navigate(args) {
    await this._ensureBrowser();
    const { url, waitUntil = 'networkidle0', viewport } = args;

    if (viewport) {
      await this.page.setViewport(viewport);
    }

    await this.page.goto(url, { waitUntil, timeout: 30000 });
    this.actionCount++;

    const [screenshot, title, finalUrl, text, meta] = await Promise.all([
      this._screenshot(),
      this.page.title(),
      this.page.url(),
      this._visibleText(),
      this._meta(),
    ]);

    return this._json({
      sessionId: args.sessionId,
      screenshot,
      title,
      url: finalUrl,
      text,
      meta,
      actionCount: this.actionCount,
    });
  }

  async _interact(args) {
    await this._ensureBrowser();
    const { action, selector, value, pressEnter = false } = args;
    this.actionCount++;

    try {
      switch (action) {
        case 'click': {
          if (selector.startsWith(':text(')) {
            const text = selector.match(/:text\(['"](.+)['"]\)/)?.[1];
            if (!text) throw new Error('Invalid :text() selector');
            await this.page.locator(`text/${text}`).click();
          } else {
            await this.page.click(selector, { timeout: 10000 });
          }
          await this.page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});
          break;
        }
        case 'type': {
          await this.page.focus(selector);
          await this.page.keyboard.type(value || '');
          if (pressEnter) await this.page.keyboard.press('Enter');
          break;
        }
        case 'select': {
          await this.page.select(selector, value);
          break;
        }
        case 'scroll': {
          if (value === 'up') {
            await this.page.evaluate(() => window.scrollBy(0, -500));
          } else if (selector) {
            await this.page.locator(selector).scrollIntoView();
          } else {
            await this.page.evaluate(() => window.scrollBy(0, 500));
          }
          break;
        }
        case 'wait': {
          await this.page.waitForSelector(selector, { timeout: 10000 });
          break;
        }
        case 'back': {
          await this.page.goBack({ waitUntil: 'networkidle0', timeout: 10000 });
          break;
        }
        case 'forward': {
          await this.page.goForward({ waitUntil: 'networkidle0', timeout: 10000 });
          break;
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      const [screenshot, text, url] = await Promise.all([
        this._screenshot(),
        this._visibleText(),
        this.page.url(),
      ]);

      return this._json({ success: true, screenshot, text, url, actionCount: this.actionCount });

    } catch (err) {
      const screenshot = await this._screenshot().catch(() => null);
      return this._json({ success: false, error: err.message, screenshot, actionCount: this.actionCount });
    }
  }

  async _extract(args) {
    await this._ensureBrowser();
    const { mode, expression } = args;
    this.actionCount++;

    let data;
    switch (mode) {
      case 'cookies':
        data = await this.page.cookies();
        break;

      case 'forms':
        data = await this.page.evaluate(() => {
          return Array.from(document.querySelectorAll('input, select, textarea')).map(el => ({
            tag:   el.tagName.toLowerCase(),
            name:  el.name  || el.id || null,
            type:  el.type  || null,
            value: el.value || null,
            placeholder: el.placeholder || null,
            required: el.required || false,
            label: document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() || null,
          }));
        });
        break;

      case 'json-ld':
        data = await this.page.evaluate(() => {
          return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
            .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
            .filter(Boolean);
        });
        break;

      case 'links':
        data = await this.page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map(a => ({
            href: a.href,
            text: a.textContent.trim().slice(0, 100),
          }))
        );
        break;

      case 'evaluate':
        if (!expression) throw new Error('evaluate mode requires expression parameter');
        data = await this.page.evaluate(expression);
        break;

      case 'full-text':
        data = await this.page.evaluate(() => document.body.innerText);
        break;

      default:
        return this._json({ error: `Unknown mode: ${mode}. Valid: cookies, forms, json-ld, links, evaluate, full-text` });
    }

    return this._json({ mode, data, actionCount: this.actionCount });
  }

  async _closeAction() {
    await this._close();
    return this._json({ closed: true });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async _close() {
    try {
      if (this.browser) await this.browser.close();
    } catch { /* ignore */ }
    this.browser = null;
    this.page    = null;
  }

  async _screenshot() {
    try {
      const buf = await this.page.screenshot({ type: 'png' });
      // Resize: if buf > 400KB, take a JPEG at lower quality
      const bytes = new Uint8Array(buf);
      if (bytes.length > 400_000) {
        const jpegBuf = await this.page.screenshot({ type: 'jpeg', quality: 60 });
        return 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...new Uint8Array(jpegBuf)));
      }
      return 'data:image/png;base64,' + btoa(String.fromCharCode(...bytes));
    } catch {
      return null;
    }
  }

  async _visibleText() {
    try {
      const text = await this.page.evaluate(() => document.body?.innerText || '');
      return text.slice(0, 4000);
    } catch {
      return '';
    }
  }

  async _meta() {
    try {
      return await this.page.evaluate(() => {
        const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
          .filter(Boolean);
        const forms = document.querySelectorAll('form').length;
        const links = document.querySelectorAll('a[href]').length;
        return { jsonLd, forms, links };
      });
    } catch {
      return {};
    }
  }

  _json(obj) {
    return new Response(JSON.stringify(obj), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

### 1.3 — src/index.js: export BrowserDO + add three MCP tools

**Step A: Export BrowserDO** — add to the export block at the bottom of src/index.js
(where GameDO, UserDO, BracketDO, AmbientDO are exported):

```javascript
export { BrowserDO } from './browser-do.js';
```

**Step B: Add MCP tools** — add after browser_quick in the tools list:

```javascript
{
  name: 'browser_navigate',
  description: 'Open a URL in a headless browser with session persistence. Returns screenshot, page title, visible text, and a sessionId to reuse in browser_interact and browser_extract calls. Sessions auto-close after 5 min idle or 50 actions.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full URL to navigate to (allowlisted domains only)' },
      sessionId: { type: 'string', description: 'Reuse an existing session. Omit to start a new session (a new sessionId is returned).' },
      waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle0'], description: 'When to consider navigation complete. Default: networkidle0' },
    },
    required: ['url'],
  },
},
{
  name: 'browser_interact',
  description: 'Perform an action on the current page in an active browser session: click, type, select, scroll, wait, back, or forward. Returns updated screenshot and page text.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID from browser_navigate' },
      action: { type: 'string', enum: ['click', 'type', 'select', 'scroll', 'wait', 'back', 'forward'] },
      selector: { type: 'string', description: 'CSS selector or :text("Button Label") for click/type/select/wait. Omit for back/forward.' },
      value: { type: 'string', description: 'Text to type, option value to select, or scroll direction (up/down)' },
      pressEnter: { type: 'boolean', description: 'Press Enter after typing. Default: false' },
    },
    required: ['sessionId', 'action'],
  },
},
{
  name: 'browser_extract',
  description: 'Extract structured data from the current page: cookies, form fields, JSON-LD, all links, raw JS evaluation, or full page text. Does not change page state.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID from browser_navigate' },
      mode: { type: 'string', enum: ['cookies', 'forms', 'json-ld', 'links', 'evaluate', 'full-text'] },
      expression: { type: 'string', description: 'JS expression for evaluate mode only (e.g. "document.title")' },
    },
    required: ['sessionId', 'mode'],
  },
},
{
  name: 'browser_close',
  description: 'Explicitly close a browser session and free its resources. Sessions also auto-close after 5 min idle.',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: 'Session ID from browser_navigate' },
    },
    required: ['sessionId'],
  },
},
```

**Step C: Add tool handlers** — in the tools/call switch, add after browser_quick:

```javascript
case 'browser_navigate':
case 'browser_interact':
case 'browser_extract':
case 'browser_close': {
  // Validate URL for navigate (only tool with a URL arg)
  if (toolName === 'browser_navigate') {
    const { url } = toolInput;
    if (!url) return mcpError('browser_navigate requires url');
    const { validateUrl } = await import('./browser-quick.js');
    const check = validateUrl(url);
    if (!check.ok) return mcpResult(JSON.stringify({ error: check.reason, allowed: false }));
  }

  // Route to BrowserDO
  const sessionId = toolInput.sessionId || crypto.randomUUID();
  const doId   = env.BROWSER_SESSION.idFromName(sessionId);
  const stub   = env.BROWSER_SESSION.get(doId);
  const result = await stub.fetch(new Request('https://do/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: toolName, args: { ...toolInput, sessionId } }),
  }));
  const json = await result.json();
  return mcpResult(JSON.stringify(json, null, 2));
}
```

(Replace mcpError / mcpResult with whatever helper the existing handlers use.
Look at the html_probe handler to confirm the exact pattern.)

---

## PHASE 2: Smoke Assertions

Add to the relay smoke test (if one exists in the relay repo) or note as manual-verify only.
Search for existing smoke patterns:

```bash
grep -rn 'browser_quick\|BROWSER_SESSION\|BrowserDO' src/ wrangler.toml
ls smoke*.js test*.js 2>/dev/null
```

If no relay smoke test file exists, skip and note in outbox.

---

## DEPLOY AND VERIFY ALL PHASES

```bash
npx wrangler deploy 2>&1 | tail -10
```

Run verification sequence:

```bash
# 1. browser_quick listed in MCP tools
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "import sys,json; tools=[t['name'] for t in json.load(sys.stdin)['result']['tools']]; print('browser tools:', [t for t in tools if 'browser' in t])"

# 2. URL allowlist works
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"browser_quick","arguments":{"url":"https://google.com","action":"markdown"}}}' \
  | grep -o 'not in allowlist\|allowed'

# 3. browser_quick renders example.com
curl -s https://field-relay-nba.jeffunglesbee.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browser_quick","arguments":{"url":"https://example.com","action":"markdown"}}}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); c=r.get('result',{}).get('content',[]); print('markdown len:', len(c[0]['text']) if c else 0)"

# 4. browser_navigate opens example.com with session
SESSION=$(curl -s https://field-relay-nba.jeffunglesbee.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"browser_navigate","arguments":{"url":"https://example.com"}}}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); content=r.get('result',{}).get('content',[{}])[0].get('text','{}'); d=json.loads(content); print(d.get('sessionId','NO_SESSION'))")
echo "Session: $SESSION"

# 5. Extract from session
if [ "$SESSION" != "NO_SESSION" ]; then
  curl -s https://field-relay-nba.jeffunglesbee.workers.dev/mcp \
    -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"browser_extract\",\"arguments\":{\"sessionId\":\"$SESSION\",\"mode\":\"links\"}}}" \
    | python3 -c "import sys,json; r=json.load(sys.stdin); c=r.get('result',{}).get('content',[{}])[0].get('text','{}'); d=json.loads(c); print('links:', len(d.get('data',[])), 'action_count:', d.get('actionCount'))"
fi
```

Write all results to outbox/cc-browser-mcp-2026-06-22.md.

---

## COMMIT

One commit, [skip ci]:

```bash
git config user.email "jeffunglesbee@gmail.com"
git config user.name "Jeff"
git remote set-url origin https://x-access-token:${FIELD_PAT}@github.com/jeffunglesbee-create/field-relay-nba.git

git add wrangler.toml src/browser-quick.js src/browser-do.js src/index.js
git commit -m "feat: Browser Rendering MCP — chat-controlled headless browser [skip ci]

Phase 0 (browser_quick): stateless Quick Actions — screenshot, json, markdown, links.
Phase 1 (browser_navigate/interact/extract/close): BrowserDO Durable Object
  for session persistence across MCP calls. Puppeteer-powered.

Architecture: Claude chat → MCP tool → relay → BrowserDO → CF Browser Rendering.
Works from iPad — no Claude in Chrome extension required.

Safety: URL allowlist (ATS sites + cloudflare + espn + FIELD), 50 actions/session,
30 min max lifetime, blocked sensitive domains, no persistent cookie/screenshot storage.

Spec: Drive 1Fite5hBaJviHxvqp33EwR-vqnOeHXYe9fli6C34_cuE"

git push
git log --oneline -1
```

---

## DONE CHECKLIST

Write to outbox/cc-browser-mcp-2026-06-22.md:

```
DONE:
[ ] wrangler.toml: compatibility_date bumped, browser binding, BROWSER_SESSION DO, v5 migration
[ ] src/browser-quick.js created (validateUrl + browserQuick)
[ ] src/browser-do.js created (BrowserDO class)
[ ] src/index.js: imports added, 5 MCP tools registered, handlers wired, BrowserDO exported
[ ] Deployed successfully
[ ] browser_quick rejects google.com with allowlist error
[ ] browser_quick renders example.com markdown (content len > 0)
[ ] browser_navigate opens example.com, returns sessionId
[ ] browser_extract links works on live session
[ ] Committed and pushed, HEAD: [SHA]

CARRY-FORWARDS (if any):
- List anything that didn't work and why
```
