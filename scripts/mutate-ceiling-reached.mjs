// Rule 90 for scripts/check-ceiling-reached.mjs.
//
// The check reads source text, and a source-text check is the easiest kind to
// write vacuously: a regex that matches a string in the file it was written
// alongside proves only that the author typed it. Each mutation below restores
// a state this field exists to end.
//
// Mutants are placed BESIDE the original and deleted on exit, and a POSITIVE
// CONTROL runs an unmutated copy at the mutant location first.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';

const SRC = 'src/budget-helpers.js';
const original = readFileSync(SRC, 'utf8');
const DIR = dirname(SRC);
const born = [];
const place = (text, tag) => {
  const p = join(DIR, `.mutant-${tag}-${Math.random().toString(36).slice(2, 8)}.js`);
  writeFileSync(p, text); born.push(p); return resolve(p);
};
process.on('exit', () => { for (const p of born) { try { unlinkSync(p); } catch (_e) {} } });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));   // 'exit' handlers do not run on a signal unless it exits

// 'pass', 'red' (an assertion failed: a FAIL line and an "N of M passed." with
// N < M), or 'error' (anything else: a crash or a load failure proves nothing
// about what the check asserts, so it is never counted as caught).
const run = (path) => {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, ['scripts/check-ceiling-reached.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, BUDGET_HELPERS_SRC: path } });
  } catch (e) { out = String(e.stdout || ''); code = e.status ?? 1; }
  const m = /^(\d+) of (\d+) passed\.$/m.exec(out);
  if (code === 0) return m && m[1] === m[2] ? 'pass' : 'error';
  return m && Number(m[1]) < Number(m[2]) && /^FAIL  /m.test(out) ? 'red' : 'error';
};

if (run(resolve(SRC)) !== 'pass') { console.log('FAIL — the check is already red on clean source.'); process.exit(1); }
if (run(place(original, 'control')) !== 'pass') {
  console.log('FAIL — an UNMUTATED copy at the mutant location is red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the check passes on current source and on an unmutated copy at the mutant location\n');

const MUTATIONS = [
  ['C1 the veto goes back to a boolean',
   "                    await env.FIELD_JOURNALISM.put(warnedKey, new Date().toISOString(),\n                        { expirationTtl: (SITE_TTL_DAYS + 1) * 86400 });",
   "                    await env.FIELD_JOURNALISM.put(warnedKey, '1', { expirationTtl: (SITE_TTL_DAYS + 1) * 86400 });",
   'THE STATE THIS ENDS: on 2026-09-19 the counter sat at the ceiling from before 19:39 until at least 22:32. A boolean says the cap was hit; it cannot say for how long, which is the difference between a budget spent and a service suppressed'],

  // Anchored on the day's warned key as well: since 2026-10-18 the month's
  // hard-limit block in the same function has the same two lines, and the
  // shorter anchor matched twice — NOTHING MUTATED.
  ['C2 the veto is written on EVERY refusal',
   '            const warnedKey = `${key}:warned`;\n            try {\n                const already = await env.FIELD_JOURNALISM.get(warnedKey);\n                if (!already) {',
   '            const warnedKey = `${key}:warned`;\n            try {\n                const already = null;\n                if (true) {',
   'a KV round trip on every vetoed call, for the hours a capped day keeps refusing — the write is once a day precisely so this field costs nothing'],

  ['C3 the reader infers the veto from the counter instead of the key',
   'await stampOf(`odds:daily:${date}:warned`, refusalDayAt.day);',
   '({ value: used >= ceiling ? true : null, unreadable: false });',
   'a day that lands exactly on the cap at 23:58 turned nothing away; used === ceiling cannot tell that from a day that refused fetches for three hours'],
  ['C4 the three states collapse to two',
   'if (raw) kv = /^\\d{4}-\\d{2}-\\d{2}T/.test(raw) ? raw : true;',
   'if (raw) kv = true;',
   'a dated key and a legacy one read alike, so the hour is thrown away for every day that has it'],
  ['C5 an absent veto reads as false',
   'return { value: null, unreadable: !kvOk || refusalState === \'unreadable\' };',
   'return { value: false, unreadable: !kvOk || refusalState === \'unreadable\' };',
   'false reads as "checked, no veto today"; null is the only honest value for a read that found nothing (Rule 99)'],
  ['C6 an unreadable KV invents a veto',
   '} catch (_) { kvOk = false; }',
   '} catch (_) { kvOk = false; kv = true; }',
   'a KV failure would report a ceiling that was never hit, and every watch reading this route would act on it'],
  ['C7 the field never reaches the response',
   '            ceiling_reached_at: ceilingHit,',
   '            // ceiling_reached_at removed',
   'a value only the worker knows is not an artifact — the whole reason this was invisible for the four days it has been happening'],

  // THE LIFETIME (fix 3 A). Each is a stamp that dies before a reader the route
  // still serves; only the executed replay can see them. Since 2026-10-28 the
  // site stamp has the same lifetime and the same expression, so each is aimed at
  // ONE writer by the key it puts: warnedKey is the day's, siteStampKey the site's.
  ...[['', 'warnedKey', 'day'], ['S', 'siteStampKey', 'site']].flatMap(([t, key, what]) => {
    const put = `put(${key}, new Date().toISOString(),\n                        `;
    const ttl = '{ expirationTtl: (SITE_TTL_DAYS + 1) * 86400 });';
    return [
      [`${t}T1 the ${what} stamp lives one day again`, put + ttl, put + '{ expirationTtl: 86400 });',
       'THE STATE THIS ENDS: the watch read 10-07 and 10-11 as days with no refusal, because the stamp was gone by the next afternoon'],
      [`${t}T2 the ${what} stamp lives exactly SITE_TTL_DAYS`, put + ttl, put + '{ expirationTtl: SITE_TTL_DAYS * 86400 });',
       'a stamp from early on day D is gone before the route stops serving D at the end of D+2'],
      [`${t}T3 the ${what} stamp lives one second short`, put + ttl, put + '{ expirationTtl: (SITE_TTL_DAYS + 1) * 86400 - 1 });',
       'the boundary: a stamp from the first instant of D must survive to the last instant of D+2'],
      [`${t}T4 the ${what} stamp lives one day, spelt as an absolute expiry`, put + ttl, put + '{ expiration: Math.floor(Date.now() / 1000) + 86400 });',
       'Cloudflare honours `expiration` too; a replay that modelled only expirationTtl passed this'],
    ];
  }),
  ['T5 the day stamp is refreshed on every veto',
   '                    await env.FIELD_JOURNALISM.put(warnedKey, new Date().toISOString(),\n                        { expirationTtl: (SITE_TTL_DAYS + 1) * 86400 });\n                }',
   '                }\n                    await env.FIELD_JOURNALISM.put(warnedKey, new Date().toISOString(),\n                        { expirationTtl: (SITE_TTL_DAYS + 1) * 86400 });',
   'a plausible fix for the lifetime that moves ceiling_reached_at to the latest refusal; the warning still fires once, so only an executed second veto sees it'],

  // THE MONTH'S STAMP (fix 3 B).
  ['B1 the month stamp is read for the current month',
   'stampOf(`odds:credits:${date.slice(0, 7)}:warned:limit`, refusalMonthAt)',
   'stampOf(`odds:credits:${new Date().toISOString().slice(0, 7)}:warned:limit`, refusalMonthAt)',
   'THE STATE THIS ENDS: a veto on the 31st read on the 1st found November\'s key, empty'],
  ['B2 the month field never reaches the response',
   '            month_limit_reached_at: monthLimitHit,',
   '            // month_limit_reached_at removed',
   'the watch cannot judge a month refusal it is not given'],
  ['B3 the month stamp loses its hour',
   'const monthLimitHit = monthStamp.value;',
   'const monthLimitHit = monthStamp.value === null ? null : true;',
   'without the hour the watch cannot tell a limit reached before the day from one reached after it'],
  ['B4 an absent month stamp reads as false',
   'const monthLimitHit = monthStamp.value;',
   'const monthLimitHit = monthStamp.value === null ? false : monthStamp.value;',
   'false reads as "checked, no refusal"; null is the only honest value for a read that found nothing (Rule 99)'],
  ['B5 an unreadable month stamp invents a refusal',
   'const monthLimitHit = monthStamp.value;',
   'const monthLimitHit = monthStamp.unreadable ? true : monthStamp.value;',
   'the watch counts `true` as a month refusal with no hour, so a KV blip would turn it red'],
  ['B6 the month stamp lives one day',
   "await env.FIELD_JOURNALISM.put(warnedKey, new Date().toISOString(), { expirationTtl: 60 * 86400 });",
   "await env.FIELD_JOURNALISM.put(warnedKey, new Date().toISOString(), { expirationTtl: 86400 });",
   'the fix 3 A defect, on the stamp fix 3 B relies on: a month that started refusing on the 5th reads as no refusal on the 30th'],
  ['B7 the month stamp lives 30 days',
   "await env.FIELD_JOURNALISM.put(warnedKey, new Date().toISOString(), { expirationTtl: 60 * 86400 });",
   "await env.FIELD_JOURNALISM.put(warnedKey, new Date().toISOString(), { expirationTtl: 30 * 86400 });",
   'a stamp from the 1st must survive to the last read of the 31st, about 33 days on'],
  // A FAILED READ IS NAMED (fix 3 D).
  ['D1 a failed day-stamp read is not named',
   'if (dayStamp.unreadable) stampsUnreadable.push(\'ceiling_reached_at\');',
   '',
   'THE STATE THIS ENDS: a KV failure on the day stamp answered exactly like a day with no refusal, and the watch passed it'],
  ['D2 a failed month-stamp read is not named',
   'if (monthStamp.unreadable) stampsUnreadable.push(\'month_limit_reached_at\');',
   '',
   'the same, for the month stamp: a month that was refusing reads as clean on a KV blip'],
  ['D3 stamps_unreadable never reaches the response',
   '            stamps_unreadable: stampsUnreadable.length ? stampsUnreadable : null,',
   '            // stamps_unreadable removed',
   'a failure only the worker knows about is not an artifact'],
  ['D4 stamps_unreadable is [] when every read worked',
   '            stamps_unreadable: stampsUnreadable.length ? stampsUnreadable : null,',
   '            stamps_unreadable: stampsUnreadable,',
   'null is "nothing failed"; an empty array is a second spelling a reader must know about'],
  ['D5 a failed month read also clears a day stamp that was read',
   'ceiling_reached_at: ceilingHit,',
   'ceiling_reached_at: monthStamp.unreadable ? null : ceilingHit,',
   'a KV blip on the month key would hide a day refusal that had been read, and the watch would report not-reported instead of day-ceiling'],
  ['D6 a failed day read discards a month refusal read after it',
   'month_limit_reached_at: monthLimitHit,',
   'month_limit_reached_at: dayStamp.unreadable ? null : monthLimitHit,',
   'a KV blip on the day key would hide a month refusal that had been read'],
  ['B8 the month stamp is rewritten on every refusal',
   '            const warnedKey = `odds:credits:${month}:warned:limit`;\n            try {\n                const already = await env.FIELD_JOURNALISM.get(warnedKey);',
   '            const warnedKey = `odds:credits:${month}:warned:limit`;\n            try {\n                const already = null;',
   'month_limit_reached_at moves to the latest refusal, and the watch reads a month that had been refusing since the 5th as clean on the 30th'],

  // THE SITE CAPS' STAMPS (Task 3, 2026-10-28).
  ['P1 the site stamp is refreshed on every veto',
   '            const siteStampKey = _siteVetoKey(site, date);\n            try {\n                const already = await env.FIELD_JOURNALISM.get(siteStampKey);',
   '            const siteStampKey = _siteVetoKey(site, date);\n            try {\n                const already = null;',
   'site_ceiling_reached_at moves to the latest refusal, and a consumer that has been turned away since morning reads as turned away at night'],
  ['P2 a failed site-stamp read invents a refusal',
   'siteHit[s] = st.value;\n            if (st.unreadable) {',
   'siteHit[s] = st.unreadable ? true : st.value;\n            if (st.unreadable) {',
   'the watch counts `true` as a refusal with no hour, so a KV blip would turn it red on every capped site'],
  ['P3 a failed site-stamp read is not named',
   "\n                if (!stampsUnreadable.includes('site_ceiling_reached_at')) stampsUnreadable.push('site_ceiling_reached_at');",
   '',
   'a KV failure on a site stamp answers exactly like a consumer that was never turned away, and the watch passes it'],
  ['P4 the site reader reads the day\'s stamp',
   'stampOf(_siteVetoKey(s, date), refusalDayAt.sites[s] ?? null)',
   'stampOf(`odds:daily:${date}:warned`, refusalDayAt.sites[s] ?? null)',
   'every capped site is reported refused whenever the DAY is, and never when only its own cap is'],
  ['P5 the site reader is keyed by today',
   'stampOf(_siteVetoKey(s, date), refusalDayAt.sites[s] ?? null)',
   'stampOf(_siteVetoKey(s, new Date().toISOString().slice(0, 10)), refusalDayAt.sites[s] ?? null)',
   'a closed day read the next afternoon reports the new day\'s stamps: the refusal the watch is looking for is never found'],
  ['P6 the site stamp loses its hour',
   'siteHit[s] = st.value;\n            if (st.unreadable) {',
   'siteHit[s] = st.value === null ? null : true;\n            if (st.unreadable) {',
   'without the hour a refusal cannot be placed against the capture windows'],
  ['P7 an absent site stamp reads as false',
   'siteHit[s] = st.value;\n            if (st.unreadable) {',
   'siteHit[s] = st.value === null ? false : st.value;\n            if (st.unreadable) {',
   'false reads as "checked, no refusal"; null is the only honest value for a read that found nothing (Rule 99)'],
  ['P8 the site stamps never reach the response',
   '            site_ceiling_reached_at: siteHit,',
   '            // site_ceiling_reached_at removed',
   'a refusal only the worker knows about is not an artifact'],
  ['P9 the site caps never reach the response',
   '            site_ceilings: siteCeilings,',
   '            // site_ceilings removed',
   'a reader cannot tell a consumer with no cap from one the route does not know about'],
  ['P10 an uncapped site is served as a cap of 0',
   'siteCeilings[s] = c === NO_SITE_CEILING ? null : c;',
   'siteCeilings[s] = c === NO_SITE_CEILING ? 0 : c;',
   'every uncapped consumer reads as refused outright, and the stamps are then read for all of them'],
  ['P12 the sites whose stamp read failed are not named',
   '                siteUnreadable.push(s);\n',
   '',
   'a null in site_ceiling_reached_at no longer says which of the capped sites is unknown'],
  ['P13 a legacy site stamp is served raw instead of as true',
   'siteHit[s] = st.value;\n            if (st.unreadable) {',
   'siteHit[s] = st.value === true ? \'1\' : st.value;\n            if (st.unreadable) {',
   'the documented ISO / true / null contract held for the day stamp only; a reader asking === true would miss a bare 1'],
  ['P14 site_stamps_unreadable never reaches the response',
   '            site_stamps_unreadable: siteUnreadable.length ? siteUnreadable : null,',
   '            // site_stamps_unreadable removed',
   'a failure only the worker knows about is not an artifact'],
  ['P11 the served cap ignores the date asked about',
   'const c = siteCeilingFor(s, date);\n            siteCeilings[s]',
   'const c = siteCeilingFor(s);\n            siteCeilings[s]',
   'a grant day reports the standing cap, a budget readout that disagrees with the budget'],
  ['R1 the reader ignores the refusal record',
   'const times = [kv, recordedAt].filter(',
   'const times = [kv].filter(',
   'THE DEFECT (fix 3 E): a stamp whose write failed leaves the day reading none, and the record that exists to close that is never read'],
  ['R2 the reader serves the LATEST of the two times',
   'const times = [kv, recordedAt].filter(v => typeof v === \'string\').sort();',
   'const times = [kv, recordedAt].filter(v => typeof v === \'string\').sort().reverse();',
   'a retried stamp carries the later hour and the record the earlier; serving the later is the \'later hour\' the CC-CMD named as the residual'],
  ['R3 an unreadable record is read as none',
   '} catch (_) { refusalState = \'unreadable\'; refusalRows = null; }',
   '} catch (_) { refusalState = \'ok\'; refusalRows = null; }',
   'a D1 blip would turn a refusing day into a clean one, the absence collapse (Rule 99)'],
  ['R4 an unreadable record does not make an empty answer unknown',
   'unreadable: !kvOk || refusalState === \'unreadable\' }',
   'unreadable: !kvOk }',
   'the record is unreadable and the stamp says nothing: that is unknown, and it was served as none'],
  ['R5 `refusals` is [] when the record could not be read',
   '} catch (_) { refusalState = \'unreadable\'; refusalRows = null; }',
   '} catch (_) { refusalState = \'unreadable\'; refusalRows = []; }',
   '[] reads as \'the table was read and holds none\'; null is the only honest value for a read that failed'],
  ['R6 the month\'s record is keyed by the day, not the month',
   '.bind(`${date.slice(0, 7)}-01`, `${date.slice(0, 7)}-31`)',
   '.bind(date, date)',
   'a limit reached on the 15th is never found when the 31st is read, and \'may be after this day\' is lost'],
  ['R7 the day\'s record is read for another day',
   'WHERE day = ? ORDER BY first_at, scope, site',
   'WHERE day <> ? ORDER BY first_at, scope, site',
   'a refusal on one day is reported against every other day'],
  ['R8 a site\'s record is read from the day scope',
   'if (r.scope === \'site\') refusalDayAt.sites[r.site] = r.first_at;',
   'if (r.scope === \'day\') refusalDayAt.sites[r.site] = r.first_at;',
   'a site cap that refused reads as none, and the day\'s refusal is attributed to a site'],
  ['R9 the day\'s record serves the LATEST caller\'s time',
   'r.first_at < refusalDayAt.day',
   'r.first_at > refusalDayAt.day',
   'the day\'s first refusal is the earliest over every caller turned away, and a later caller\'s would be served'],
  ['R10 the refusal cells never reach the response',
   '            refusals: date < REFUSAL_RECORD_FROM ? null : refusalRows,',
   '            refusals: null,',
   'a value only the worker knows is not an artifact (Rule 90)'],
  ['R12 a day refusal fills the caller\'s site stamp',
   "if (r.scope === 'site') refusalDayAt.sites[r.site] = r.first_at;",
   "refusalDayAt.sites[r.site] = r.first_at;",
   'a capped caller turned away by the DAY would read as having hit its own cap'],
  ['R13 the month query loses its scope filter',
   "WHERE scope = 'month' AND day >= ? AND day <= ?",
   "WHERE day >= ? AND day <= ?",
   'any refusal in the month reads as the 85,000 limit having been reached'],
  ['R14 a site refusal fills the day time',
   "if (r.scope === 'day' && (refusalDayAt.day === null || r.first_at < refusalDayAt.day)) refusalDayAt.day = r.first_at;",
   "if (refusalDayAt.day === null || r.first_at < refusalDayAt.day) refusalDayAt.day = r.first_at;",
   'a site cap that refused would read as the day ceiling having been reached'],
  ['R15 the month time is the LATEST across days',
   "SELECT MIN(first_at) AS first_at FROM odds_budget_refusal",
   "SELECT MAX(first_at) AS first_at FROM odds_budget_refusal",
   'the later hour the CC-CMD named as the residual, for the month'],
  ['R16 the day\'s record is read for every earlier day too',
   "WHERE day = ? ORDER BY first_at, scope, site",
   "WHERE day <= ? ORDER BY first_at, scope, site",
   'a refusal on the 29th is reported against the 30th'],
  ['R17 the cells are no longer ordered by time',
   "WHERE day = ? ORDER BY first_at, scope, site",
   "WHERE day = ? ORDER BY scope DESC, site DESC",
   'the cells come back in an order a reader cannot rely on'],
  ['R18 `refusals` is served for a date before the record existed',
   "refusals: date < REFUSAL_RECORD_FROM ? null : refusalRows,",
   "refusals: refusalRows,",
   'a day that predates the table would read \'the table holds none\' beside a stamp that says a refusal happened'],
  ['R19 the first date the record can hold is moved earlier',
   "export const REFUSAL_RECORD_FROM = '2026-10-28';",
   "export const REFUSAL_RECORD_FROM = '2026-01-01';",
   'the same, by moving the line instead of removing it'],
  ['R11 a count that is not a number is read as zero',
   "if (typeof r.n !== 'number' || !Number.isFinite(r.n)) throw new Error('refusal rows: n is not a number');",
   "",
   'a corrupt row would read as a refusal counted zero times, and the record would call itself readable'],
];

let caught = 0;
for (const [name, anchor, repl, why] of MUTATIONS) {
  const hits = original.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  const mutated = original.replace(anchor, repl);
  if (mutated === original) { console.log(`FAIL       ${name}\n            file unchanged — NOTHING MUTATED.`); continue; }
  const path = place(mutated, 'm');
  if (readFileSync(path, 'utf8') === original) { console.log(`FAIL       ${name}\n            the written copy is identical — NOTHING MUTATED.`); continue; }
  const verdict = run(path);
  const label = verdict === 'red' ? 'CAUGHT    ' : verdict === 'pass' ? 'NOT CAUGHT' : 'HARNESS ERROR (no assertion failed; a crash is not a catch)';
  console.log(`${label} ${name}\n            (${why})`);
  if (verdict === 'red') caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log('COVERAGE: the day and site veto writers, their lifetimes, and the day, month and site readers in');
console.log('src/budget-helpers.js — 1 file. It does NOT run the Worker, and proves nothing');
console.log('about whether a veto occurred.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
