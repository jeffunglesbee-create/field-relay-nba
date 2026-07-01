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

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_SESSION_MS  = 30 * 60 * 1000;
const MAX_ACTIONS     = 50;

export class BrowserDO {
  constructor(state, env) {
    this.state = state;
    this.env   = env;
    this.browser     = null;
    this.page        = null;
    this.createdAt   = null;
    this.actionCount = 0;
  }

  async alarm() {
    await this._close();
  }

  async fetch(request) {
    const body = await request.json().catch(() => ({}));
    const { tool, args } = body;

    try {
      if (this.createdAt && Date.now() - this.createdAt > MAX_SESSION_MS) {
        await this._close();
        return this._json({ error: 'Session expired (30 min max lifetime). Call browser_navigate without sessionId to start a new session.' });
      }
      if (this.actionCount >= MAX_ACTIONS) {
        await this._close();
        return this._json({ error: `Session action cap reached (${MAX_ACTIONS} actions). Start a new session.` });
      }

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

  async _navigate(args) {
    await this._ensureBrowser();
    const { url, waitUntil = 'load', viewport } = args;

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
          if (selector && selector.startsWith(':text(')) {
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

  async _close() {
    try {
      if (this.browser) await this.browser.disconnect();
    } catch { /* ignore */ }
    this.browser = null;
    this.page    = null;
  }

  async _screenshot() {
    try {
      const buf = await this.page.screenshot({ type: 'png' });
      const bytes = new Uint8Array(buf);
      if (bytes.length > 400_000) {
        const jpegBuf = await this.page.screenshot({ type: 'jpeg', quality: 60 });
        const jb = new Uint8Array(jpegBuf);
        let s = ''; for (let i = 0; i < jb.length; i++) s += String.fromCharCode(jb[i]);
        return 'data:image/jpeg;base64,' + btoa(s);
      }
      let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return 'data:image/png;base64,' + btoa(s);
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
