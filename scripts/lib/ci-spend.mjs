// CI credits inside a time window, shared rather than copied.
//
// Extracted from watch-odds-pairing-rate.mjs on 2026-09-19 so the
// daily-vs-vendor watch can subtract the same number the same way. A second
// copy would drift, and the two watches would then disagree about how much of
// a discrepancy is already explained — which is the one thing they must agree
// on to be read side by side.
//
// Importing it from the pairing watch directly is not an option: that file's
// live half runs at module top level, so an import would fire its network
// calls. Extraction is the fix, not a wrapper.
import { asUtc } from './utc.mjs';

export function ciSpendInInterval(rows, fromISO, toISO) {
  const from = Date.parse(fromISO), to = Date.parse(toISO);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { credits: 0, runs: 0, undated: 0 };
  let credits = 0, runs = 0, undated = 0;
  for (const r of rows || []) {
    const at = asUtc(r.completed_at);
    // A row with no usable timestamp cannot be placed in or out of the window.
    // It is COUNTED SEPARATELY, never silently treated as outside it — that
    // would inflate the subtraction and shrink the residual on no evidence.
    if (!Number.isFinite(at)) { undated++; continue; }
    if (at < from || at > to) continue;
    const c = Number(r.credits_used);
    if (!Number.isFinite(c)) { undated++; continue; }
    credits += c; runs++;
  }
  return { credits, runs, undated };
}
