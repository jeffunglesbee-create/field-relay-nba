// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-08-02-resolve-
// dayid-date-mode TASK 1: real, fresh confirmation of what the
// unparametrized bundesliga.com/en/bundesliga/matchday URL (no season or
// matchday suffix) currently returns for its default broadcasts request --
// earlier session evidence (different session, different date) said this
// defaults to whatever the site currently considers "current" (returned
// DFL-COM-000003, the Supercup, during preseason). Re-verified fresh here,
// not assumed carried over. Uses the same real methodology already proven
// in jubilant-bassoon's tests/bundesliga-matchday-url-decisive.spec.js
// (consent dismissal, response listener registered before goto()).

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

async function main() {
    const out = {
        timestamp: new Date().toISOString(),
        unparametrizedUrl: 'https://www.bundesliga.com/en/bundesliga/matchday',
        capturedComId: null,
        capturedDayId: null,
        capturedBroadcastsUrl: null,
        allCapturedUrls: [],
        error: null,
    };
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        const captured = [];
        page.on('response', (resp) => {
            const url = resp.url();
            if (!url.includes('wapp.bapi.bundesliga.com') || !url.includes('/broadcasts/')) return;
            captured.push(url);
            if (!out.capturedComId) {
                const cm = url.match(/DFL-COM-[A-Z0-9]+/);
                const dm = url.match(/DFL-DAY-[A-Z0-9]+/);
                if (cm) out.capturedComId = cm[0];
                if (dm) out.capturedDayId = dm[0];
                if (cm || dm) out.capturedBroadcastsUrl = url;
            }
        });

        await page.goto(out.unparametrizedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        // Real consent dismissal, same selectors proven live in
        // jubilant-bassoon's spec.
        const consentSelectors = [
            'button:has-text("Agree & continue")',
            'button:has-text("Deny & surf ad-free")',
            'button:has-text("Accept")',
        ];
        for (const sel of consentSelectors) {
            const btn = page.locator(sel).first();
            if (await btn.count().catch(() => 0) > 0) {
                await btn.click({ timeout: 3000 }).catch(() => {});
                break;
            }
        }
        await page.waitForTimeout(5000);

        out.allCapturedUrls = captured.slice(0, 10);
    } catch (e) {
        out.error = String(e).slice(0, 500);
    } finally {
        await browser.close().catch(() => {});
        console.log(JSON.stringify(out, null, 2));
        writeFileSync('outbox/probe-bundesliga-default-matchday-view-result.json', JSON.stringify(out, null, 2));
    }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
