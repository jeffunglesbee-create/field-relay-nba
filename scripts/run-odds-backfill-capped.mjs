#!/usr/bin/env node
// A spend-capped run of GET /archive/odds-backfill?date=...&sport=... over a short list of dates.
//
// docs/CC-CMD-2026-11-22-epl-rows-left-unpriced-by-c-palace.md, Task 2. The route is gated (FIELD_MCP_SECRET), WRITES opening_odds
// where it is NULL, and every call is a billed historical vendor fetch: 30 credits per sport-date (3 markets at 10, one region;
// src/index.js fetchSportOddsHistorical). The owner approved the repair ("Backfill approved", 2026-11-22) and states a credit
// number; this runner will not spend past it.
//
// THE CAP IS IN THE CODE, not in the reader's care (the lessons of scripts/probe-identity-mismatches.mjs, which an independent
// review of 18 agents found each of, and of a second review of this file):
//   - APPROVED_CREDITS is required, and dates x 30 above it is refused BEFORE the first request;
//   - at most CALL_CAP dates PER RUN (the owner's number is per run too); a date named twice is refused; exactly one sport, written as the
//     archive writes a label. There is no lifetime cap per sport: a first version counted every committed result file against CALL_CAP, so
//     the nine EPL files of the first run refused every later EPL date, nothing spent (2026-11-23, run 45219835408). What bounds spend across
//     runs is the once-per-date ledger below and the number the owner states for each run;
//   - A PREFLIGHT, before the first billed call: an unknown ?sport= label must be answered 400. A relay that has not deployed
//     the filter ignores ?sport= and would fetch EVERY sport with rows on the date (30 credits each); it answers 200 to the
//     preflight instead and the run is refused. The preflight names a date with no rows, so it costs nothing on either relay;
//   - a date that already has a result file in the output directory is refused: a date is attempted ONCE, so a re-run, a second
//     dispatch or a queued one cannot spend it again (the calls already made are the files already committed, error answers too).
//     The file is written BEFORE the request and overwritten with the answer, so a runner that dies mid-call still leaves its mark.
//     To re-attempt a date whose file says no credit was spent (a guard refusal, an answer that never came), delete that one file
//     in a commit and state the approved number again;
//   - one attempt per date, no retry, a timeout on every request; the first failure ends the run;
//   - a 200 that is not a clean answer (ok false, another date or sport echoed, a `stopped` flag, a credit-guard refusal) is a
//     failure, not a result;
//   - a call that spent credits and WROTE NOTHING (games found, none populated) ends the run: a systematic cause would otherwise
//     be paid for on every remaining date;
//   - a redirect is not followed; a date must be a real calendar date;
//   - the secret is redacted from every file and log line, on every path, in its raw and JSON-escaped forms, and
//     over the whole record before it is written.
// Each answer is written verbatim and also printed to the run log, so a failed push or a lost runner does not lose a paid reading.
//
// Usage:  BACKFILL_DATES=2026-08-22,2026-08-28 BACKFILL_SPORT=EPL APPROVED_CREDITS=270 FIELD_MCP_SECRET=... node scripts/run-odds-backfill-capped.mjs
//         PREFLIGHT_ONLY=1 (with the same inputs) stops after the preflight: no billed request, no file; the free check of the deployed relay
//         node scripts/run-odds-backfill-capped.mjs --self-test      (a local stub server; no network, no secret)
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CALL_CAP = 9;
export const CREDITS_PER_CALL = 30;
export const REQUEST_TIMEOUT_MS = 120000;
export const PREFLIGHT_DATE = '2099-01-01';      // a date no row can carry: the preflight spends nothing on any relay
export const PREFLIGHT_LABEL = '__filter_preflight__';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const envText = (env, name) => (typeof env[name] === 'string' ? env[name].trim() : '');
/** The label as it appears in a result file's name: one ledger per sport whatever the case or spacing it was typed in. */
const fileSport = (sport) => sport.toLowerCase().replace(/ /g, '-');

/** Everything that can be refused WITHOUT spending anything. Returns { dates, sport, secret, approved } or { refused }. */
export function plan(env) {
    const secret = envText(env, 'FIELD_MCP_SECRET');
    if (secret === '') return { refused: 'FIELD_MCP_SECRET is not set: /archive/odds-backfill is gated and a run without it does nothing' };
    const sport = envText(env, 'BACKFILL_SPORT') === '' ? 'EPL' : envText(env, 'BACKFILL_SPORT');
    // ONE sport, and the label goes into a file name and a query string: letters, digits and spaces only, as the archive writes
    // them. A list ("EPL,MLS", whose credits would scale with the sports), a slash and dots all fail here.
    if (!/^[A-Za-z][A-Za-z0-9 ]{0,31}$/.test(sport)) return { refused: `${JSON.stringify(sport)} is not ONE sport label (letters, digits and spaces, as the archive writes it; credits scale with the number of sports)` };
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

/** The dates of this sport already attempted: the result files in the output directory, error answers and unfinished attempts included. */
export function attemptedDates(outDir, sport) {
    if (!existsSync(outDir)) return [];
    const prefix = `odds-backfill-${fileSport(sport)}-`;
    return readdirSync(outDir).filter(n => n.startsWith(prefix) && n.endsWith('.json'))
        .map(n => n.slice(prefix.length, prefix.length + 10));
}

/** Why an answer is not a clean result, or null. */
export function judge(j, date, sport) {
    if (j === null || typeof j !== 'object') return 'the body is not a JSON object';
    if (j.ok !== true) return `the relay answered 200 with ok ${JSON.stringify(j.ok)}${j.error === undefined ? '' : `: ${String(j.error)}`}${j.reason === undefined ? '' : ` (${String(j.reason)})`}`;
    if (j.date !== date) return `the answer did not echo the requested date (got ${JSON.stringify(j.date)}): not a relay answer`;
    if (j.sport !== sport) return `the answer covers ${JSON.stringify(j.sport)}, not ${JSON.stringify(sport)}: the filter was not applied`;
    if (typeof j.games_found !== 'number' || typeof j.odds_populated !== 'number') return 'the answer carries no games_found / odds_populated counts';
    if (j.stopped !== undefined) return `the route stopped itself (${String(j.reason)}) after a billed call`;
    if (typeof j.guarded === 'number' && j.guarded > 0) return `the relay's credit guard declined ${j.guarded} fetch(es): no vendor call was made and nothing was spent (a day, month or label cap is reached)`;
    if (j.games_found > 0 && j.odds_populated === 0) return `${j.games_found} game(s) found and 0 populated: credits were spent and nothing was written`;
    return null;
}

/** The request the run is about to make, as the preflight and the loop both build it. */
const request = (relay, date, sport, secret, timeoutMs) => ({
    url: `${relay}/archive/odds-backfill?date=${date}&sport=${encodeURIComponent(sport)}`,
    init: { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': UA, Authorization: `Bearer ${secret}` } },
});

/** Null when the relay refuses an unknown label (it honours ?sport=), else why the run must not start. */
async function preflight({ relay, secret, fetchImpl, redact, timeoutMs }) {
    const { url, init } = request(relay, PREFLIGHT_DATE, PREFLIGHT_LABEL, secret, timeoutMs);
    try {
        const r = await fetchImpl(url, init);
        const text = await r.text();
        if (r.status === 400 && /unknown \?sport=/.test(text)) return null;
        if (r.status === 200) return 'the relay answered 200 to an unknown ?sport= label: it does not honour ?sport= (its deploy has not landed), so a real call would fetch EVERY sport that has rows on its date at 30 credits each';
        return `the preflight answered HTTP ${r.status}: ${redact(text).slice(0, 160)}`;
    } catch (e) { return `the preflight got no answer: ${redact(e.message === undefined ? e : e.message)}`; }
}

/** The run. Sequential, one attempt per date, stops at the first failure. Returns { attempted, wrote, stoppedBecause, refused }. */
export async function run({ env, relay, outDir, log, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
    const p = plan(env);
    if (p.refused !== undefined) { log(`RUN REFUSED: ${p.refused}`); return { attempted: 0, wrote: [], stoppedBecause: p.refused, refused: true }; }
    const done = attemptedDates(outDir, p.sport);
    const repeats = p.dates.filter(d => done.includes(d));
    if (repeats.length > 0) {
        const why = `${repeats.join(', ')} already attempted for ${p.sport} (a result file is in ${outDir}): a date is attempted once`;
        log(`RUN REFUSED: ${why}`);
        return { attempted: 0, wrote: [], stoppedBecause: why, refused: true };
    }
    // Both forms the credential can take in what comes back: raw (a header, a plain body, an exception message) and escaped inside a
    // JSON string (a quote or a backslash in it is written \" or \\ there). Longest first.
    const forms = [...new Set([p.secret, JSON.stringify(p.secret).slice(1, -1)])].filter(f => f !== '').sort((a, b) => b.length - a.length);
    const redact = (text) => forms.reduce((acc, f) => acc.split(f).join('[redacted]'), String(text));
    const refusedByPreflight = await preflight({ relay, secret: p.secret, fetchImpl, redact, timeoutMs });
    if (refusedByPreflight !== null) {
        log(`RUN REFUSED (preflight, nothing spent): ${refusedByPreflight}`);
        return { attempted: 0, wrote: [], stoppedBecause: refusedByPreflight, refused: true };
    }
    if (envText(env, 'PREFLIGHT_ONLY') === '1') {
        // The free proof that the deployed relay honours ?sport=, run before the owner's number is spent: no billed request, no file.
        log(`PREFLIGHT OK, nothing spent: ${relay} answered 400 to an unknown ?sport= label, so it applies the filter. ${p.dates.length} date(s) planned, none requested.`);
        return { attempted: 0, wrote: [], stoppedBecause: null, refused: false, preflightOnly: true };
    }
    mkdirSync(outDir, { recursive: true });
    const wrote = [];
    let attempted = 0, found = 0, populated = 0, charged = 0, noAnswer = 0;
    let stoppedBecause = null;
    for (const date of p.dates) {
        attempted++;
        const { url, init } = request(relay, date, p.sport, p.secret, timeoutMs);
        const rec = { probed_at: new Date().toISOString(), date, sport: p.sport, url, http: null, result: null, error: null };
        const stamp = rec.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
        const file = join(outDir, `odds-backfill-${fileSport(p.sport)}-${date}-${stamp}.json`);
        // WRITE-AHEAD: the attempt is on disk before the request leaves, so a runner that dies in flight still counts this date.
        writeFileSync(file, JSON.stringify({ ...rec, pending: true }, null, 2) + '\n');
        try {
            const r = await fetchImpl(url, init);
            rec.http = r.status;
            const text = await r.text();
            if (r.status !== 200) rec.error = `HTTP ${r.status}: ${text.slice(0, 200)}`;
            else {
                let j = null;
                try { j = JSON.parse(text); } catch (_) { rec.error = `non-JSON body (${text.length} bytes): ${text.slice(0, 120)}`; }
                if (rec.error === null) {
                    rec.result = j;
                    const why = judge(j, date, p.sport);
                    if (why !== null) rec.error = why;
                    else { found += j.games_found; populated += j.odds_populated; }
                }
            }
        } catch (e) { rec.error = e.message === undefined ? String(e) : e.message; }
        if (rec.error !== null) rec.error = redact(rec.error);   // ONE place, so no path can reach a file or a log line unredacted
        // The estimate counts a call that reached the vendor: an answer with games found that the credit guard did not decline (the
        // route makes no vendor call for a date with none, or for a bucket the guard refused). An attempt that got no clean answer
        // at all may have been billed before the answer was lost, so it is counted apart, each up to the per-call cost.
        if (rec.result !== null && typeof rec.result.games_found === 'number' && rec.result.games_found > 0 && !(rec.result.guarded > 0)) charged += CREDITS_PER_CALL;
        if (rec.result === null) noAnswer++;
        const text = redact(JSON.stringify(rec, null, 2)) + '\n';
        writeFileSync(file, text);
        log(`--- ${file}\n${text}`);
        wrote.push(file);
        if (rec.error !== null) { stoppedBecause = `${date}: ${rec.error}`; break; }
    }
    // Rule 91: counts of what happened, not the length of the request list.
    log(`called ${attempted} of ${p.dates.length} requested date(s) for ${p.sport}; ${wrote.length} file(s) written; ${populated} of ${found} game(s) populated; ledger estimate ${charged} credits (${CREDITS_PER_CALL} per sport-date that found games; the provider's bill is unmeasured); ${noAnswer} call(s) with no clean answer, each possibly billed up to ${CREDITS_PER_CALL}; approved ${p.approved}`);
    if (stoppedBecause !== null) log(`STOPPED after the first failure, no retry: ${stoppedBecause}`);
    return { attempted, wrote, stoppedBecause, refused: false, populated, found, charged, noAnswer };
}

// ── self-test: a local stub server, no network, no real secret ───────────────────────────────────────────
async function selfTest() {
    let failed = 0, checked = 0;
    const check = (name, ok, detail = '') => { checked++; if (!ok) { failed++; console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ''}`); } else console.log(`PASS  ${name}`); };
    let SECRET = 'stub-secret-value';
    let hits = [];       // requests for real dates: the ones that would be billed
    let pre = [];        // requests for the preflight date
    let mode = 'ok';
    const server = createServer((req, res) => {
        const date = /date=([\d-]+)/.exec(req.url)?.[1];
        const sport = decodeURIComponent(/sport=([^&]*)/.exec(req.url)?.[1] ?? '');
        const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
        if (date === PREFLIGHT_DATE) {
            pre.push({ url: req.url, auth: req.headers.authorization });
            if (mode === 'old-relay') return send(200, { ok: true, date, games_found: 0, odds_populated: 0, odds_skipped: 0 });
            if (mode === 'pre-401') return send(401, 'Unauthorized');
            return send(400, { ok: false, error: `unknown ?sport=${JSON.stringify(sport)}: not an archive sport the relay has an Odds-API key for` });
        }
        hits.push({ url: req.url, auth: req.headers.authorization });
        if (mode === 'hang') { setTimeout(() => { try { send(500, 'late'); } catch (_) { /* the runner has gone */ } }, 2500); return; }   // answers only long after any timeout under test
        if (mode === 'fail-second' && hits.length === 2) return send(500, `boom, leaked ${SECRET}`);
        if (mode === 'unauthorized') return send(401, 'Unauthorized');
        if (mode === 'redirect') { res.writeHead(302, { location: '/elsewhere' }); return res.end(); }
        if (mode === 'html') return send(200, '<html>proxy</html>');
        if (mode === 'secret-html') return send(200, `<html>token ${SECRET} leaked</html>`);
        if (mode === 'ok-false') return send(200, { ok: false, error: 'ODDS_API_KEY not configured', date });
        if (mode === 'ok-false-leak') return send(200, { ok: false, error: `bad credential ${SECRET}`, date });
        if (mode === 'wrong-date') return send(200, { ok: true, date: '1999-01-01', sport, games_found: 1, odds_populated: 1 });
        if (mode === 'wrong-sport') return send(200, { ok: true, date, sport: 'MLB', games_found: 1, odds_populated: 1 });
        if (mode === 'no-counts') return send(200, { ok: true, date, sport });
        if (mode === 'stopped') return send(200, { ok: true, date, sport, games_found: 1, odds_populated: 0, odds_skipped: 1, stopped: true, reason: 'quota_low' });
        if (mode === 'zero-written') return send(200, { ok: true, date, sport, games_found: 1, odds_populated: 0, odds_skipped: 1, quota_remaining: 399000 });
        if (mode === 'guarded') return send(200, { ok: true, date, sport, games_found: 1, odds_populated: 0, odds_skipped: 1, guarded: 1, quota_remaining: null });
        if (mode === 'no-games') return send(200, { ok: true, date, sport, games_found: 0, odds_populated: 0, odds_skipped: 0 });
        if (mode === 'echo') return send(200, { ok: true, date, sport, games_found: 1, odds_populated: 1, note: `echoed ${SECRET}` });
        return send(200, { ok: true, date, sport, games_found: 1, odds_populated: 1, odds_skipped: 0, quota_remaining: 399970 });
    });
    await new Promise(r => server.listen(0, r));
    const relay = `http://127.0.0.1:${server.address().port}`;
    const dir = mkdtempSync(join(tmpdir(), 'run-backfill-'));
    const logs = [];
    const D3 = '2026-08-22,2026-08-28,2026-09-05';
    const NINE = '2026-08-22,2026-08-28,2026-09-05,2026-09-12,2026-09-20,2026-10-11,2026-10-18,2026-10-25,2026-08-21';
    const go = async (envOver, m = 'ok', { preFiles = [], fetchImpl, timeoutMs, secret = 'stub-secret-value', outDir } = {}) => {
        hits = []; pre = []; mode = m; logs.length = 0; SECRET = secret;
        const out = outDir ?? join(dir, `o${Math.random().toString(36).slice(2, 8)}`);
        if (preFiles.length > 0) { mkdirSync(out, { recursive: true }); for (const d of preFiles) writeFileSync(join(out, `odds-backfill-epl-${d}-20260101T000000Z.json`), '{}\n'); }
        const r = await run({ env: { FIELD_MCP_SECRET: secret, BACKFILL_DATES: D3, APPROVED_CREDITS: '90', ...envOver }, relay, outDir: out, log: (l) => logs.push(l),
            ...(fetchImpl === undefined ? {} : { fetchImpl }), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
        let files = []; try { files = readdirSync(out); } catch (_) { files = []; }
        return { r, files, out };
    };
    // A fetch that fails on a billed request but lets the preflight through to the stub, so the failure under test is the one reached.
    const afterPreflight = (inner) => (u, o) => (u.includes(`date=${PREFLIGHT_DATE}`) ? fetch(u, o) : inner(u, o));
    const denom = () => logs.find(l => l.startsWith('called ')) ?? '';
    const textOf = (x) => x.files.map(n => readFileSync(join(x.out, n), 'utf8')).join('\n') + logs.join('\n') + JSON.stringify(x.r);
    try {
        const a = await go({});
        check('S1 three dates make exactly three requests and write three files', hits.length === 3 && a.files.length === 3 && a.r.stoppedBecause === null, `${hits.length} requests, ${a.files.length} files`);
        check('S2 each request carries date, ONE sport and the bearer credential', hits.every(h => /sport=EPL$/.test(h.url) && h.auth === `Bearer ${SECRET}`), JSON.stringify(hits.map(h => h.url)));
        check('S3 the denominator line: called 3 of 3, 3 of 3 games populated, 90 credits, none unanswered, approved 90', /^called 3 of 3 requested date\(s\) for EPL; 3 file\(s\) written; 3 of 3 game\(s\) populated; ledger estimate 90 credits/.test(denom()) && /0 call\(s\) with no clean answer/.test(denom()) && /approved 90$/.test(denom()), denom());
        check('S4 each answer is also in the run log, verbatim', logs.filter(l => l.startsWith('--- ') && l.includes('"odds_populated": 1')).length === 3);
        const b = await go({ BACKFILL_DATES: `${D3},2026-09-12,2026-09-20,2026-10-11,2026-10-18,2026-10-25,2026-08-21,2026-11-01`, APPROVED_CREDITS: '9999' });
        check('S5 more than nine dates are refused before any request', b.r.refused === true && hits.length === 0 && pre.length === 0);
        const c = await go({ BACKFILL_DATES: '2026-08-22,2026-08-22' });
        check('S6 a date named twice is refused before any request', c.r.refused === true && hits.length === 0 && pre.length === 0);
        const d = await go({ BACKFILL_SPORT: 'EPL,MLS' });
        check('S7 two sports are refused before any request', d.r.refused === true && hits.length === 0 && pre.length === 0 && /not ONE sport label/.test(d.r.stoppedBecause));
        const e = await go({ FIELD_MCP_SECRET: '' });
        check('S8 no secret is refused before any request', e.r.refused === true && hits.length === 0 && pre.length === 0);
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
        const k = await go({}, 'ok', { preFiles: ['2026-08-28'] });
        check('S14 a date that already has a result file is refused before any request (a re-run cannot spend it twice)', k.r.refused === true && hits.length === 0 && /2026-08-28 already attempted/.test(k.r.stoppedBecause));
        const l = await go({ BACKFILL_DATES: '2026-09-12' }, 'ok', { preFiles: ['2026-08-22', '2026-08-28', '2026-09-05', '2026-09-20', '2026-10-11', '2026-10-18', '2026-10-25', '2026-08-21', '2026-11-01'] });
        check('S15 nine sport-dates already attempted and ONE NEW date asked: it goes (the cap is per run, not for all time): one request, one more file', l.r.refused === false && hits.length === 1 && l.files.length === 10, `${hits.length} requests, ${l.files.length} files, ${l.r.stoppedBecause}`);
        const l2 = await go({ BACKFILL_DATES: '2026-09-12' }, 'ok', { preFiles: ['2026-08-22'] });
        check('S16 one already attempted and a different date asked: one request', hits.length === 1 && l2.r.refused === false);
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
        const x = await go({}, 'ok', { fetchImpl: afterPreflight(async () => { throw new TypeError(`Headers: invalid value Bearer ${SECRET}`); }) });
        check('S30 a fetch that throws a message quoting the secret ends the run after ONE attempt and leaks nothing', x.r.attempted === 1 && x.r.stoppedBecause !== null && !textOf(x).includes(SECRET) && textOf(x).includes('[redacted]'));
        const y = await go({ BACKFILL_DATES: '2026-08-22' }, 'echo');
        check('S31 an answer that echoes the credential is written with it redacted (the last pass over the whole record)', y.files.length === 1 && !textOf(y).includes(SECRET) && textOf(y).includes('echoed [redacted]'));
        const z = await go({ BACKFILL_DATES: '2026-08-22' });
        const rec = JSON.parse(readFileSync(join(z.out, z.files[0]), 'utf8'));
        check('S32 the answer is written verbatim under result, with the date, sport and url, and no pending mark', rec.result.odds_populated === 1 && rec.date === '2026-08-22' && rec.sport === 'EPL' && /date=2026-08-22&sport=EPL$/.test(rec.url) && rec.pending === undefined);
        // The owner's run: exactly nine sport-dates at 270.
        const nine = await go({ BACKFILL_DATES: NINE, APPROVED_CREDITS: '270' });
        check('S33 the owner\'s run: nine dates at 270 credits are NOT refused (the cap is a ceiling, not off by one): nine requests, nine files', nine.r.refused === false && hits.length === 9 && nine.files.length === 9 && /ledger estimate 270 credits/.test(denom()) && /approved 270$/.test(denom()), `${hits.length} requests; ${nine.r.stoppedBecause}`);
        const nineLow = await go({ BACKFILL_DATES: NINE, APPROVED_CREDITS: '269' });
        check('S34 nine dates at 269 credits are refused before any request', nineLow.r.refused === true && hits.length === 0 && pre.length === 0);
        // The preflight: a relay without the filter would fetch every sport.
        const pf = await go({}, 'ok');
        check('S35 a normal run makes ONE preflight request, on a date with no rows, with an unknown label and the credential', pf.r.refused === false && pre.length === 1 && /date=2099-01-01&sport=__filter_preflight__$/.test(pre[0].url) && pre[0].auth === `Bearer ${SECRET}`, JSON.stringify(pre));
        const old = await go({}, 'old-relay');
        check('S36 a relay that ignores ?sport= (answers 200 to the unknown label) is refused with NO billed request and NO file written', old.r.refused === true && hits.length === 0 && old.files.length === 0 && /does not honour \?sport=/.test(old.r.stoppedBecause), `${hits.length} requests, ${old.files.length} files`);
        const p401 = await go({}, 'pre-401');
        check('S37 a preflight that is refused (401) stops the run with no billed request', p401.r.refused === true && hits.length === 0 && /HTTP 401/.test(p401.r.stoppedBecause));
        // A credit-guard refusal spent nothing and must not read as spent.
        const gd = await go({}, 'guarded');
        check('S38 a credit-guard refusal is reported as a refusal that spent nothing: one request, 0 credits estimated', hits.length === 1 && /credit guard declined 1/.test(gd.r.stoppedBecause) && /nothing was spent/.test(gd.r.stoppedBecause) && /ledger estimate 0 credits/.test(denom()), denom());
        // An answer with no counts is not a result.
        const nc = await go({}, 'no-counts');
        check('S39 an answer without games_found / odds_populated stops the run after ONE request', hits.length === 1 && /no games_found/.test(nc.r.stoppedBecause));
        // Redaction in every form, on the judge path too.
        const lk = await go({}, 'ok-false-leak');
        check('S40 an ok:false answer that quotes the secret leaves it in no file, no log line and not in the returned reason', !textOf(lk).includes(SECRET) && textOf(lk).includes('[redacted]') && hits.length === 1);
        const odd = 'abc"def\\ghi';
        const jl = await go({ BACKFILL_DATES: '2026-08-22' }, 'echo', { secret: odd });
        check('S41 a secret containing a quote and a backslash is redacted in its JSON-escaped form too', jl.files.length === 1 && !textOf(jl).includes(odd) && !textOf(jl).includes(JSON.stringify(odd).slice(1, -1)) && textOf(jl).includes('echoed [redacted]'));
        // The label goes into a file name and a query: a traversal never reaches either.
        const tv = await go({ BACKFILL_SPORT: 'x/../../y' });
        check('S42 a sport label with a slash or dots is refused before any request', tv.r.refused === true && hits.length === 0 && pre.length === 0 && /not ONE sport label/.test(tv.r.stoppedBecause));
        // The ledger is one per sport whatever case it was typed in.
        const lc = await go({ BACKFILL_SPORT: 'Epl' }, 'ok', { preFiles: ['2026-08-22'] });
        check('S43 "Epl", "epl" and "EPL" share one once-per-date ledger: a file written for epl refuses the date typed as Epl', lc.r.refused === true && hits.length === 0 && /2026-08-22 already attempted/.test(lc.r.stoppedBecause));
        const sp = await go({ BACKFILL_SPORT: 'La Liga', BACKFILL_DATES: '2026-08-22' }, 'ok', {});
        check('S44 a label with a space is sent encoded and is echoed back as itself', hits.length === 1 && /sport=La%20Liga$/.test(hits[0].url) && sp.r.stoppedBecause === null && sp.files[0].startsWith('odds-backfill-la-liga-2026-08-22-'), `${hits[0]?.url} ${sp.files}`);
        // Write-ahead and the timeout.
        const wa = join(dir, 'write-ahead'); mkdirSync(wa, { recursive: true });
        let seenInFlight = [];
        await go({ BACKFILL_DATES: '2026-08-22' }, 'ok', { outDir: wa, fetchImpl: afterPreflight(async () => { seenInFlight = readdirSync(wa).map(n => JSON.parse(readFileSync(join(wa, n), 'utf8'))); throw new Error('lost'); }) });
        check('S45 the attempt is on disk BEFORE the request is answered (a runner that dies in flight still counts the date)', seenInFlight.length === 1 && seenInFlight[0].pending === true && seenInFlight[0].date === '2026-08-22', JSON.stringify(seenInFlight));
        const hg = await go({ BACKFILL_DATES: '2026-08-22,2026-08-28' }, 'hang', { timeoutMs: 400 });
        check('S46 a request that never answers times out: ONE attempt, a stop naming it, the file written, counted as no clean answer', hits.length === 1 && hg.r.attempted === 1 && /timeout|aborted/i.test(hg.r.stoppedBecause) && hg.files.length === 1 && /1 call\(s\) with no clean answer/.test(denom()), `${hg.r.stoppedBecause}`);
        const again = await go({ BACKFILL_DATES: '2026-08-22' }, 'ok', { outDir: hg.out });
        check('S47 the date whose answer never came is NOT attempted again by the next run', again.r.refused === true && hits.length === 0 && /already attempted/.test(again.r.stoppedBecause));
        // The free check of the deployed relay.
        const po = await go({ PREFLIGHT_ONLY: '1' });
        check('S49 PREFLIGHT_ONLY makes the preflight request and NOTHING else: no billed request, no file, a line saying nothing was spent', po.r.preflightOnly === true && pre.length === 1 && hits.length === 0 && po.files.length === 0 && logs.some(l => /^PREFLIGHT OK, nothing spent/.test(l)));
        const poOld = await go({ PREFLIGHT_ONLY: '1' }, 'old-relay');
        check('S50 PREFLIGHT_ONLY against a relay that ignores ?sport= is refused, so the free check can fail', poOld.r.refused === true && poOld.r.preflightOnly === undefined && hits.length === 0);
    } finally { server.closeAllConnections?.(); server.close(); rmSync(dir, { recursive: true, force: true }); }
    console.log(`\n${checked - failed}/${checked} checks passed`);
    return failed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    if (process.argv.includes('--self-test')) process.exit((await selfTest()) === 0 ? 0 : 1);
    const relay = (process.env.RELAY_URL === undefined ? 'https://field-relay-nba.jeffunglesbee.workers.dev' : process.env.RELAY_URL).replace(/\/$/, '');
    const r = await run({ env: process.env, relay, outDir: process.env.OUT_DIR === undefined ? 'outbox' : process.env.OUT_DIR, log: (l) => console.log(l) });
    process.exit(r.refused || r.stoppedBecause !== null ? 1 : 0);
}
