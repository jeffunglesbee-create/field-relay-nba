#!/usr/bin/env node
// No multi-row INSERT may exceed D1's bound-parameter cap.
//
// WRITTEN FROM A LIVE FAILURE, not a principle. On 2026-09-13 the collision
// cleanup deleted 82 archive rows and then died on its change_log batch:
//
//     D1_ERROR: too many SQL variables at offset 414
//
// 40 rows x 6 columns is 240 against a cap of 100. The archive changed and the
// record of the change did not, because the failure landed between the two.
//
// The delete in the same script batched 50 and was fine — it binds ONE
// parameter per row. So the bug is not "the chunk was too big", it is "the
// chunk size was a constant that did not know the column count". This check
// requires every such size to be DERIVED from the columns it batches, which is
// the only form that stays correct when a column is added.
import { readFileSync, readdirSync } from 'node:fs';

const CAP = 100;
let checked = 0, failed = 0;
const eq = (label, got, want) => {
  checked++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

// Files that build a multi-row VALUES list. Found by shape, not by a hand-kept
// list, so a new one cannot be added without this check seeing it.
const files = readdirSync('scripts').filter(f => f.endsWith('.mjs'))
  .map(f => `scripts/${f}`)
  .filter(f => /\(\?(?:, \?)+\)'\)\.join/.test(readFileSync(f, 'utf8')));

eq('at least one multi-row INSERT site exists to check', files.length > 0, true);

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // The row template names the column count directly: '(?, ?, ?, ?, ?, ?)'.
  const tpl = src.match(/'\((\?(?:, \?)+)\)'/);
  const columns = tpl ? tpl[1].split(',').length : 0;
  eq(`${f}: the row template is readable`, columns > 0, true);

  // A literal chunk size next to that template is the defect. The size must be
  // computed from the column count.
  const derived = /Math\.floor\(\s*D1_MAX_BOUND_PARAMS\s*\/\s*[A-Z_]*COLUMNS?[A-Z_]*\s*\)/.test(src)
               || /Math\.floor\(\s*\d+\s*\/\s*[A-Za-z_]*[Cc]olumns?\b/.test(src);
  eq(`${f}: its batch size is derived from the column count, not chosen`, derived, true);

  // And the derived size must actually fit.
  const capDecl = src.match(/D1_MAX_BOUND_PARAMS\s*=\s*(\d+)/);
  const declared = capDecl ? Number(capDecl[1]) : CAP;
  eq(`${f}: the declared cap is not above D1's ${CAP}`, declared <= CAP, true);
  eq(`${f}: ${Math.floor(declared / columns)} rows x ${columns} columns fits under ${CAP}`,
     Math.floor(declared / columns) * columns <= CAP, true);
}

console.log(`\n${failed ? 'FAILED' : 'PASS'}: ${checked - failed}/${checked} assertions`
          + ` — ${files.length} multi-row INSERT site(s) found by shape, cap ${CAP}`);
process.exit(failed ? 1 : 0);
