#!/usr/bin/env node
// One-shot data fix: collapse the stray 'UEFA Conference League' label variant
// into the declared 'UEFA Europa Conference League'.
//
// WHY (CC-CMD-2026-08-20-uefa-club-competitions, follow-up):
// uefa-archive-probe.mjs found exactly one row in regular_season_games carrying
// a UEFA label outside the six declared strings:
//
//   id         2026-05-27-conference-crystalpalace-rayovallecano
//   sport      'UEFA Conference League'      (declared: 'UEFA Europa Conference League')
//   date       2026-05-27  Crystal Palace v Rayo Vallecano
//   created_at 2026-07-05
//
// Its id uses the lowercase-slug form {date}-{comp}-{home}-{away}, matching the
// early-July hand-seeded schedule import rather than the cron seed's
// {sport}_{date}_{home}_{away}. No live writer emits this label. This is the
// WC26 label-fragmentation class: the archive `sport` string is also the leading
// segment of the archive id, so each variant is a separate id namespace for one
// competition.
//
// SAFETY, because this mutates live D1:
//   * Targeted by primary-key id, never by label alone -- a WHERE on the label
//     would silently rewrite any future row that happens to share it.
//   * Asserts the exact pre-state before writing. If the row is missing, or its
//     sport is anything other than the expected variant, it does NOT write.
//   * Idempotent: re-running after success is a reported no-op, not a second
//     write and not a failure.
//   * Re-reads the row afterwards and fails unless it holds the target label.
//   * Leaves `id` untouched. The id is a stored column here, not derived at read
//     time, and this row's id was never sport-derived to begin with, so rewriting
//     it would break any existing reference for no gain.
//
// Requires --apply to write. Without it, runs read-only and reports the plan.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const APPLY = process.argv.includes('--apply');

const TARGET_ID = '2026-05-27-conference-crystalpalace-rayovallecano';
const FROM_LABEL = 'UEFA Conference League';
const TO_LABEL = 'UEFA Europa Conference League';

async function d1(sql, params = []) {
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: {
            'X-FIELD-Relay': 'field-relay-cron-2026',
            'Content-Type': 'application/json',
            'User-Agent': UA,
        },
        body: JSON.stringify({ sql, params }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
    let j;
    try { j = JSON.parse(text); } catch { throw new Error(`non-JSON: ${text.slice(0, 300)}`); }
    if (j.ok === false) throw new Error(`relay error: ${j.error}`);
    return j;
}

const m = {
    ran_at: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    target_id: TARGET_ID,
    from_label: FROM_LABEL,
    to_label: TO_LABEL,
    query_ok: false,
    pre_state: null,
    precondition_met: false,
    already_correct: false,
    applied: false,
    post_state: null,
    verified: false,
    // Read-only survey: is this variant the only soccer label fragmentation in
    // the games table, or the visible edge of a wider one? Reported, not acted on.
    soccer_labels_after: [],
    error: null,
};

try {
    const pre = await d1(
        `SELECT id, sport, date, home, away, created_at FROM regular_season_games WHERE id = ?`,
        [TARGET_ID]);
    m.pre_state = pre.results?.[0] ?? null;
    m.query_ok = true;

    if (!m.pre_state) {
        throw new Error(`row ${TARGET_ID} not found — refusing to write`);
    }
    if (m.pre_state.sport === TO_LABEL) {
        m.already_correct = true;
        m.precondition_met = true;
        m.verified = true;
        m.post_state = m.pre_state;
        console.log(`NO-OP: row already carries '${TO_LABEL}'.`);
    } else if (m.pre_state.sport !== FROM_LABEL) {
        throw new Error(
            `precondition failed — expected sport '${FROM_LABEL}' or '${TO_LABEL}', ` +
            `found '${m.pre_state.sport}'. Refusing to write.`);
    } else {
        m.precondition_met = true;
        if (!APPLY) {
            console.log(`DRY RUN — would set sport '${FROM_LABEL}' -> '${TO_LABEL}' on ${TARGET_ID}`);
        } else {
            // Both id AND the expected current label in the WHERE: if anything
            // changed the row between the read above and this write, it matches
            // zero rows rather than clobbering a newer value.
            const res = await d1(
                `UPDATE regular_season_games SET sport = ? WHERE id = ? AND sport = ?`,
                [TO_LABEL, TARGET_ID, FROM_LABEL]);
            const changed = res.meta?.changes ?? res.meta?.changed_db ?? null;
            console.log(`UPDATE issued; meta: ${JSON.stringify(res.meta)}`);
            m.applied = true;
            m.rows_changed = changed;
        }
    }

    if (APPLY || m.already_correct) {
        const post = await d1(
            `SELECT id, sport, date, home, away, created_at FROM regular_season_games WHERE id = ?`,
            [TARGET_ID]);
        m.post_state = post.results?.[0] ?? null;
        m.verified = m.post_state?.sport === TO_LABEL;
    }

    const labels = await d1(
        `SELECT sport, COUNT(*) AS n FROM regular_season_games
         WHERE sport LIKE 'UEFA%' OR sport LIKE '%League%' OR sport LIKE '%Cup%'
         GROUP BY sport ORDER BY n DESC`);
    m.soccer_labels_after = (labels.results || []).map(r => ({ sport: r.sport, rows: r.n }));
} catch (e) {
    m.error = String(e.message || e);
}

const stamp = m.ran_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const out = `outbox/uefa-label-fix-manifest-${stamp}.json`;
writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
console.log(JSON.stringify(m, null, 2));
console.log(`\nwrote ${out}`);

if (m.error) { console.error(`FAILED: ${m.error}`); process.exit(1); }
if (!APPLY) { console.log('Dry run complete — no write performed. Re-run with --apply.'); process.exit(0); }
if (!m.verified) { console.error('FAILED: post-state does not carry the target label.'); process.exit(1); }
console.log(`PASS: ${TARGET_ID} now carries '${TO_LABEL}'.`);
process.exit(0);
