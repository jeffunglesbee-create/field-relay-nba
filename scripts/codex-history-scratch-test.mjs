// CC-CMD-2026-09-07-codex-write-nondestructive-and-recovery — TASK 1 verification.
//
// Writes twice to a scratch key through the REAL `codex_write` MCP tool and
// confirms the first body survives in `codex_history`. Deletes the scratch key
// afterwards, from both tables.
//
// WHY IT GOES THROUGH /mcp RATHER THAN /d1/execute. The guard lives inside the
// `codex_write` handler. A test that issued the two INSERTs directly would be
// testing SQL this script wrote, not the code path a careless caller takes —
// which is the whole subject. The reads use /d1/execute because reading is not
// the thing under test.
//
// THE THIRD WRITE IS THE TEETH (Rule 90). A guard that journalled on EVERY write
// regardless of change would pass the first assertion and be wrong: it would
// grow a history row per no-op rewrite forever. So the same body is written a
// second time and the history count must NOT move. Without that, "the first body
// survives" is satisfied by "copy everything, always", and the two are
// indistinguishable from the outside.

const RELAY = process.env.RELAY_BASE || 'https://field-relay-nba.jeffunglesbee.workers.dev';

// Variables, never values — check-exposed-secrets.mjs is a ratchet on hard-coded
// uses. No defaults: an unset secret must be distinguishable from a set one
// before the relay 401s.
const RELAY_GATE = process.env.RELAY_SHARED_SECRET;
const MCP_SECRET = process.env.FIELD_MCP_SECRET;

const need = (v, name) => {
  if (!v) { console.error(`${name} is not set. This script will not guess it.`); process.exit(1); }
  return v;
};

// Namespaced and timestamped. A fixed scratch key would collide with a
// concurrent run and with its own uncleaned remains from a previous failure.
const KEY = `scratch/codex-history-selftest/${new Date().toISOString().replace(/[:.]/g, '-')}`;
const BODY_A = `FIRST BODY — written at ${new Date().toISOString()}. If the guard works, this survives in codex_history after BODY_B replaces it.`;
const BODY_B = 'SECOND BODY — the overwrite. In the 2026-09-08 incident this is where 26 real cc-cmd-queue bodies went.';

let failed = 0;
const results = [];
const assert = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok && detail) console.log(`      → ${detail}`);
  if (!ok) failed++;
};

async function mcpCall(name, args) {
  const r = await fetch(`${RELAY}/mcp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${need(MCP_SECRET, 'FIELD_MCP_SECRET')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
  return { status: r.status, body };
}

async function d1(sql, params = []) {
  const r = await fetch(`${RELAY}/d1/execute`, {
    method: 'POST',
    headers: { 'X-FIELD-Relay': need(RELAY_GATE, 'RELAY_SHARED_SECRET'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
  if (!r.ok || body.ok === false) throw new Error(`d1 HTTP ${r.status}: ${text.slice(0, 300)}`);
  return body.results || [];
}

const historyRows = async () =>
  d1(`SELECT content, replaced_at FROM codex_history WHERE key = ? ORDER BY id`, [KEY]);
const codexRow = async () =>
  (await d1(`SELECT content FROM codex WHERE key = ?`, [KEY]))[0] || null;

try {
  // ── write 1: a brand-new key. Nothing is replaced, so nothing is journalled.
  const w1 = await mcpCall('codex_write', {
    key: KEY, category: 'scratch', title: 'codex_history self-test', content: BODY_A,
  });
  assert('write 1 (new key) succeeds', w1.status === 200 && !w1.body?.result?.isError,
    `HTTP ${w1.status} ${JSON.stringify(w1.body).slice(0, 300)}`);

  const afterW1 = await historyRows();
  assert('a NEW key writes no history row', afterW1.length === 0,
    `${afterW1.length} row(s) — a create is not a replace, and journalling it would `
    + 'make every first write look like an overwrite');

  const c1 = await codexRow();
  assert('the codex row holds the first body', c1?.content === BODY_A,
    `got ${JSON.stringify(c1?.content || null).slice(0, 200)}`);

  // ── write 2: the overwrite. THE ASSERTION THE WHOLE CC-CMD EXISTS FOR.
  const w2 = await mcpCall('codex_write', {
    key: KEY, category: 'scratch', title: 'codex_history self-test', content: BODY_B,
  });
  assert('write 2 (overwrite) succeeds', w2.status === 200 && !w2.body?.result?.isError,
    `HTTP ${w2.status} ${JSON.stringify(w2.body).slice(0, 300)}`);

  const afterW2 = await historyRows();
  assert('THE FIRST BODY SURVIVES IN codex_history', afterW2.length === 1 && afterW2[0].content === BODY_A,
    `${afterW2.length} history row(s); content = ${JSON.stringify(afterW2[0]?.content || null).slice(0, 200)}`);

  const c2 = await codexRow();
  assert('the codex row now holds the second body', c2?.content === BODY_B,
    `got ${JSON.stringify(c2?.content || null).slice(0, 200)}`);

  assert('the history row is stamped', !!afterW2[0]?.replaced_at,
    'replaced_at is empty — a journal with no time on it cannot be ordered against an incident window');

  // ── write 3: THE NEGATIVE CONTROL. Same body again; nothing changed.
  const w3 = await mcpCall('codex_write', {
    key: KEY, category: 'scratch', title: 'codex_history self-test', content: BODY_B,
  });
  assert('write 3 (unchanged body) succeeds', w3.status === 200 && !w3.body?.result?.isError,
    `HTTP ${w3.status} ${JSON.stringify(w3.body).slice(0, 300)}`);

  const afterW3 = await historyRows();
  assert('AN UNCHANGED REWRITE ADDS NO HISTORY ROW', afterW3.length === 1,
    `${afterW3.length} row(s) after a no-op rewrite — the guard is journalling on every `
    + 'write rather than on every CHANGE, which grows the table without bound and makes '
    + '"the first body survives" true for the wrong reason');

} catch (e) {
  assert('the test ran to completion', false, e.message);
} finally {
  // ── cleanup, and it is verified rather than assumed.
  try {
    await d1(`DELETE FROM codex WHERE key = ?`, [KEY]);
    await d1(`DELETE FROM codex_history WHERE key = ?`, [KEY]);
    const leftCodex = await d1(`SELECT COUNT(*) AS n FROM codex WHERE key = ?`, [KEY]);
    const leftHist = await d1(`SELECT COUNT(*) AS n FROM codex_history WHERE key = ?`, [KEY]);
    assert('the scratch key is gone from both tables',
      leftCodex[0]?.n === 0 && leftHist[0]?.n === 0,
      `codex=${leftCodex[0]?.n} codex_history=${leftHist[0]?.n}`);
  } catch (e) {
    assert('cleanup ran', false, `${e.message} — scratch key ${KEY} may remain`);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = { ran_at: new Date().toISOString(), relay: RELAY, scratch_key: KEY, failed, results };
const { writeFileSync } = await import('node:fs');
writeFileSync(`outbox/codex-history-scratch-test-${stamp}.json`, JSON.stringify(out, null, 2) + '\n');

console.log(`\n${results.length - failed}/${results.length} assertions passed`);
process.exit(failed === 0 ? 0 : 1);
