/**
 * browser-quick.js — Phase 0 Browser MCP
 * Stateless Quick Actions via Cloudflare Browser Rendering REST API.
 * No session state, no DO. One URL → one result.
 * Phase 1 (BrowserDO) adds session persistence for multi-step workflows.
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
    const result = await env.BROWSER.quickAction({ action, url });

    if (action === 'screenshot') {
      const bytes = new Uint8Array(result);
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      const base64 = btoa(s);
      return {
        action, url,
        screenshot: base64,
        mimeType: 'image/png',
        note: 'Render complete. Base64 PNG returned.',
      };
    }
    if (action === 'json') {
      return { action, url, data: typeof result === 'string' ? JSON.parse(result) : result };
    }
    return { action, url, content: result };
  } catch (err) {
    return { error: err.message, url, action };
  }
}
