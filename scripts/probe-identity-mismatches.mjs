#!/usr/bin/env node
// A spend-capped reading of GET /identity/mismatches for ONE sport on a short list of dates.
//
// docs/CC-CMD-2026-09-11-epl-identity-resolve.md, Task 0 / Done condition 1: "re-run /identity/mismatches for at least three
// EPL matchdays and record real payloads". The route is gated (FIELD_MCP_SECRET) and every call is a billed vendor fetch
// (the ledger estimate, oddsCreditCost, is 3 credits per sport per call; the provider's real bill is unmeasured). The owner
// approved 9 credits for this reading on 2026-11-22, which is three calls. scripts/probe-odds-join.mjs cannot be used: its
// sport list is fixed (no EPL), it probes four sports at once (12 credits) and its workflow refuses a day that is not a Saturday.
//
// THE SPEND CAP IS IN THE CODE, not in the reader's care:
//   - at most CALL_CAP dates, refused BEFORE the first request, and a date named twice is refused (it would be a second call);
//   - exactly one sport, because credits scale with sports per call;
//   - one attempt per date: no retry, ever, and the first failure ends the run, so a bad secret or a vendor fault cannot
//     become a loop of billed calls;
//   - a body that does not echo the requested date is not a relay answer and ends the run.
// Each payload is written verbatim, as the relay returned it, so the reading is reproducible from the committed file.
//
// Usage:  PROBE_DATES=2026-10-25,2026-11-21,2026-10-31 FIELD_MCP_SECRET=... node scripts/probe-identity-mismatches.mjs
//         node scripts/probe-identity-mismatches.mjs --self-test      (a local stub server; no network, no secret)
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CALL_CAP = 3;
const CREDITS_PER_CALL = 3;   // the relay's ledger estimate, per sport per call
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// An unset variable reads as the empty string, said once here (a collapse written inline is what the absence-collapse
// ratchet counts); every caller treats the empty string as "not given" and refuses.
const envText = (env, name) => (typeof env[name] === 'string' ? env[name].trim() : '');

/** Everything that can be refused WITHOUT spending anything. Returns { dates, sport, secret } or { refused }. */
export function plan(env) {
    const secret = envText(env, 'FIELD_MCP_SECRET');
    if (secret === '') return { refused: 'FIELD_MCP_SECRET is not set: /identity/mismatches is gated and a probe without it measures nothing' };
    const sport = envText(env, 'PROBE_SPORT') === '' ? 'EPL' : envText(env, 'PROBE_SPORT');
    if (sport.includes(',')) return { refused: `one sport per run, got ${JSON.stringify(sport)}: credits scale with the number of sports` };
    const dates = envText(env, 'PROBE_DATES').split(',').map(d => d.trim()).filter(d => d !== '');
    if (dates.length === 0) return { refused: 'PROBE_DATES is empty and has no default' };
    for (const d of dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { refused: `PROBE_DATES must be YYYY-MM-DD, got ${JSON.stringify(d)}` };
    if (new Set(dates).size !== dates.length) return { refused: `a date is named twice (${dates.join(', ')}): the second call would be a second charge` };
    if (dates.length > CALL_CAP) return { refused: `${dates.length} dates is ${dates.length * CREDITS_PER_CALL} credits at the ledger estimate; the cap is ${CALL_CAP} calls (${CALL_CAP * CREDITS_PER_CALL} credits)` };
    return { dates, sport, secret };
}

/** The reading. Sequential, one attempt per date, stops at the first failure. Returns { attempted, wrote, stoppedBecause }. */
export async function run({ env, relay, outDir, log }) {
    const p = plan(env);
    if (p.refused !== undefined) { log(`PROBE REFUSED: ${p.refused}`); return { attempted: 0, wrote: [], stoppedBecause: p.refused, refused: true }; }
    const redact = (text) => String(text).split(p.secret).join('[redacted]');
    mkdirSync(outDir, { recursive: true });
    const wrote = [];
    let attempted = 0;
    let stoppedBecause = null;
    for (const date of p.dates) {
        attempted++;
        const url = `${relay}/identity/mismatches?date=${date}&sports=${encodeURIComponent(p.sport)}`;
        const rec = { probed_at: new Date().toISOString(), date, sport: p.sport, url, http: null, report: null, error: null };
        try {
            const r = await fetch(url, { headers: { 'User-Agent': UA, Authorization: `Bearer ${p.secret}` } });
            rec.http = r.status;
            const text = await r.text();
            if (r.status !== 200) rec.error = redact(`HTTP ${r.status}: ${text.slice(0, 200)}`);
            else {
                let j = null;
                try { j = JSON.parse(text); } catch (_) { rec.error = redact(`non-JSON body (${text.length} bytes): ${text.slice(0, 120)}`); }
                if (rec.error === null) {
                    if (j === null || typeof j !== 'object') rec.error = `body is not a JSON object (${text.length} bytes)`;
                    else if (j.date !== date) rec.error = `body did not echo the requested date (got ${JSON.stringify(j.date)}): not a relay answer`;
                    else rec.report = j;
                }
            }
        } catch (e) { rec.error = redact(e.message === undefined ? e : e.message); }
        const stamp = rec.probed_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
        const file = join(outDir, `identity-mismatches-${p.sport}-${date}-${stamp}.json`);
        writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
        wrote.push(file);
        if (rec.error !== null) { stoppedBecause = `${date}: ${rec.error}`; break; }
    }
    // Rule 91: counts of what happened, not the length of the request list.
    log(`called ${attempted} of ${p.dates.length} requested date(s) for ${p.sport}; ${wrote.length} file(s) written; ledger estimate ${attempted * CREDITS_PER_CALL} credits (the provider's bill is unmeasured)`);
    if (stoppedBecause !== null) log(`STOPPED after the first failure, no retry: ${stoppedBecause}`);
    return { attempted, wrote, stoppedBecause, refused: false };
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
        if (mode === 'fail-second' && hits.length === 2) { res.writeHead(500); return res.end(`boom, leaked ${SECRET}`); }
        if (mode === 'wrong-date') { res.writeHead(200); return res.end(JSON.stringify({ date: '1999-01-01' })); }
        if (mode === 'unauthorized') { res.writeHead(401); return res.end('Unauthorized'); }
        if (mode === 'html') { res.writeHead(200); return res.end('<html>proxy</html>'); }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ date, probed: 1, sports: { EPL: { d1_rows: 7 } } }));
    });
    await new Promise(r => server.listen(0, r));
    const relay = `http://127.0.0.1:${server.address().port}`;
    const dir = mkdtempSync(join(tmpdir(), 'probe-idm-'));
    const logs = [];
    const go = async (envOver, m = 'ok') => {
        hits = []; mode = m; logs.length = 0;
        const out = join(dir, `o${Math.random().toString(36).slice(2, 8)}`);
        const r = await run({ env: { FIELD_MCP_SECRET: SECRET, PROBE_DATES: '2026-10-25,2026-11-21,2026-10-31', ...envOver }, relay, outDir: out, log: (l) => logs.push(l) });
        let files = []; try { files = readdirSync(out); } catch (_) { files = []; }
        return { r, files, out };
    };
    try {
        const a = await go({});
        check('S1 three dates make exactly three requests and write three files', hits.length === 3 && a.files.length === 3 && a.r.stoppedBecause === null, `${hits.length} requests, ${a.files.length} files`);
        check('S2 each request is for one sport and sends the bearer credential', hits.every(h => /sports=EPL$/.test(h.url) && h.auth === `Bearer ${SECRET}`), JSON.stringify(hits.map(h => h.url)));
        check('S3 the first line is the denominator: called 3 of 3 dates, 9 credits at the ledger estimate', /^called 3 of 3 requested date\(s\) for EPL; 3 file\(s\) written; ledger estimate 9 credits/.test(logs[0]), logs[0]);
        const b = await go({ PROBE_DATES: '2026-10-25,2026-11-21,2026-10-31,2026-11-08' });
        check('S4 a fourth date is refused BEFORE any request', b.r.refused === true && hits.length === 0 && b.files.length === 0, `${hits.length} requests`);
        const c = await go({ PROBE_DATES: '2026-10-25,2026-10-25' });
        check('S5 a date named twice is refused before any request', c.r.refused === true && hits.length === 0);
        const d = await go({ PROBE_SPORT: 'EPL,MLS' });
        check('S6 two sports are refused before any request', d.r.refused === true && hits.length === 0);
        const e = await go({ FIELD_MCP_SECRET: '' });
        check('S7 no secret is refused before any request', e.r.refused === true && hits.length === 0);
        const f = await go({ PROBE_DATES: '2026-10-25,2026-11-2' });
        check('S8 a malformed date is refused before any request', f.r.refused === true && hits.length === 0);
        const g = await go({}, 'fail-second');
        check('S9 the first failure ends the run: two requests, not three, and no retry of the failed one', hits.length === 2 && g.r.attempted === 2 && g.r.stoppedBecause !== null, `${hits.length} requests`);
        check('S16 a stopped run says so in its denominator: called 2 of 3 dates, 6 credits, not 3 of 3', /^called 2 of 3 requested date\(s\) for EPL; 2 file\(s\) written; ledger estimate 6 credits/.test(logs[0]) && logs.some(l => /^STOPPED after the first failure, no retry/.test(l)), logs[0]);
        const gtext = g.files.map(n => readFileSync(join(g.out, n), 'utf8')).join('\n') + logs.join('\n');
        check('S10 the secret is in no file and no log line, even when the relay echoes it', !gtext.includes(SECRET) && gtext.includes('[redacted]'));
        const h = await go({}, 'unauthorized');
        check('S11 a 401 ends the run after ONE request', hits.length === 1 && h.r.stoppedBecause !== null && /HTTP 401/.test(h.r.stoppedBecause), `${hits.length} requests`);
        const i = await go({}, 'wrong-date');
        check('S12 a body that does not echo the date is not a relay answer: one request, then stop', hits.length === 1 && /did not echo/.test(i.r.stoppedBecause), `${hits.length} requests`);
        const j = await go({}, 'html');
        check('S13 a 200 that is not JSON is not a reading: one request, then stop', hits.length === 1 && /non-JSON/.test(j.r.stoppedBecause), `${hits.length} requests`);
        const k = await go({ PROBE_DATES: '2026-10-25' });
        const rec = JSON.parse(readFileSync(join(k.out, k.files[0]), 'utf8'));
        check('S14 the relay\'s payload is written verbatim under report, with the date, the sport and the url', rec.report.sports.EPL.d1_rows === 7 && rec.date === '2026-10-25' && rec.sport === 'EPL' && /date=2026-10-25&sports=EPL$/.test(rec.url));
        check('S15 the cap is three calls', CALL_CAP === 3);
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
