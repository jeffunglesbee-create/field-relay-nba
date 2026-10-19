#!/usr/bin/env node
// docs/CC-CMD-2026-10-19-cfb-stage2-wrong-pair.md TASK 1: the measurement the
// stage-2 side rule was chosen from. Offline over the committed census export.
//
//   node scripts/measure-stage2-side-rule.mjs [outbox/fixture-odds-pairs-2026-10-19.json]
//
// Two variants of "the unread side keeps the vendor name's first letter":
//   firstFirst  the shipped couldAbbreviate, imported, not copied: the vendor
//               name's FIRST word, or containment of that word (4+ letters)
//   firstAny    ANY vendor word's first letter, or containment of any vendor
//               word (4+ letters); the alternative that was not chosen
// For each: which of the 49 one-sided stored pairs it refuses, and its exposure,
// the share of (archive name, vendor team it does not name-match) combinations
// in MLB, NHL and CFB that still pass. Exposure is the rate at which a wrong team
// would be accepted.
import { readFileSync } from 'node:fs';
import { nameMatches, teamTokens, couldAbbreviate } from '../src/odds-name-match.js';
const parsed = JSON.parse(readFileSync(process.argv[2] || 'outbox/fixture-odds-pairs-2026-10-19.json', 'utf8'));
const rows = Array.isArray(parsed) ? parsed : parsed.rows;
const strip = (n) => { const t = teamTokens(n); return t[0] === 'the' ? t.slice(1) : t; };
const variants = {
  firstFirst: couldAbbreviate,
  firstAny: (a, v) => { const A = strip(a), V = strip(v); if (!A.length || !V.length) return false;
    return V.some(y => y[0] === A[0][0]) || A.some(x => V.some(y => y.length >= 4 && x.includes(y))); },
};
const t = (s) => Date.parse(s || '');
const one = [];
for (const r of rows) {
  const hh = nameMatches(r.a_home, r.v_home), aa = nameMatches(r.a_away, r.v_away);
  const ah = nameMatches(r.a_away, r.v_home), ha = nameMatches(r.a_home, r.v_away);
  if ((hh && aa) || (ah && ha) || !(hh || aa || ah || ha)) continue;
  const [an, vn] = hh ? [r.a_away, r.v_away] : aa ? [r.a_home, r.v_home] : ah ? [r.a_home, r.v_away] : [r.a_away, r.v_home];
  const gap = Number.isFinite(t(r.commence_time)) && Number.isFinite(t(r.start_time)) ? Math.round((t(r.commence_time) - t(r.start_time)) / 60000) : null;
  one.push({ r, an, vn, gap });
}
console.log('one-sided', one.length);
for (const [name, f] of Object.entries(variants)) {
  const acc = one.filter(o => f(o.an, o.vn)), rej = one.filter(o => !f(o.an, o.vn));
  console.log(`\n${name}: accepted ${acc.length}, refused ${rej.length}`);
  for (const o of rej) console.log(`   refused: ${o.an} vs ${o.vn} gap ${o.gap}`);
  for (const o of acc.filter(o => o.gap != null && Math.abs(o.gap) > 300)) console.log(`   ACCEPTED far: ${o.an} vs ${o.vn} gap ${o.gap}`);
  // exposure: archive unmatched names vs every OTHER vendor team in the same sport (any date)
  let tried = 0, passed = 0; const ex = [];
  const vendorTeams = new Map();
  for (const x of rows) { const s = vendorTeams.get(x.sport) || new Set(); s.add(x.v_home); s.add(x.v_away); vendorTeams.set(x.sport, s); }
  // nickname exposure: every archive team name in MLB/NHL vs every vendor team of that sport it does NOT name-match
  for (const sport of ['MLB', 'NHL', 'CFB']) {
    const arch = new Set(rows.filter(x => x.sport === sport).flatMap(x => [x.a_home, x.a_away]));
    let tr = 0, ps = 0;
    for (const a of arch) for (const v of vendorTeams.get(sport) || []) { if (nameMatches(a, v)) continue;
      // skip the true team: the vendor team the archive name was paired to by a both-sides row
      tr++; if (f(a, v)) ps++; }
    console.log(`   exposure ${sport}: ${ps} of ${tr} (archive name, non-matching vendor team) combos pass = ${(100*ps/tr).toFixed(1)}%`);
  }
}
