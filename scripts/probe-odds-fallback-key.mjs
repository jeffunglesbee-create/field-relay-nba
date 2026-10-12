// IS env.ODDS_API_KEY_FALLBACK ANY GOOD?
//
// Nothing asked this question until 2026-10-12. probe-relay-odds-key-live.mjs
// tests the PRIMARY key; `grep -rln ODDS_API_KEY_FALLBACK scripts/
// .github/workflows/` returned nothing. That is the 2026-09-15 shape — a store
// nobody reads — and this binding is worse to leave unread, because it only
// engages on a 401/429 from the primary. A bad value here first shows up on the
// day the primary is exhausted, which is the worst day to find out.
//
// The owner rotated this key on 2026-10-12 and nothing could confirm it took.
//
// THE WORK HAPPENS IN THE WORKER, not here. The fallback has no GitHub Actions
// copy — Cloudflare binding only — so this script cannot read the key and does
// not try. It calls GET /debug/odds-fallback-key, which makes one /v4/sports
// call inside the worker and returns the status and the vendor's own usage
// headers. The key is never in this process.
//
// FREE. /v4/sports is not charged to the monthly ledger — the same reason the
// primary-key probe uses it, and the relay's ODDS-FREE annotation names this
// route as the disproof for that belief: it returns x-requests-last, so a
// billed sports list would show up as a non-null `requests_last` below.
import { writeFileSync } from 'node:fs';

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';
const GATE  = process.env.RELAY_SHARED_SECRET;   // no default: an unset secret must 401, not look set

/** The verdict, from the route's own payload. Pure, so it can be made to fail. */
export function verdict(body, httpStatus) {
  if (httpStatus === 401) {
    return { state: 'GATE-REFUSED', detail: 'the relay rejected the CI gate — RELAY_SHARED_SECRET is unset or wrong. This says nothing about the fallback key.' };
  }
  if (!body || typeof body !== 'object') {
    return { state: 'UNREADABLE', detail: `the route returned no JSON object (HTTP ${httpStatus})` };
  }
  if (body.key_present === false) {
    return { state: 'BINDING-ABSENT', detail: 'env.ODDS_API_KEY_FALLBACK is not set, so the 401/429 retry can never fire. That is not the same as an invalid key, and it is not good news.' };
  }
  if (body.verdict === 'valid') {
    const q = body.requests_remaining;
    return { state: 'VALID', detail: q === null || q === undefined
      ? 'the key authenticates, but the vendor sent no x-requests-remaining, so the quota is unknown from this call.'
      : `the key authenticates, x-requests-remaining ${q}.` };
  }
  if (body.verdict === 'rejected') {
    return { state: 'REJECTED', detail: 'the vendor rejected the key. The binding holds a pre-rotation value, or was never updated.' };
  }
  return { state: 'INCONCLUSIVE', detail: `the route said "${body.verdict}": ${body.detail || '(no detail)'}` };
}

/** Did the sports list bill us? Returns null when the vendor said nothing. */
export function billed(body) {
  const last = body && body.requests_last;
  if (last === null || last === undefined || last === '') return null;
  const n = Number(last);
  return Number.isFinite(n) ? n > 0 : null;
}

if (process.argv.includes('--self-test')) {
  let ran = 0, fail = 0;
  const ok = (n, c, d = '') => { ran++; if (!c) { fail++; console.log(`  FAIL  ${n}${d ? `\n          ${d}` : ''}`); } else console.log(`  ok    ${n}`); };

  ok('a 401 from the relay is a GATE problem, not a key verdict',
     verdict({}, 401).state === 'GATE-REFUSED',
     'reading a gate refusal as a bad key would send someone to rotate a key that is fine');
  ok('an absent binding is its own state',
     verdict({ key_present: false }, 200).state === 'BINDING-ABSENT');
  ok('a valid key with a quota reads VALID and carries the number',
     verdict({ key_present: true, verdict: 'valid', requests_remaining: '497' }, 200).detail.includes('497'));
  ok('a valid key with NO quota header still reads VALID but says the quota is unknown',
     verdict({ key_present: true, verdict: 'valid', requests_remaining: null }, 200).detail.includes('unknown'));
  ok('a rejected key reads REJECTED',
     verdict({ key_present: true, verdict: 'rejected' }, 200).state === 'REJECTED');
  ok('a non-object body is UNREADABLE, not a pass',
     verdict(null, 200).state === 'UNREADABLE');
  ok('an unexpected route verdict is INCONCLUSIVE',
     verdict({ key_present: true, verdict: 'unexpected-status', detail: '503' }, 200).state === 'INCONCLUSIVE');

  // The ODDS-FREE disproof. This is the half that makes the annotation falsifiable.
  ok('no requests_last means the vendor said nothing about billing', billed({}) === null);
  ok('requests_last 0 means the sports list was free', billed({ requests_last: '0' }) === false);
  ok('requests_last 1 means the ODDS-FREE annotation is WRONG', billed({ requests_last: '1' }) === true,
     'this is the disproof the relay comment names — it has to be able to fire');

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) on the pure verdict and the billing`);
  console.log(`disproof. It does NOT reach the relay — run without --self-test for that.`);
  process.exitCode = fail ? 1 : 0;
} else {
  const LOG = [];
  const say = (l = '') => { LOG.push(l); console.log(l); };

  say(`=== odds fallback key probe  utc=${new Date().toISOString()} ===\n`);
  if (!GATE) {
    say('  RELAY_SHARED_SECRET is not set in this environment.');
    say('  Refusing to call: an unset gate produces a 401 that looks exactly like');
    say('  a relay problem, and reporting that as a key verdict would be worse');
    say('  than reporting nothing.');
    process.exitCode = 1;
  } else {
    let body = null, status = 0;
    try {
      const r = await fetch(`${RELAY}/debug/odds-fallback-key`, {
        headers: { 'X-FIELD-Relay': GATE, Accept: 'application/json' },
      });
      status = r.status;
      const txt = await r.text();
      try { body = JSON.parse(txt); } catch (_) { say(`  non-JSON body: ${txt.slice(0, 200)}`); }
    } catch (e) {
      say(`  the relay call threw: ${String(e && e.message || e)}`);
    }

    say(`  HTTP ${status}`);
    if (body) {
      say(`  key_present        : ${body.key_present}`);
      say(`  route verdict      : ${body.verdict}`);
      say(`  vendor status      : ${body.status ?? '(no vendor call)'}`);
      say(`  cf-cache-status    : ${body.cf_cache_status ?? '(none)'}`);
      say(`  x-requests-remaining: ${body.requests_remaining ?? '(absent)'}`);
      say(`  x-requests-used    : ${body.requests_used ?? '(absent)'}`);
      say(`  x-requests-last    : ${body.requests_last ?? '(absent)'}`);
      if (body.sports_count !== undefined) say(`  sports in list     : ${body.sports_count}`);
    }

    const v = verdict(body, status);
    say(`\n  verdict: ${v.state}`);
    say(`  ${v.detail}`);

    const b = billed(body);
    say(`\n  ODDS-FREE disproof : ${b === null ? 'the vendor sent no x-requests-last, so this call neither confirms nor refutes the annotation'
      : b ? 'REFUTED — the sports list DID bill. src/index.js\'s ODDS-FREE annotations are wrong and every /v4/sports site needs a guard.'
          : 'holds — x-requests-last is 0, the sports list was not billed'}`);

    say(`\nCOVERAGE: ONE call, to ONE binding, at one moment. It says whether the key`);
    say(`authenticates now. It does NOT prove the 401/429 retry path works end to end —`);
    say(`that needs the primary to actually fail, which this does not arrange.`);
    process.exitCode = (v.state === 'VALID') ? 0 : 1;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  try { writeFileSync(`outbox/odds-fallback-key-${stamp}.log`, LOG.join('\n') + '\n'); }
  catch (e) { console.error(`could not write the outbox log: ${e.message}`); }
}
