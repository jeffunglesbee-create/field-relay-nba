#!/usr/bin/env node
// A spend-capped run of GET /archive/odds-backfill?date=...&sport=... over a short list of dates.
//
// docs/CC-CMD-2026-11-22-epl-rows-left-unpriced-by-c-palace.md, Task 2. The route is gated (FIELD_MCP_SECRET), WRITES opening_odds
// where it is NULL, and every call is a billed historical vendor fetch: 30 credits per sport-date (3 markets at 10, one region;
// src/index.js fetchSportOddsHistorical). The owner approved the repair ("Backfill approved", 2026-11-22) and states a credit
// number; this runner will not spend past it.
//
// THE CAP IS IN THE CODE, not in the reader's care (the lessons of scripts/probe-identity-mismatches.mjs, which an independent
// review of 18 agents found each of):
//   - APPROVED_CREDITS is required, and dates x 30 above it is refused BEFORE the first request;
//   - at most CALL_CAP dates; a date named twice is refused; exactly one sport;
//   - a date that already has a result file in the output directory is refused: a date is attempted ONCE, so a re-run, a second
//     dispatch or a queued one cannot spend it again (the calls already made are the files already committed, error answers too);
//   - one attempt per date, no retry; the first failure ends the run;
//   - a 200 that is not a clean answer (ok false, another date or sport echoed, a `stopped` flag) is a failure, not a result;
//   - a call that spent credits and WROTE NOTHING (games found, none populated) ends the run: a systematic cause would otherwise
//     be paid for on every remaining date;
//   - a redirect is not followed; a date must be a real calendar date;
//   - the secret is redacted from every file and log line, on every path and over the whole record.
// Each answer is written verbatim and also printed to the run log, so a failed push or a lost runner does not lose a paid reading.
//
// Usage:  BACKFILL_DATES=2026-08-22,2026-08-28 BACKFILL_SPORT=EPL APPROVED_CREDITS=270 FIELD_MCP_SECRET=... node scripts/run-odds-backfill-capped.mjs
//         node scripts/run-odds-backfill-capped.mjs --self-test      (a local stub server; no network, no secret)
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CALL_CAP = 9;
export const CREDITS_PER_CALL = 30;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const envText = (env, name) => (typeof env[name] === 'string' ? env[name].trim() : '');

/** Everything that can be refused WITHOUT spending anything. Returns { dates, sport, secret, approved } or { refused }. */
export function plan(env) {
    const secret = envText(env, 'FIELD_MCP_SECRET');
    if (secret === '') return { refused: 'FIELD_MCP_SECRET is not set: /archive/odds-backfill is gated and a run without it does nothing' };
    const sport = envText(env, 'BACKFILL_SPORT') === '' ? 'EPL' : envText(env, 'BACKFILL_SPORT');
    if (sport.includes(',')) return { refused: `one sport per run, got ${JSON.stringify(sport)}: credits scale with the number of sports` };
    const approvedText = envText(env, 'APPROVED_CREDITS');
    if (!/^[1-9]\d*$/.test(approvedText)) return { refused: `APPROVED_CREDITS must be the positive whole number of credits the owner approved, got ${JSON.stringify(approvedText)}` };
    const approved = Number(approvedText);
    const dates = envText(env, 'BACKFILL_DATES').split(',').map(d => d.trim()).filter(d => d !== '');
    if (dates.length === 0) return { refused: 'BACKFILL_DATES is empty and has no default' };
    for (const d of dates) {
        // Round-trips through the calendar, so it rejects a wrong shape (2026-11-2), a month 13 and a 30 February alike.
        const t = new Date(`${d}T00:00:00Z`);
        if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) return { refused: `${JSON.stringify(d)} is not a calendar date written YYYY-MM-DD` };
    }
    if (new Set(dates).size !== dates.length) return { refused: `a date is named twice (${dates.join(', ')}): the second call would be a second charge` };
    if (dates.length > CALL_CAP) return { refused: `${dates.length} dates is more than the cap of ${CALL_CAP} sport-dates` };
    const cost = dates.length * CREDITS_PER_CALL;
    if (cost > approved) return { refused: `${dates.length} sport-date(s) cost ${cost} credits at ${CREDITS_PER_CALL} each and ${approved} were approved` };
    return { dates, sport, secret, approved };
}

/** The dates of this sport already attempted: the result files in the output directory, error answers included. */
export function attemptedDates(outDir, sport) {
    if (!existsSync(outDir)) return [];
    const prefix = `odds-backfill-${sport}-`;
    return readdirSync(outDir).filter(n => n.startsWith(prefix) && n.endsWith('.json')).map(n => n.slice(prefix.length, prefix.length + 10));
}

/** Why an answer is not a clean result, or null. */
export function judge(j, date, sport) {
    if (j === null || typeof j !== 'object') return 'the body is not a JSON object';
    if (j.ok !== true) return `the relay answered 200 with ok ${JSON.stringify(j.ok)}${j.error === undefined ? '' : `: ${String(j.error)}`}${j.reason === undefined ? '' : ` (${String(j.reason)})`}`;
    if (j.date !== date) return `the answer did not echo the requested date (got ${JSON.stringify(j.date)}): not a relay answer`;
    if (j.sport !== sport) return `the answer covers ${JSON.stringify(j.sport)}, not ${JSON.stringify(sport)}: the filter was not applied`;
    if (typeof j.games_found !== 'number' || typeof j.odds_populated !== 'number') return 'the answer carries no games_found / odds_populated counts';
    if (j.stopped !== undefined) return `the route stopped itself (${String(j.reason)}) after a billed call`;
    if (j.games_found > 0 && j.odds_populated === 0) return `${j.games_found} game(s) found and 0 populated: credits were spent and nothing was written`;
    return null;
}

/** The run. Sequential, one attempt per date, stops at the first failure. Returns { attempted, wrote, stoppedBecause, refused }. */
export async function run({ env, relay, outDir, log, fetchImpl = fetch }) {
    const p = plan(env);
    if (p.refused !== undefined) { log(`RUN REFUSED: ${p.refused}`); return { attempted: 0, wrote: [], stoppedBecause: p.refused, refused: true }; }
    const done = attemptedDates(outDir, p.sport);
    const repeats = p.dates.filter(d => done.includes(d));
    if (repeats.length > 0) {
        const why = `${repeats.join(', ')} already attempted for ${p.sport} (a result file is in ${outDir}): a date is attempted once`;
        log(`RUN REFUSED: ${why}`);
        return { attempted: 0, wrote: [], stoppedBecause: why, refused: true };
    }
    if (done.length + p.dates.length > CALL_CAP) {
        const why = `${done.length} sport-date(s) already attempted and ${p.dates.length} asked for: more than the cap of ${CALL_CAP}`;
        log(`RUN REFUSED: ${why}`);
        return { attempted: 0, wrote: [], stoppedBecause: why, refused: true };
    }
    const redact = (text) => String(text).split(p.secret).join('[redacted]');
    mkdirSync(outDir, { recursive: true });
    const wrote = [];
    let attempted = 0, found = 0, populated = 0, charged = 0;
    let stoppedBecause = null;
    for (const date of p.dates) {
        attempted++;
        const url = `${relay}/archive/odds-backfill?date=${date}&sport=${encodeURIComponent(p.sport)}`;
        const rec = { probed_at: new Date().toISOString(), date, sport: p.sport, url, http: null, result: null, error: null };
        try {
            const r = await fetchImpl(url, { redirect: 'manual', headers: { 'User-Agent': UA, Authorization: `Bearer ${p.secret}` } });
            rec.http = r.status;
            const text = await r.text();
            if (r.status !== 200) rec.error = `HTTP ${r.status}: ${redact(text).slice(0, 200)}`;
            else {
                let j = null;
                try { j = JSON.parse(text); } catch (_) { rec.error = `non-JSON body (${text.length} bytes): ${redact(text).slice(0, 120)}`; }
                if (rec.error === null) {
                    rec.result = j;
                    const why = judge(j, date, p.sport);
                    if (why !== null) rec.error = why;
                    else { found += j.games_found; populated += j.odds_populated; }
                }
            }
        } catch (e) { rec.error = redact(e.message === undefined ? e : e.message); }
        // A call that reached the vendor is charged whether or not it is a clean answer, so the estimate counts every attempt
        // that returned a result with games found (the route makes no vendor call for a date with none).
        if (rec.result !== null && typeof rec.result.games_found === 'number' && rec.result.games_found > 0) charged += CREDITS_PER_CALL;
        const stamp = rec.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
        const file = join(outDir, `odds-backfill-${p.sport}-${date}-${stamp}.json`);
        const text = redact(JSON.stringify(rec, null, 2)) + '\n';
        writeFileSync(file, text);
        log(`--- ${file}\n${text}`);
        wrote.push(file);
        if (rec.error !== null) { stoppedBecause = `${date}: ${rec.error}`; break; }
    }
    // Rule 91: counts of what happened, not the length of the request list.
    log(`called ${attempted} of ${p.dates.length} requested date(s) for ${p.sport}; ${wrote.length} file(s) written; ${populated} of ${found} game(s) populated; ledger estimate ${charged} credits (${CREDITS_PER_CALL} per sport-date that found games; the provider's bill is unmeasured); approved ${p.approved}`);
    if (stoppedBecause !== null) log(`STOPPED after the first failure, no retry: ${stoppedBecause}`);
    return { attempted, wrote, stoppedBecause, refused: false, populated, found, charged };
}

// ── self-test: a local stub server, no network, no real secret ───────────────────────────────────────────
async function selfTest() {
    let failed = 0, checked = 0;
    const check = (name, ok, detail = '') => { checked++; if (!ok) { failed++; console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ''}`); } else console.log(`PASS  ${name}`); };
    const SECRET = 'stub-secret-value';
    let hits = [];
    let mode = 'ok';
    const server = createServer((req, res) => {
        hits.push({ url: req.url, auth: req.headers.authorization });
        const date = /date=([\d-]+)/.exec(req.url)?.[1];
        const sport = /sport=([A-Za-z%20]+)/.exec(req.url)?.[1];
        const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
        if (mode === 'fail-second' && hits.length === 2) return send(500, `boom, leaked ${SECRET}`);
        if (mode === 'unauthorized') return send(401, 'Unauthorized');
        if (mode === 'redirect') { res.writeHead(302, { location: '/elsewhere' }); return res.end(); }
        if (mode === 'html') return send(200, '<html>proxy</html>');
        if (mode === 'secret-html') return send(200, `<html>token ${SECRET} leaked</html>`);
        if (mode === 'ok-false') return send(200, { ok: false, error: 'ODDS_API_KEY not configured', date });
        if (mode === 'wrong-date') return send(200, { ok: true, date: '1999-01-01', sport, games_found: 1, odds_populated: 1 });
        if (mode === 'wrong-sport') return send(200, { ok: true, date, sport: 'MLB', games_found: 1, odds_populated: 1 });
        if (mode === 'stopped') return send(200, { ok: true, date, sport, games_found: 1, odds_populated: 0, odds_skipped: 1, stopped: true, reason: 'quota_low' });
        if (mode === 'zero-written') return send(200, { ok: true, date, sport, games_found: 1, odds_populated: 0, odds_skipped: 1, quota_remaining: 399000 });
        if (mode === 'no-games') return send(200, { ok: true, date, sport, games_found: 0, odds_populated: 0, odds_skipped: 0 });
        if (mode === 'echo') return send(200, { ok: true, date, sport, games_found: 1, odds_populated: 1, note: `echoed ${SECRET}` });
        return send(200, { ok: true, date, sport, games_found: 1, odds_populated: 1, odds_skipped: 0, quota_remaining: 399970 });
    });
    await new Promise(r => server.listen(0, r));
    const relay = `http://127.0.0.1:${server.address().port}`;
    const dir = mkdtempSync(join(tmpdir(), 'run-backfill-'));
    const logs = [];
    const D3 = '2026-08-22,2026-08-28,2026-09-05';
    const go = async (envOver, m = 'ok', { pre = [], fetchImpl } = {}) => {
        hits = []; mode = m; logs.length = 0;
        const out = join(dir, `o${Math.random().toString(36).slice(2, 8)}`);
        if (pre.length > 0) { mkdirSync(out, { recursive: true }); for (const d of pre) writeFileSync(join(out, `odds-backfill-EPL-${d}-20260101T000000Z.json`), '{}\n'); }
        const r = await run({ env: { FIELD_MCP_SECRET: SECRET, BACKFILL_DATES: D3, APPROVED_CREDITS: '90', ...envOver }, relay, outDir: out, log: (l) => logs.push(l), ...(fetchImpl === undefined ? {} : { fetchImpl }) });
        let files = []; try { files = readdirSync(out); } catch (_) { files = []; }
        return { r, files, out };
    };
    const denom = () => logs.find(l => l.startsWith('called ')) ?? '';
    const textOf = (x) => x.files.map(n => readFileSync(join(x.out, n), 'utf8')).join('\n') + logs.join('\n');
    try {
        const a = await go({});
        check('S1 three dates make exactly three requests and write three files', hits.length === 3 && a.files.length === 3 && a.r.stoppedBecause === null, `${hits.length} requests, ${a.files.length} files`);
        check('S2 each request carries date, ONE sport and the bearer credential', hits.every(h => /sport=EPL$/.test(h.url) && h.auth === `Bearer ${SECRET}`), JSON.stringify(hits.map(h => h.url)));
        check('S3 the denominator line: called 3 of 3, 3 of 3 games populated, 90 credits, approved 90', /^called 3 of 3 requested date\(s\) for EPL; 3 file\(s\) written; 3 of 3 game\(s\) populated; ledger estimate 90 credits/.test(denom()) && /approved 90$/.test(denom()), denom());
        check('S4 each answer is also in the run log, verbatim', logs.filter(l => l.startsWith('--- ') && l.includes('"odds_populated": 1')).length === 3);
        const b = await go({ BACKFILL_DATES: `${D3},2026-09-12,2026-09-20,2026-10-11,2026-10-18,2026-10-25,2026-08-21,2026-11-01`, APPROVED_CREDITS: '9999' });
        check('S5 more than nine dates are refused before any request', b.r.refused === true && hits.length === 0);
        const c = await go({ BACKFILL_DATES: '2026-08-22,2026-08-22' });
        check('S6 a date named twice is refused before any request', c.r.refused === true && hits.length === 0);
        const d = await go({ BACKFILL_SPORT: 'EPL,MLS' });
        check('S7 two sports are refused before any request', d.r.refused === true && hits.length === 0);
        const e = await go({ FIELD_MCP_SECRET: '' });
        check('S8 no secret is refused before any request', e.r.refused === true && hits.length === 0);
        const f = await go({ BACKFILL_DATES: '2026-08-22,2026-02-30' });
        check('S9 a date not on the calendar is refused before any request', f.r.refused === true && hits.length === 0 && /not a calendar date/.test(f.r.stoppedBecause));
        const g = await go({ BACKFILL_DATES: '2026-13-45' });
        check('S10 an impossible date (month 13) is refused and does not crash the plan', g.r.refused === true && hits.length === 0);
        // The approval: the credits the owner stated.
        const h = await go({ APPROVED_CREDITS: '89' });
        check('S11 three sport-dates cost 90 and 89 were approved: refused before any request', h.r.refused === true && hits.length === 0 && /cost 90 credits/.test(h.r.stoppedBecause));
        const i = await go({ APPROVED_CREDITS: '' });
        check('S12 no approved number is refused before any request', i.r.refused === true && hits.length === 0);
        const j = await go({ APPROVED_CREDITS: '90.5' });
        check('S13 a fractional or non-number approval is refused', j.r.refused === true && hits.length === 0 && (await go({ APPROVED_CREDITS: 'lots' })).r.refused === true);
        // A date is attempted once.
        const k = await go({}, 'ok', { pre: ['2026-08-28'] });
        check('S14 a date that already has a result file is refused before any request (a re-run cannot spend it twice)', k.r.refused === true && hits.length === 0 && /2026-08-28 already attempted/.test(k.r.stoppedBecause));
        const l = await go({ BACKFILL_DATES: '2026-09-12' }, 'ok', { pre: ['2026-08-22', '2026-08-28', '2026-09-05', '2026-09-20', '2026-10-11', '2026-10-18', '2026-10-25', '2026-08-21', '2026-11-01'] });
        check('S15 nine sport-dates already attempted and one more asked: refused by the cap', l.r.refused === true && hits.length === 0);
        const l2 = await go({ BACKFILL_DATES: '2026-09-12' }, 'ok', { pre: ['2026-08-22'] });
        check('S16 one already attempted and a different date asked is within the cap: one request', hits.length === 1 && l2.r.refused === false);
        // Failures end the run.
        const m = await go({}, 'fail-second');
        check('S17 the first failure ends the run: two requests, not three', hits.length === 2 && m.r.attempted === 2 && m.r.stoppedBecause !== null, `${hits.length} requests`);
        check('S18 the denominator says it stopped: called 2 of 3, and a STOPPED line follows', /^called 2 of 3 requested date\(s\) for EPL; 2 file\(s\) written/.test(denom()) && logs.some(l2x => /^STOPPED after the first failure, no retry/.test(l2x)), denom());
        check('S19 the secret is in no file and no log line, even when the relay echoes it in an error', !textOf(m).includes(SECRET) && textOf(m).includes('[redacted]'));
        const n = await go({}, 'unauthorized');
        check('S20 a 401 ends the run after ONE request', hits.length === 1 && /HTTP 401/.test(n.r.stoppedBecause));
        const o = await go({}, 'redirect');
        check('S21 a redirect is not followed: one request, a stop naming the status', hits.length === 1 && /HTTP 302/.test(o.r.stoppedBecause), `${hits.length} requests`);
        const p2 = await go({}, 'html');
        check('S22 a 200 that is not JSON is not a result: one request, then stop', hits.length === 1 && /non-JSON/.test(p2.r.stoppedBecause));
        const q = await go({}, 'ok-false');
        check('S23 a 200 with ok false is a failure: one request, a stop, the answer still written', hits.length === 1 && q.files.length === 1 && /ok false/.test(q.r.stoppedBecause));
        const r2 = await go({}, 'wrong-date');
        check('S24 an answer that does not echo the date is not a relay answer', hits.length === 1 && /did not echo/.test(r2.r.stoppedBecause));
        const s2 = await go({}, 'wrong-sport');
        check('S25 an answer for another sport means the filter was not applied: one request, a stop', hits.length === 1 && /filter was not applied/.test(s2.r.stoppedBecause));
        const t = await go({}, 'stopped');
        check('S26 a route that stopped itself (quota) is a failure, not a result', hits.length === 1 && /stopped itself/.test(t.r.stoppedBecause));
        const u = await go({}, 'zero-written');
        check('S27 games found and none populated ends the run after ONE call: a systematic cause is not paid for on every date', hits.length === 1 && /0 populated/.test(u.r.stoppedBecause) && /ledger estimate 30 credits/.test(denom()), denom());
        const v = await go({}, 'no-games');
        check('S28 a date with no games found is not a failure and is not charged: three requests, 0 credits', hits.length === 3 && v.r.stoppedBecause === null && /ledger estimate 0 credits/.test(denom()), denom());
        const w = await go({}, 'secret-html');
        check('S29 a non-JSON body that quotes the secret leaves it in no file and no log line', !textOf(w).includes(SECRET) && textOf(w).includes('[redacted]') && hits.length === 1);
        const x = await go({}, 'ok', { fetchImpl: async () => { throw new TypeError(`Headers: invalid value Bearer ${SECRET}`); } });
        check('S30 a fetch that throws a message quoting the secret ends the run after ONE attempt and leaks nothing', x.r.attempted === 1 && x.r.stoppedBecause !== null && !textOf(x).includes(SECRET) && textOf(x).includes('[redacted]'));
        const y = await go({ BACKFILL_DATES: '2026-08-22' }, 'echo');
        check('S31 an answer that echoes the credential is written with it redacted (the last pass over the whole record)', y.files.length === 1 && !textOf(y).includes(SECRET) && textOf(y).includes('echoed [redacted]'));
        const z = await go({ BACKFILL_DATES: '2026-08-22' });
        const rec = JSON.parse(readFileSync(join(z.out, z.files[0]), 'utf8'));
        check('S32 the answer is written verbatim under result, with the date, sport and url', rec.result.odds_populated === 1 && rec.date === '2026-08-22' && rec.sport === 'EPL' && /date=2026-08-22&sport=EPL$/.test(rec.url));
        check('S33 the cap is nine sport-dates at 30 credits', CALL_CAP === 9 && CREDITS_PER_CALL === 30);
    } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
    console.log(`\n${checked - failed}/${checked} checks passed`);
    return failed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    if (process.argv.includes('--self-test')) process.exit((await selfTest()) === 0 ? 0 : 1);
    const relay = (process.env.RELAY_URL === undefined ? 'https://field-relay-nba.jeffunglesbee.workers.dev' : process.env.RELAY_URL).replace(/\/$/, '');
    const r = await run({ env: process.env, relay, outDir: process.env.OUT_DIR === undefined ? 'outbox' : process.env.OUT_DIR, log: (l) => console.log(l) });
    process.exit(r.refused || r.stoppedBecause !== null ? 1 : 0);
}
