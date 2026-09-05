#!/usr/bin/env node
// scripts/check-kv-provenance.mjs — every KV write records who wrote it, and the
// wrap that does it cannot break a write. Blocking in deploy.yml.
//
// The wrap sits on env at the two entry points, so it is invisible at the 62 put
// sites it covers. That is what makes it cheap, and also what makes it easy to
// delete by accident: nothing at a call site would look wrong afterwards, and
// nothing would fail. Writes would just quietly stop recording anything.

import { readFileSync } from 'node:fs';
import { withKvProvenance } from '../src/kv-provenance.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n         → ${detail}`}`);
  if (!ok) failed++;
};

const idx = readFileSync('src/index.js', 'utf8');

// ── 1. Wired at both entry points, and the wrapped env is the one used ───────
// The source it passes is a template containing `new URL(request.url).pathname`,
// so a [^)]* between the parens cannot match it -- the first draft of this check
// failed on correct code for that reason.
check('fetch wraps env and passes the WRAPPED env to the router',
  /const _env = withKvProvenance\(env,[\s\S]{0,120}?\n\s*const resp = await this\._fetch\(request, _env, ctx\)/.test(idx),
  'either the wrap is gone, or it is built and then the raw env is passed on — which looks correct and records nothing');
check('scheduled wraps env before any cron work',
  /async scheduled\(event, env, ctx\) \{[\s\S]{0,400}?env = withKvProvenance\(env,/.test(idx),
  'cron writes would go unrecorded');

// ── 2. The value is what matters and must not change ─────────────────────────
const calls = [];
const kv = {
  put: (k, v, o) => { calls.push({ k, v, o }); return Promise.resolve(); },
  get: k => Promise.resolve(`v:${k}`),
  getWithMetadata: k => Promise.resolve({ value: `v:${k}`, metadata: { _src: 'x' } }),
  list: () => Promise.resolve({ keys: [], list_complete: true }),
  delete: k => Promise.resolve(`deleted:${k}`),
};
const env = { FIELD_JOURNALISM: kv, PUSH_SUBS: kv, MCP_OAUTH: kv,
              ARCHIVE_DB: { prepare: () => 'stmt' }, GAME_DO: { idFromName: () => 'id' },
              ODDS_API_KEY: 'must-not-be-touched' };
const w = withKvProvenance(env, 'route:/test');

// 16 of the 62 writes store the bare string '1'. If the wrap ever moves to
// wrapping VALUES instead of using metadata, this is the check that fails.
await w.FIELD_JOURNALISM.put('gate:key', '1', { expirationTtl: 86400 });
check('a bare "1" is stored as "1", byte for byte', calls[0].v === '1',
  `stored ${JSON.stringify(calls[0].v)} — every "if (await KV.get(k))" reader depends on this`);
check('existing options survive', calls[0].o.expirationTtl === 86400);
check('metadata records the writer', calls[0].o.metadata._src === 'route:/test');
check('metadata records a real timestamp',
  Math.abs(Date.now() - Date.parse(calls[0].o.metadata._at)) < 5000);

// A counter, stored as a bare number-string.
await w.FIELD_JOURNALISM.put('odds:credits:2026-09', String(5749), { expirationTtl: 60 });
check('a bare counter stays parseable', parseInt(calls[1].v, 10) === 5749);

// Caller-supplied metadata must not be destroyed.
await w.FIELD_JOURNALISM.put('k', 'v', { metadata: { mine: 1 } });
check('caller metadata is merged, not replaced',
  calls[2].o.metadata.mine === 1 && !!calls[2].o.metadata._src);

// ── 3. Everything else passes through untouched ──────────────────────────────
check('get is untouched', (await w.FIELD_JOURNALISM.get('k')) === 'v:k');
check('delete is untouched', (await w.FIELD_JOURNALISM.delete('k')) === 'deleted:k');
check('list is untouched', Array.isArray((await w.FIELD_JOURNALISM.list()).keys));
check('getWithMetadata is untouched', (await w.FIELD_JOURNALISM.getWithMetadata('k')).value === 'v:k');
check('non-KV bindings are the same object', w.ARCHIVE_DB === env.ARCHIVE_DB && w.GAME_DO === env.GAME_DO);
check('secrets read through unchanged', w.ODDS_API_KEY === 'must-not-be-touched');
check('all three KV bindings are wrapped',
  ['FIELD_JOURNALISM', 'PUSH_SUBS', 'MCP_OAUTH'].every(b => w[b] !== env[b]));

// ── 4. Provenance must never cost a write ────────────────────────────────────
let raw = 0;
const hostile = { put: (k, v, o) => { raw++; return Promise.resolve('written'); } };
Object.defineProperty(hostile, 'metadataTrap', { get() { throw new Error('boom'); } });
const w2 = withKvProvenance({ FIELD_JOURNALISM: hostile }, { toString() { throw new Error('bad src'); } });
let wrote = null;
try { wrote = await w2.FIELD_JOURNALISM.put('k', 'v'); } catch (_) { wrote = 'THREW'; }
check('a throw while building provenance still writes the value',
  wrote === 'written' && raw === 1,
  'the write was lost to a diagnostic — the value is the point, provenance is the bonus');

check('a null env does not explode', withKvProvenance(null, 'x') === null);

// ── 5. The read path exists, or the write is asserted rather than verified ───
check('/provenance/kv exists to read the metadata back',
  idx.includes("pathname === '/provenance/kv'"),
  'a write recording provenance nothing can retrieve has not been verified');
check('the read path never returns stored values',
  !/\/provenance\/kv[\s\S]{0,2600}?value:/.test(idx),
  'the survey must return keys, ages and writers — never content');

console.log(failed === 0 ? '  PASS' : `  FAIL — ${failed}`);
process.exit(failed === 0 ? 0 : 1);
