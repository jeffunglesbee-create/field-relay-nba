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

const run = (path) => {
  try {
    execFileSync(process.execPath, ['scripts/check-ceiling-reached.mjs'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, BUDGET_HELPERS_SRC: path } });
    return true;
  } catch { return false; }
};

if (!run(resolve(SRC))) { console.log('FAIL — the check is already red on clean source.'); process.exit(1); }
if (!run(place(original, 'control'))) {
  console.log('FAIL — an UNMUTATED copy at the mutant location is red, so no verdict below would mean anything.');
  process.exit(1);
}
console.log('baseline: the check passes on current source and on an unmutated copy at the mutant location\n');

const MUTATIONS = [
  ['C1 the veto goes back to a boolean',
   "                await env.FIELD_JOURNALISM.put(warnedKey, new Date().toISOString(),\n                    { expirationTtl: 86400 });",
   "                await env.FIELD_JOURNALISM.put(warnedKey, '1', { expirationTtl: 86400 });",
   'THE STATE THIS ENDS: on 2026-09-19 the counter sat at the ceiling from before 19:39 until at least 22:32. A boolean says the cap was hit; it cannot say for how long, which is the difference between a budget spent and a service suppressed'],

  ['C2 the veto is written on EVERY refusal',
   '            const already = await env.FIELD_JOURNALISM.get(warnedKey);\n            if (!already) {',
   '            const already = null;\n            if (true) {',
   'a KV round trip on every vetoed call, for the hours a capped day keeps refusing — the write is once a day precisely so this field costs nothing'],

  ['C3 the reader infers the veto from the counter instead of the key',
   '            const raw = await env.FIELD_JOURNALISM.get(`odds:daily:${date}:warned`);',
   '            const raw = used >= ceiling ? true : null;',
   'a day that lands exactly on the cap at 23:58 turned nothing away; used === ceiling cannot tell that from a day that refused fetches for three hours'],

  ['C4 the three states collapse to two',
   "            if (raw) ceilingHit = /^\\d{4}-\\d{2}-\\d{2}T/.test(raw) ? raw : true;",
   '            if (raw) ceilingHit = true;',
   'a dated key and a legacy one read alike, so the hour is thrown away for every day that has it'],

  ['C5 an absent veto reads as false',
   '        let ceilingHit = null;',
   '        let ceilingHit = false;',
   'false reads as "checked, no veto today"; null is the only honest value for a read that found nothing (Rule 99)'],

  ['C6 an unreadable KV invents a veto',
   '        } catch (_) { ceilingHit = null; }',
   '        } catch (_) { ceilingHit = true; }',
   'a KV failure would report a ceiling that was never hit, and every watch reading this route would act on it'],

  ['C7 the field never reaches the response',
   '            ceiling_reached_at: ceilingHit,',
   '            // ceiling_reached_at removed',
   'a value only the worker knows is not an artifact — the whole reason this was invisible for the four days it has been happening'],
];

let caught = 0;
for (const [name, anchor, repl, why] of MUTATIONS) {
  const hits = original.split(anchor).length - 1;
  if (hits !== 1) { console.log(`FAIL       ${name}\n            anchor matched ${hits} times, expected 1 — NOTHING MUTATED.`); continue; }
  const mutated = original.replace(anchor, repl);
  if (mutated === original) { console.log(`FAIL       ${name}\n            file unchanged — NOTHING MUTATED.`); continue; }
  const path = place(mutated, 'm');
  if (readFileSync(path, 'utf8') === original) { console.log(`FAIL       ${name}\n            the written copy is identical — NOTHING MUTATED.`); continue; }
  const red = !run(path);
  console.log(`${red ? 'CAUGHT    ' : 'NOT CAUGHT'} ${name}\n            (${why})`);
  if (red) caught++;
}

console.log(`\n${caught} of ${MUTATIONS.length} mutations caught.`);
console.log('COVERAGE: the veto writer and reader in src/budget-helpers.js — 1 file. It');
console.log('does NOT run the Worker, and proves nothing about whether a veto occurred.');
process.exit(caught === MUTATIONS.length ? 0 : 1);
