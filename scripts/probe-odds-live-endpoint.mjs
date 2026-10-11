// DOES `/odds-live` EXIST?
//
// `ambientFetchLiveOdds` is the only reconcile site that ever lands in state
// `no-header`, and it does so on every call: 1037 calls / 2074 credits on
// 2026-10-10, 289 / 578 by 16:51 on 2026-10-11, always exactly 2.0 credits
// each. `oddsCreditCost` on its URL returns 2, so the arithmetic is its.
//
// Its URL is
//   https://api.the-odds-api.com/v4/sports/{sport}/odds-live?apiKey=...
// and The Odds API v4's documented reads are `/odds` and
// `/historical/sports/{sport}/odds`. If `/odds-live` is not a path the vendor
// serves, the response is a 404, a 404 carries no `x-requests-last`, reconcile
// correctly records `no-header` and keeps the estimate — and we have charged
// ourselves 2 credits for a call the vendor billed nothing for.
//
// THIS SPENDS NOTHING. The key sent is a literal invalid string. A 401 means
// the path resolved and auth was checked; a 404 means it did not resolve.
// Neither is billed, and no real key is read, sent, or printed by this file.
//
// THE CONTROL IS NOT OPTIONAL. A 404 on both paths would mean the sport key is
// wrong, not that `/odds-live` is missing. `/odds` is documented and must come
// back as path-exists, or this refuses to say anything about `/odds-live`.
//
// Sandbox egress cannot reach api.the-odds-api.com (HTTP 000), so this runs on
// a GitHub Actions runner.

const KEY = 'INVALID_KEY_FOR_PATH_TEST';   // never a real key, by construction
const SPORTS = ['soccer_fifa_world_cup', 'soccer_epl'];
const QUERY = 'regions=us,eu&markets=h2h&oddsFormat=decimal';

export const url = (sport, path) =>
  `https://api.the-odds-api.com/v4/sports/${sport}/${path}?apiKey=${KEY}&${QUERY}`;

/** What one status tells us about the PATH, which is the only question here. */
export function classify(status) {
  if (status === 401 || status === 403) return 'path-exists';   // auth checked => route resolved
  if (status === 422) return 'path-exists';                     // params validated => route resolved
  if (status === 404) return 'path-missing';
  if (status === 200) return 'unexpected-200';                  // an invalid key must not succeed
  return `inconclusive-${status}`;
}

/** The verdict, with the control enforced. Pure, so it can be made to fail. */
export function verdict(rows) {
  const control = rows.filter((r) => r.path === 'odds');
  const subject = rows.filter((r) => r.path === 'odds-live');
  if (!control.length || !subject.length) {
    return { state: 'REFUSED', detail: 'both paths must be probed; one of them was not' };
  }
  const controlOk = control.every((r) => r.verdict === 'path-exists');
  if (!controlOk) {
    return { state: 'REFUSED',
      detail: `the /odds control did not resolve (${control.map((r) => `${r.sport}:${r.verdict}`).join(', ')}) — a 404 on /odds-live would then say nothing about the path` };
  }
  if (subject.every((r) => r.verdict === 'path-missing')) {
    return { state: 'MISSING',
      detail: `/odds-live returned 404 on ${subject.length} of ${subject.length} sport(s) while /odds resolved on ${control.length} of ${control.length} — the vendor does not serve this path, so it bills nothing and sends no usage header` };
  }
  if (subject.every((r) => r.verdict === 'path-exists')) {
    return { state: 'EXISTS',
      detail: `/odds-live resolved on ${subject.length} of ${subject.length} sport(s) — the path is real and the missing receipt has another cause` };
  }
  return { state: 'MIXED',
    detail: `/odds-live answered differently per sport: ${subject.map((r) => `${r.sport}:${r.verdict}`).join(', ')}` };
}

if (process.argv.includes('--self-test')) {
  let ran = 0, fail = 0;
  const ok = (n, c, d = '') => { ran++; if (!c) { fail++; console.log(`  FAIL  ${n}${d ? `\n          ${d}` : ''}`); } else console.log(`  ok    ${n}`); };
  const R = (path, sport, v) => ({ path, sport, verdict: v });

  ok('401 means the path resolved', classify(401) === 'path-exists');
  ok('404 means it did not', classify(404) === 'path-missing');
  ok('200 on an invalid key is not a pass', classify(200) === 'unexpected-200');
  ok('a 500 is inconclusive, not missing', classify(500) === 'inconclusive-500');

  ok('control 401 + subject 404 => MISSING',
     verdict([R('odds', 'a', 'path-exists'), R('odds-live', 'a', 'path-missing')]).state === 'MISSING');
  ok('control 401 + subject 401 => EXISTS',
     verdict([R('odds', 'a', 'path-exists'), R('odds-live', 'a', 'path-exists')]).state === 'EXISTS');

  // THE ONE THAT MATTERS. Both 404 is the sport key being wrong, and reading it
  // as "the endpoint is missing" is the mistake this control exists to stop.
  ok('BOTH 404 refuses rather than concluding',
     verdict([R('odds', 'a', 'path-missing'), R('odds-live', 'a', 'path-missing')]).state === 'REFUSED',
     'a bad sport key 404s everything; that is not evidence about the path');
  ok('a subject that differs per sport is MIXED, not MISSING',
     verdict([R('odds', 'a', 'path-exists'), R('odds-live', 'a', 'path-missing'), R('odds-live', 'b', 'path-exists')]).state === 'MIXED');
  ok('a missing subject refuses', verdict([R('odds', 'a', 'path-exists')]).state === 'REFUSED');
  ok('the key in every URL is the literal invalid one', url('x', 'odds').includes(`apiKey=${KEY}`));

  console.log(fail ? `\n${fail} FAILED of ${ran}` : `\nself-test: ${ran}/${ran}`);
  console.log(`COVERAGE: ${ran} assertion(s) on the pure classifier and verdict. It does`);
  console.log(`NOT reach the vendor — run without --self-test for that.`);
  process.exitCode = fail ? 1 : 0;
} else {
  const rows = [];
  for (const sport of SPORTS) {
    for (const path of ['odds', 'odds-live']) {
      let status = 0, body = '';
      try {
        const r = await fetch(url(sport, path), { headers: { Accept: 'application/json' } });
        status = r.status;
        body = (await r.text()).slice(0, 200);
      } catch (e) {
        body = `fetch threw: ${String(e.message || e)}`;
      }
      rows.push({ sport, path, status, verdict: classify(status), body });
    }
  }

  console.log(`=== does /odds-live exist  utc=${new Date().toISOString()} ===\n`);
  console.log(`  key sent: the literal string ${KEY} — nothing billable, no real key read\n`);
  for (const r of rows) {
    console.log(`  ${r.sport.padEnd(24)} /${r.path.padEnd(10)} HTTP ${String(r.status).padEnd(4)} ${r.verdict}`);
    console.log(`  ${' '.repeat(24)} ${' '.repeat(11)} body: ${r.body.replace(/\s+/g, ' ')}`);
  }

  const v = verdict(rows);
  console.log(`\n  verdict: ${v.state}`);
  console.log(`  ${v.detail}`);
  console.log(`\nCOVERAGE: ${SPORTS.length} sport key(s) x 2 path(s), one request each, with an`);
  console.log(`invalid key. It answers whether the PATH resolves and nothing else — it does`);
  console.log(`not show what a valid key would return, or what the vendor bills for a 404.`);
  process.exitCode = (v.state === 'REFUSED') ? 1 : 0;
}
