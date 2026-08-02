// One-shot CI probe (workflow_dispatch only). CC-CMD-2026-08-02-resolve-
// dayid-date-mode: pre-build probe (Rule 68) before writing any date-mode
// resolution code. Real, open question: does a rendered matchday page
// show a real date range (e.g. "Aug 28 - Aug 30") anywhere in its visible
// text/DOM, which a date-mode resolver could use to verify a guessed
// matchday actually covers a requested date? Checked against a REAL past
// matchday from the completed 2025-26 season (current season hasn't
// started -- no assumption carried forward from memory).

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const SEASON = '2025-2026';
const MATCHDAY = 33; // real, late-season matchday, completed season

async function main() {
    const out = {
        timestamp: new Date().toISOString(),
        url: `https://www.bundesliga.com/en/bundesliga/matchday/${SEASON}/${MATCHDAY}`,
        bodyTextSample: null,
        dateLikeMatches: [],
        error: null,
    };
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await page.goto(out.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        const consentSelectors = [
            'button:has-text("Agree & continue")',
            'button:has-text("Deny & surf ad-free")',
            'button:has-text("Accept")',
        ];
        await page.waitForTimeout(2000);
        for (const sel of consentSelectors) {
            const btn = page.locator(sel).first();
            if (await btn.count().catch(() => 0) > 0) {
                await btn.click({ timeout: 3000 }).catch(() => {});
                break;
            }
        }
        await page.waitForTimeout(4000);

        const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
        out.bodyTextSample = bodyText.slice(0, 3000);
        // Real month-abbreviation date pattern, not assuming a specific format.
        const dateRegex = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/g;
        out.dateLikeMatches = [...new Set((bodyText.match(dateRegex) || []))].slice(0, 20);
    } catch (e) {
        out.error = String(e).slice(0, 500);
    } finally {
        await browser.close().catch(() => {});
        console.log(JSON.stringify(out, null, 2));
        writeFileSync('outbox/probe-bundesliga-matchday-date-text-result.json', JSON.stringify(out, null, 2));
    }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
