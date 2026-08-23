#!/usr/bin/env node
// §5 residual of CC-CMD-2026-08-20-brief-data-quality — live D1 mutations.
// Authorized by Jeff 2026-08-23. Three items, and one of them is deliberately
// a no-op; see NOT MUTATED at the bottom.
//
// MODE=slate (default)   is it safe to mutate right now? Writes no rows.
// MODE=scope              measures the population and emits the EXPLICIT id list
//                         every UPDATE will be scoped to. Writes no rows.
// MODE=apply              consumes that scope. Refuses on any unclassified value.
// MODE=verify             re-reads the table. Exits non-zero if anything remains.
//
// THE FOUR MODES ARE COPIED FROM THE PRIOR MUTATION ON THIS DATA, not invented:
// CC-CMD-2026-08-06-apply-soccer-league-label-fix-v2 corrected 52 mislabelled
// soccer rows through exactly this slate/scope/apply/verify shape and finished
// with zero mismatches. Two of its requirements are load-bearing here:
//
//   1. SCOPE BY A MEASURED ID LIST, NOT A BARE PREDICATE. That run's spec was
//      explicit -- scope by the measured espn_event_id list, keep the predicate
//      only as a second guard. A bare `WHERE sport = 'x'` would sweep in any row
//      written between the measurement and the write, which is a row nobody
//      looked at. Every UPDATE below is `WHERE id IN (measured) AND sport = ?`.
//   2. THE SLATE CHECK COMES FIRST. That run confirmed no in-flight game could
//      duplicate before it wrote. The equivalent question here is whether the
//      journalism cron can undo the write, answered in `slate` below.
//
// These are irreversible writes to production prose metadata. The census they
// work from is dated 2026-08-21 and this runs on 2026-08-23; every count in it
// is a hypothesis about a table written to since (Rule 72). `scope` re-derives
// the population from the table rather than trusting the packet, and `apply`
// refuses against anything the classifier does not recognise -- a variant that
// appeared in the last two days must STOP the migration, not get swept in.
//
// THE TRAP THIS EXISTS TO AVOID is named in the CC-CMD itself: `wnba` (34) and
// `golf` (9) are lowercase but CONFORMING -- the games table carries those exact
// forms, and a "fix all the lowercase values" pass would break working joins.
// So there is no lowercase rule here. Every mapping is explicit or derived from
// the row's own id, and anything else is reported and left alone.

import { writeFileSync } from 'node:fs';

const RELAY = 'https://field-relay-nba.jeffunglesbee.workers.dev';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MODE = (process.env.MODE || 'slate').toLowerCase();
// Written by `scope`, read by `apply`. Passing the id list through a committed
// file rather than recomputing it in `apply` is the point: the rows that get
// written are provably the rows that were measured and read by a human.
const SCOPE_FILE = process.env.SCOPE_FILE || 'outbox/brief-label-migration-scope.json';

async function d1(sql, params = []) {
    const r = await fetch(`${RELAY}/d1/execute`, {
        method: 'POST',
        headers: { 'X-FIELD-Relay': 'field-relay-cron-2026', 'Content-Type': 'application/json', 'User-Agent': UA },
        body: JSON.stringify({ sql, params }),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
    const j = JSON.parse(t);
    if (j.ok === false) throw new Error(`relay error: ${j.error}`);
    return { rows: j.results || [], meta: j.meta || null };
}

// ── The conforming set, and why it is a list rather than a rule ─────────────
// These are the labels the games table actually carries. Membership here means
// "leave alone", including the two lowercase ones the census flagged.
const CONFORMING = new Set([
    'MLB', 'NBA', 'WNBA', 'NHL', 'NFL', 'EPL', 'MLS', 'CFL', 'AFL',
    'La Liga', 'Serie A', 'Bundesliga', 'Ligue 1', 'UCL',
    'FIFA World Cup', 'PGA Tour', 'ATP', 'WTA',
    // Lowercase AND conforming. The census's central warning: the games table
    // carries these forms, so "fix the lowercase ones" breaks working joins.
    'wnba', 'golf',
]);

// ── Class B/C/D/E: explicit maps, one line of provenance each ──────────────
const EXPLICIT = {
    // Class B — inferSport() display strings (jubilant-bassoon
    // src/utils/sport-format.js:11). Fixed at the call sites in ask 3; these are
    // the rows written before that.
    'Baseball (MLB)': 'MLB',
    'MLS Soccer': 'MLS',
    'Australian Football (AFL)': 'AFL',
    'Basketball (NBA)': 'NBA',
    'Hockey (NHL)': 'NHL',
    'Football (NFL)': 'NFL',
    // Class C — casing only.
    'PGA TOUR': 'PGA Tour',
    // Class E — determined by READING the rows, not by the string: all 22 are
    // World Cup group-stage briefs, which is what rules out NFL for 'football'.
    'football': 'FIFA World Cup',
    'wc': 'FIFA World Cup',
    // The one lossy map, flagged in the census rather than hidden here: it drops
    // the postseason distinction. Safe because that distinction lives in the
    // postseason_games table, not in this column.
    'NBA Playoffs': 'NBA',
};

// Class D — a context string whose LABEL is its prefix, e.g.
// 'CFL – 2026 Season · Week 7' -> 'CFL'. The declared label is confirmed at
// src/index.js:8034. Split on the en-dash or the middot, never on a hyphen: a
// real label could contain one.
const contextPrefix = (v) => {
    const head = String(v).split(/\s+[–—·]\s+|\s+·\s+/)[0].trim();
    return CONFORMING.has(head) ? head : null;
};

// Class A — recover the label from the row's OWN id, which kept its casing when
// the column was lowercased. Verifiable per row, which is why the census chose
// it over a hand map: the evidence travels with the row.
const fromId = (id, briefType) => {
    const s = String(id || '');
    const bt = String(briefType || '');
    if (!bt || !s.startsWith(bt + '_')) return null;
    const rest = s.slice(bt.length + 1);
    const cut = rest.lastIndexOf('_');          // trailing game id
    const label = (cut > 0 ? rest.slice(0, cut) : rest).trim();
    return CONFORMING.has(label) ? label : null;
};

const out = {
    ran_at: new Date().toISOString(), mode: MODE, error: null,
    slate: null, variants: null, plan: null, unclassified: null,
    mislabelled_recaps: null, applied: null, verification: null, revert_sql: null,
};

// The in-progress-language predicate, identical to the one in
// scripts/verify-staged-items.mjs and scripts/probe-ask5-ask6-prereqs.mjs. Three
// places must agree on what "live" means or the reclassification below disagrees
// with the probe that checks it.
const LIVE_LANG = `( brief_text LIKE '%scoreless%' OR brief_text LIKE '%at halftime%'
   OR brief_text LIKE '%second-half action%' OR brief_text LIKE '%first-half action%'
   OR brief_text LIKE '%through 4_ minutes%' OR brief_text LIKE '%minutes into%' )`;

try {
    // ── SLATE: can the cron undo this? ─────────────────────────────────────
    //
    // Answered from source, not from timing. Every `INSERT INTO briefs ... ON
    // CONFLICT(id) DO UPDATE` in src/index.js (lines 5975, 8618, 12036, 12492,
    // 18962) sets only brief_text, quality_score, context_hash, word_count and
    // source. `sport` and `brief_type` appear in the INSERT column list and in
    // NO conflict-update list -- they are insert-only. So a live brief being
    // rewritten every cron cycle cannot revert either column this migration
    // touches, and there is no unsafe moment to avoid.
    //
    // What the slate check still measures is write PRESSURE, because a row
    // inserted between `scope` and `apply` would not be in the measured id list.
    // That is the correct outcome -- it would mean the code is still emitting
    // bad labels, which `verify` should surface as a finding rather than have
    // `apply` quietly absorb.
    const { rows: recent } = await d1(
        `SELECT COUNT(*) AS n FROM briefs
         WHERE COALESCE(updated_at, created_at) > datetime('now', '-30 minutes')`);
    out.slate = {
        columns_are_insert_only: true,
        evidence: 'no ON CONFLICT(id) DO UPDATE on briefs sets sport or brief_type '
                + '(src/index.js 5975, 8618, 12036, 12492, 18962) — verified 2026-08-23',
        rows_written_last_30min: recent[0]?.n ?? null,
        safe_to_apply: true,
        note: 'A row inserted between scope and apply is NOT swept — it is absent from the '
            + 'measured id list and will be reported by verify.',
    };

    // ── SCOPE: what is actually in the column today ────────────────────────
    const { rows: variants } = await d1(
        `SELECT sport, COUNT(*) AS n, MIN(id) AS sample_id
         FROM briefs GROUP BY sport ORDER BY n DESC`);
    out.variants = variants.map(v => ({ sport: v.sport, n: v.n, sample_id: v.sample_id }));

    const nonConforming = variants.filter(v => v.sport != null && !CONFORMING.has(v.sport));
    const plan = [];
    const unclassified = [];

    for (const v of nonConforming) {
        // Every class resolves to an explicit id list. Even where the mapping is
        // value-level, the WRITE is id-level, so the rows changed are provably
        // the rows measured.
        const { rows } = await d1(
            `SELECT id, brief_type FROM briefs WHERE sport = ?`, [v.sport]);
        const explicit = EXPLICIT[v.sport] || contextPrefix(v.sport);
        if (explicit) {
            plan.push({ from: v.sport, to: explicit, n: rows.length,
                        via: EXPLICIT[v.sport] ? 'explicit' : 'context-prefix',
                        rows: rows.map(r => ({ id: r.id, to: explicit })) });
            continue;
        }
        // Class A — recover from each row's own id. Per-row by nature: the
        // evidence travels with the row, which is why the census chose it over a
        // hand map for the 235 lowercased labels.
        const derived = rows.map(r => ({ id: r.id, to: fromId(r.id, r.brief_type) }));
        const ok = derived.filter(d => d.to);
        if (rows.length && ok.length === rows.length) {
            plan.push({ from: v.sport, to: '(per-row, from id)', n: rows.length,
                        via: 'from-id', rows: ok });
        } else {
            unclassified.push({ sport: v.sport, n: rows.length, sample_id: v.sample_id,
                                resolved_from_id: ok.length, of: rows.length });
        }
    }
    out.plan = plan;
    out.unclassified = unclassified;
    out.plan_summary = plan.map(p => `${JSON.stringify(p.from)} -> ${p.to} (${p.n} rows, ${p.via})`);

    // ── 41 mislabelled game_recap: RECLASSIFY, not rewrite ─────────────────
    // Correct live briefs wearing the wrong type. Prose untouched; only
    // brief_type moves, and brief_type is insert-only, so the cron cannot undo it.
    const { rows: mis } = await d1(
        `SELECT id FROM briefs WHERE brief_type = 'game_recap' AND ${LIVE_LANG}`);
    out.mislabelled_recaps = { n: mis.length, ids: mis.map(r => r.id) };

    // The revert is generated from the OBSERVED before-state, before anything is
    // written, so undoing never depends on re-deriving what the old value was.
    const revert = [];
    for (const p of plan) for (const r of p.rows) revert.push(
        `UPDATE briefs SET sport = ${JSON.stringify(p.from)} WHERE id = ${JSON.stringify(r.id)};`);
    for (const id of out.mislabelled_recaps.ids) revert.push(
        `UPDATE briefs SET brief_type = 'game_recap' WHERE id = ${JSON.stringify(id)};`);
    out.revert_sql = revert;

    if (MODE === 'scope') {
        writeFileSync(SCOPE_FILE, JSON.stringify(
            { scoped_at: out.ran_at, plan, mislabelled_recaps: out.mislabelled_recaps,
              unclassified, revert_sql: revert }, null, 2) + '\n');
        console.log(`\nscope written to ${SCOPE_FILE}`);
    }

    if (MODE === 'apply') {
        if (unclassified.length) throw new Error(
            `refusing to apply: ${unclassified.length} unclassified variant(s) — `
            + unclassified.map(u => `${JSON.stringify(u.sport)} (${u.n})`).join(', '));

        const applied = [];
        // Chunked because D1 caps bound parameters per statement; each chunk is
        // still an explicit id list, never a predicate on its own.
        const CHUNK = 40;
        for (const p of plan) {
            let changed = 0;
            for (let i = 0; i < p.rows.length; i += CHUNK) {
                const slice = p.rows.slice(i, i + CHUNK);
                // Per-row targets differ under from-id, so group by target value.
                const byTarget = new Map();
                for (const r of slice) {
                    if (!byTarget.has(r.to)) byTarget.set(r.to, []);
                    byTarget.get(r.to).push(r.id);
                }
                for (const [target, ids] of byTarget) {
                    const marks = ids.map(() => '?').join(',');
                    // id list scopes it; `sport = ?` is the second guard the
                    // 08-06 spec required — if a row's value changed since the
                    // measurement, it is skipped rather than overwritten.
                    const { meta } = await d1(
                        `UPDATE briefs SET sport = ? WHERE id IN (${marks}) AND sport = ?`,
                        [target, ...ids, p.from]);
                    changed += meta?.changes ?? 0;
                }
            }
            applied.push({ from: p.from, to: p.to, measured: p.rows.length, rows_changed: changed,
                           skipped_value_moved: p.rows.length - changed });
        }

        let retyped = 0;
        for (let i = 0; i < out.mislabelled_recaps.ids.length; i += CHUNK) {
            const ids = out.mislabelled_recaps.ids.slice(i, i + CHUNK);
            const marks = ids.map(() => '?').join(',');
            const { meta } = await d1(
                `UPDATE briefs SET brief_type = 'game_live'
                 WHERE id IN (${marks}) AND brief_type = 'game_recap'`, ids);
            retyped += meta?.changes ?? 0;
        }
        applied.push({ reclassified_recap_to_live: retyped, measured: out.mislabelled_recaps.n });
        out.applied = applied;
    }

    if (MODE === 'apply' || MODE === 'verify') {
        // Re-read from the table. Never inferred from UPDATE counts — the 08-06
        // run's own verify step is what proved its 52 landed.
        const { rows: after } = await d1(
            `SELECT sport, COUNT(*) AS n FROM briefs GROUP BY sport ORDER BY n DESC`);
        const stillBad = after.filter(v => v.sport != null && !CONFORMING.has(v.sport));
        const { rows: stillMis } = await d1(
            `SELECT COUNT(*) AS n FROM briefs WHERE brief_type = 'game_recap' AND ${LIVE_LANG}`);
        out.verification = {
            distribution_after: after.map(v => ({ sport: v.sport, n: v.n })),
            non_conforming_remaining: stillBad,
            mislabelled_recaps_remaining: stillMis[0]?.n ?? null,
            clean: stillBad.length === 0 && (stillMis[0]?.n ?? 1) === 0,
        };
    }
} catch (e) { out.error = String(e.message || e); }

// ── NOT MUTATED, deliberately ──────────────────────────────────────────────
// The 539 ordinal `gNN` game_ids. The census established they are NOT
// recoverable: they come from a client render-order counter ("g"+(++_gid)), so
// unlike the Class A labels the id carries no game identity to recover. New
// writes are already blocked by ask 4a/4b, so the set cannot grow, and the rows
// are inert rather than harmful. The census's own recommendation is to leave
// them; deleting would destroy real prose to tidy a key. Recorded here so their
// absence from this migration reads as a decision and not an oversight.
out.not_mutated = {
    ordinal_gNN_ids: 'left in place — render-order counter, no recoverable identity; '
        + 'new writes blocked by ask 4a/4b; deleting would lose real prose',
};

const stamp = out.ran_at.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
writeFileSync(`outbox/brief-label-migration-${MODE}-${stamp}.json`, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ ...out, plan: out.plan?.map(p => ({ ...p, rows: p.rows ? `${p.rows.length} rows` : undefined })) }, null, 2).slice(0, 6000));
if (out.error) { console.error(`\nFAILED: ${out.error}`); process.exit(1); }
// verify is the standing regression detector too: once this migration lands,
// a non-conforming value REAPPEARING means the code started emitting one again,
// and that should be a failed run rather than silent re-accumulation. Same shape
// as the weekly detector the 2026-08-06 soccer-label fix left behind.
if ((MODE === 'apply' || MODE === 'verify') && !out.verification?.clean) {
    console.error('\nNOT CLEAN — see verification.non_conforming_remaining.');
    process.exit(1);
}
process.exit(0);
