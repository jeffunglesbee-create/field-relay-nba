// Zero-credit LOCAL reproduction of the shape of handleCFLOddsProbs, on the real workerd runtime (miniflare 4). docs/CC-CMD-2026-10-13-vendor-residual-window.md, Task 2, premise H1.
// Question: when the client disconnects mid-request, does workerd cancel the handler's awaited continuation (the refund and the tally that follow the vendor fetch), and does
// ctx.waitUntil keep it? The handler charges (a D1 write), fetches a cached "vendor" answer, then reconciles (a stand-in for D1/KV latency, the refund, a KV write, the tally).
// No network, no vendor, no credits. Run:  npm install --no-save miniflare@4 && node scripts/cfl-abort-local-workerd.mjs
// RESULT, 2026-11-01: THE INSTRUMENT IS INVALID. Its positive control is a handler that looks at request.signal (enable_request_signal) and stops when it is aborted; if a destroyed client
// socket reached the worker as a disconnect, that handler would stop at 'charged'. It did not stop, in 6 of 6 calls, whether the client connected through miniflare's Node proxy or
// directly to workerd's own socket (VIA=direct, the default; VIA=proxy). So this run cannot see a disconnect, and "the awaited continuation survived" means NOTHING. It is committed so the
// attempt is not repeated and so the failure is on the record. Whether Cloudflare's EDGE propagates a disconnect to a production Worker is not testable locally; production is decided by
// scripts/cfl-abort-experiment.mjs (Task 2b, owner approval).
// Zero-credit local reproduction of the shape of handleCFLOddsProbs, on the real workerd runtime (miniflare): does a client that disconnects mid-request
// stop the handler's continuation (the post-fetch refund and tally) when it is awaited, and does ctx.waitUntil keep it? No network, no vendor, no credits.
import { Miniflare } from 'miniflare';
import http from 'node:http';
import { createRequire } from 'node:module';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCRIPT = `
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode');
    const id = url.searchParams.get('id');
    let n = 0; const step = (s) => env.LOG.put(id + '|' + (++n) + '|' + s, '1');   // the step log is KV, ordered by its numeric prefix
    await step('charged');                                    // consumeOddsCredit: a write before the fetch
    await env.VENDOR.fetch('http://vendor/odds');             // the cached vendor answer (a HIT)
    const reconcile = async () => {
      await env.SLOW.fetch('http://slow/tick');               // stands in for D1/KV latency under load
      // POSITIVE CONTROL: in this mode the handler itself looks at the request signal (enable_request_signal) and stops, so the harness must be able to report a cut-off continuation.
      if (mode === 'signalcheck' && request.signal.aborted) return;
      await step('refunded');                                 // the correction batch
      await env.KV.put('k' + id, '1');                        // the KV bump
      await step('tallied');                                  // the tally row
    };
    if (mode === 'waitUntil') ctx.waitUntil(reconcile()); else await reconcile();
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
  }
}`;

const mf = new Miniflare({
  modules: true, script: SCRIPT, compatibilityDate: '2026-01-01', compatibilityFlags: ['enable_request_signal'], unsafeDirectSockets: [{ host: '127.0.0.1', port: 0 }],
  kvNamespaces: ['KV', 'LOG'],
  serviceBindings: {
    VENDOR: async () => { await sleep(20); return new Response('[]', { headers: { 'cf-cache-status': 'HIT' } }); },
    SLOW: async () => { await sleep(300); return new Response('ok'); },
  },
});
await mf.ready;
// Miniflare fronts workerd with its own Node HTTP server, which may not pass a client disconnect on. The direct URL talks to workerd's own socket; the positive control below decides which one is a valid instrument.
const useDirect = process.env.VIA !== 'proxy';
const base = useDirect ? (await mf.unsafeGetDirectURL()).origin : (await mf.ready).origin;
const log = await mf.getKVNamespace('LOG');

function call(id, mode, abortAfterMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.get(`${base}/?mode=${mode}&id=${id}`, (res) => { res.resume(); res.on('end', () => resolve({ ended: 'response', ms: Date.now() - t0 })); });
    req.on('error', () => resolve({ ended: 'error', ms: Date.now() - t0 }));
    if (abortAfterMs !== null) setTimeout(() => req.destroy(), abortAfterMs);
  });
}
const N = 6;
const results = [];
for (const mode of ['awaited', 'waitUntil', 'signalcheck']) {
  for (const [label, abortAfter] of [['no abort', null], ['abort at 100 ms (during the reconcile)', 100], ['abort at 500 ms (after it)', 500]]) {
    const ids = Array.from({ length: N }, (_, i) => `${mode}-${abortAfter}-${i}`);
    const ends = await Promise.all(ids.map((id) => call(id, mode, abortAfter)));
    const endTally = {}; ends.forEach((e) => { endTally[e.ended] = (endTally[e.ended] || 0) + 1; });
    await sleep(1500); // let anything that is going to finish, finish
    const per = [];
    for (const id of ids) { const keys = (await log.list({ prefix: id + '|' })).keys.map((k) => k.name.split('|')[2]); per.push(keys.join('>')); }
    const tally = {}; per.forEach((p) => { tally[p] = (tally[p] || 0) + 1; });
    results.push({ mode, scenario: label, calls: N, client: endTally, outcomes: tally });
    console.log(`${mode.padEnd(10)} ${label.padEnd(40)} client saw ${JSON.stringify(endTally).padEnd(16)} server steps ${JSON.stringify(tally)}`);
  }
}
const control = results.find((r) => r.mode === 'signalcheck' && r.scenario.startsWith('abort at 100'));
const seen = Object.keys(control.outcomes).some((k) => k !== 'charged>refunded>tallied');
console.log(seen
  ? '\nPOSITIVE CONTROL PASSED: a handler that checks request.signal was cut off, so this instrument can see a disconnect and the other rows are informative.'
  : '\nPOSITIVE CONTROL FAILED: a handler that checks request.signal was NOT cut off by a client abort, so this instrument cannot see a disconnect. EVERY row above is uninformative about H1.');
const ver = createRequire(import.meta.url)('workerd/package.json').version;
console.log(`\nclient connects ${useDirect ? 'DIRECTLY to workerd (unsafeGetDirectURL)' : 'through miniflare\'s Node proxy'}; workerd ${ver}; ${results.length} scenarios x ${N} calls = ${results.length * N} calls, zero network, zero credits`);
await mf.dispose();
