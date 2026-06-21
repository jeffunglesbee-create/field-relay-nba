// src/brief-freshness.js
// Brief Freshness Guard — cross-references published briefs against the
// change_log to flag briefs whose factual claims no longer match current
// data. Each materiality check is a named binary condition (RUWT-clean):
// no composite interest score, no editorial verdict.
//
// Depends on src/sync-reconciler.js (change_log table + getRecentChanges).

import { getRecentChanges } from './sync-reconciler.js';

// Sources whose changes might invalidate odds claims in a brief.
const _ODDS_SOURCES   = new Set(['odds_api', 'odds', 'odds_backfill', 'closing_odds_capture']);
const _LINEUP_SOURCES = new Set(['lineup']);
const _SAVANT_SOURCES = new Set(['savant']);
const _WEATHER_SOURCES = new Set(['weather']);
const _INJURY_SOURCES  = new Set(['injury']);

// Defensive JSON parse — returns null on any failure (including non-string
// input). The odds payload written by the reconciler is always a JSON
// string, but old_value can be null on first population.
function _safeParse(v) {
    if (v == null) return null;
    if (typeof v !== 'string') return null;
    try { return JSON.parse(v); } catch (_) { return null; }
}

// Did the favorite (the side with negative moneyline in American odds) flip
// between two odds snapshots? Returns false when either snapshot lacks a
// moneyline.home value, or when both sides have the same sign.
function _favoriteFlipped(oldOdds, newOdds) {
    const oh = oldOdds?.moneyline?.home;
    const nh = newOdds?.moneyline?.home;
    if (typeof oh !== 'number' || typeof nh !== 'number') return false;
    // Sign(0) = 0; treat 0 (no clear favorite) as unchanged either way.
    if (oh === 0 || nh === 0) return false;
    return (oh < 0) !== (nh < 0);
}

/**
 * Decide whether a single changelog entry makes a brief stale.
 *
 * @param {object} change - { source, field, old_value, new_value, ts }
 * @param {object} [brief] - optional { text, generated_at } for player-name
 *                           matching on injury changes
 * @returns {{ material: boolean, reason: string }}
 */
function isMaterialChange(change, brief) {
    if (!change || !change.source || !change.field) {
        return { material: false, reason: '' };
    }
    const src   = String(change.source).toLowerCase();
    const field = String(change.field).toLowerCase();

    // Odds — favorite flip is the only material odds change today. First
    // population (old_value === null) means the brief was written before
    // ANY odds existed; not material.
    if (_ODDS_SOURCES.has(src) &&
        (field.includes('opening_odds') || field.includes('closing_odds'))) {
        if (change.old_value == null) return { material: false, reason: '' };
        const oldOdds = _safeParse(change.old_value);
        const newOdds = _safeParse(change.new_value);
        if (!oldOdds || !newOdds) return { material: false, reason: '' };
        if (_favoriteFlipped(oldOdds, newOdds)) {
            return { material: true, reason: 'favorite_flipped' };
        }
        return { material: false, reason: '' };
    }

    // Lineup starter swap
    if (_LINEUP_SOURCES.has(src) && field.includes('starter')) {
        return { material: true, reason: 'starter_changed' };
    }

    // Savant — starter swap or xERA delta
    if (_SAVANT_SOURCES.has(src) &&
        (field.includes('starter') || field.includes('xera'))) {
        return { material: true, reason: 'starter_changed' };
    }

    // Weather — rain risk appearing or dome flag flipping
    if (_WEATHER_SOURCES.has(src) &&
        (field === 'rain_risk' || field === 'dome_flag')) {
        return { material: true, reason: 'rain_risk_appeared' };
    }

    // Injury — match against brief text when available; otherwise treat
    // any injury change for a referenced game as material.
    if (_INJURY_SOURCES.has(src)) {
        const text = brief?.text;
        if (!text) return { material: true, reason: 'injury_mentioned' };
        const newVal = String(change.new_value || '').toLowerCase();
        const lower  = String(text).toLowerCase();
        // Pull capitalised tokens from new_value, check brief mentions them.
        // Conservative: only triggers when the brief explicitly named the
        // player whose status changed.
        const tokens = newVal.split(/[\s,;.]+/).filter(t => t.length >= 4);
        for (const t of tokens) {
            if (lower.includes(t)) {
                return { material: true, reason: 'injury_mentioned' };
            }
        }
        return { material: false, reason: '' };
    }

    return { material: false, reason: '' };
}

/**
 * Cross-reference a brief set against the changelog. Returns one freshness
 * record per brief. Briefs without a generated_at fall back to midnight UTC
 * of any embedded date hint — the caller is expected to pass a sensible
 * generated_at when possible.
 *
 * @param {object} env - Worker env (must have ARCHIVE_DB)
 * @param {Array<{game_id, text?, generated_at?}>} briefs
 * @returns {Promise<Array<{ game_id, stale, stale_reason, superseded_by }>>}
 */
async function checkBriefFreshness(env, briefs) {
    if (!Array.isArray(briefs) || !briefs.length) return [];

    // 1. Earliest generated_at across the brief set — pull the changelog
    //    once for the whole window rather than per-brief. Treat missing
    //    timestamps as "0" (epoch) so we still see all relevant changes.
    let earliestMs = Infinity;
    for (const b of briefs) {
        const ts = _toMs(b.generated_at);
        if (Number.isFinite(ts) && ts < earliestMs) earliestMs = ts;
    }
    if (!Number.isFinite(earliestMs)) earliestMs = 0;
    const sinceIso = new Date(earliestMs).toISOString();

    // 2. Bulk-read changelog for the brief set. limit:200 captures a full
    //    night's worth of events; the default 20 would miss tail-end
    //    starter swaps when many odds writes are in flight.
    const gameIds = briefs.map(b => b.game_id).filter(Boolean);
    const changes = await getRecentChanges(env, {
        since: sinceIso,
        gameIds: gameIds.length ? gameIds : null,
        limit: 200,
        includeConsumed: true,
    });

    // 3. Index changes by game_id for fast per-brief lookup. Changes that
    //    arrived before a specific brief's generated_at are excluded
    //    inside the per-brief loop.
    const byGameId = new Map();
    for (const c of changes) {
        if (!c.game_id) continue;
        const arr = byGameId.get(c.game_id) || [];
        arr.push(c);
        byGameId.set(c.game_id, arr);
    }

    // 4. Per-brief materiality scan.
    return briefs.map(b => {
        const bMs = _toMs(b.generated_at);
        const candidates = (byGameId.get(b.game_id) || []).filter(c => {
            const cMs = _toMs(c.ts);
            return Number.isFinite(cMs) && cMs > bMs;
        });
        const superseded_by = [];
        let stale = false;
        let stale_reason = null;
        for (const c of candidates) {
            const { material, reason } = isMaterialChange(c, b);
            if (material) {
                if (!stale) {
                    stale = true;
                    stale_reason = reason;
                }
                superseded_by.push({
                    source: c.source,
                    field:  c.field,
                    old:    c.old_value,
                    new:    c.new_value,
                    ts:     c.ts,
                    reason,
                });
            }
        }
        return { game_id: b.game_id, stale, stale_reason, superseded_by };
    });
}

// Normalise generated_at / ts to millis. Accepts ISO strings, numeric
// milliseconds, numeric strings, or Date objects.
function _toMs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') {
        const n = Number(v);
        if (Number.isFinite(n) && n > 1e12) return n;          // ms epoch
        const d = Date.parse(v);
        return Number.isFinite(d) ? d : 0;
    }
    return 0;
}

export { isMaterialChange, checkBriefFreshness };
