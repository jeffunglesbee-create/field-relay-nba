/**
 * browser-quick.js — Phase 0 Browser MCP
 * Stateless Quick Actions via Cloudflare Browser Rendering Workers binding (v2).
 * No session state, no DO. One URL → one result.
 * Phase 1 (BrowserDO) adds session persistence for multi-step workflows.
 *
 * v2 binding: env.BROWSER.quickAction(action, { url }) returns a Response object.
 * Response body handling per action:
 *   screenshot → response.arrayBuffer() → base64
 *   markdown   → response.text()
 *   links      → response.json()
 *   json       → response.json()
 */

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
  /^https?:\/\/jubilant-bassoon\.jeffunglesbee\.workers\.dev/,
  /^https?:\/\/example\.com/,
];

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

export function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'Invalid URL format' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reason: 'Only http/https URLs allowed' };
  }
  const allowed = ALLOWED_DOMAINS.some(pattern => pattern.test(url));
  if (!allowed) {
    return { ok: false, reason: 'Domain not in allowlist. Allowed: ATS sites (iCIMS, Workday, Greenhouse, Lever, Taleo, SuccessFactors), cloudflare.com, espn.com, FIELD app.' };
  }
  const blocked = BLOCKED_PATTERNS.some(pattern => pattern.test(url));
  if (blocked) {
    return { ok: false, reason: 'URL matches blocked pattern' };
  }
  return { ok: true };
}

export async function browserQuick(env, url, action) {
  const validation = validateUrl(url);
  if (!validation.ok) {
    return { error: validation.reason, allowed: false };
  }
  const validActions = ['screenshot', 'json', 'markdown', 'links'];
  if (!validActions.includes(action)) {
    return { error: `Invalid action. Must be one of: ${validActions.join(', ')}` };
  }
  if (!env.BROWSER) {
    return { error: 'BROWSER binding not available on this worker' };
  }
  try {
    // v2 binding returns a Response object — must read body explicitly per action type
    const response = await env.BROWSER.quickAction(action, { url });

    if (!response || typeof response.arrayBuffer !== 'function') {
      // Unexpected return type — log what we got for debugging
      return { error: 'Unexpected response type from BROWSER binding', type: typeof response, action, url };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '(unreadable)');
      return { error: `BROWSER binding returned HTTP ${response.status}`, detail: errText, action, url };
    }

    if (action === 'screenshot') {
      const buf = await response.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      const base64 = btoa(s);
      return {
        action, url,
        screenshot: base64,
        mimeType: 'image/png',
        note: `Render complete. Base64 PNG returned (${bytes.length} bytes).`,
      };
    }

    if (action === 'json') {
      const data = await response.json().catch(async () => {
        const t = await response.text().catch(() => '');
        return { raw: t };
      });
      return { action, url, data };
    }

    // markdown, links — return as text, then parse links as JSON if possible
    const text = await response.text();
    if (action === 'links') {
      try {
        return { action, url, content: JSON.parse(text) };
      } catch {
        return { action, url, content: text };
      }
    }

    return { action, url, content: text };
  } catch (err) {
    return { error: err.message, stack: err.stack?.split('\n')[0], url, action };
  }
}
