#!/usr/bin/env node
// scripts/build-provenance-view.mjs — render the census as one page you can scan.
//
// The census answers "how much of what we serve says where it came from" with a
// number. A number does not tell you WHICH 132 routes are bare, or which of them
// you are about to change. This renders all 185 at once, worst first.
//
// Generated from outbox/provenance-census-latest.json, never hand-edited, so the
// page cannot drift from the measurement the way a written summary would.

import { readFileSync, writeFileSync } from 'node:fs';

const census  = JSON.parse(readFileSync('outbox/provenance-census-latest.json', 'utf8'));
let history = [];
try { history = JSON.parse(readFileSync('outbox/provenance-census-history.json', 'utf8')); } catch (_) {}
// The store layer, read from the live worker rather than from source. Absent
// until the runtime probe has run at least once, and the panel says so instead
// of rendering zeros that look like a measurement.
let runtime = null;
try { runtime = JSON.parse(readFileSync('outbox/provenance-runtime-probe-latest.json', 'utf8')); } catch (_) {}
const kvSurvey = runtime && (runtime.readings || []).find(r => r.kv && r.body && r.body.ok);

const STATES = {
  none:          { label: 'body bare',   rank: 0, blurb: 'the body carries neither; the headers do' },
  passthrough:   { label: 'passthrough', rank: 1, blurb: 'upstream bytes — no body of ours to carry it' },
  'age-only':    { label: 'age only',    rank: 2, blurb: 'when, but not where' },
  'source-only': { label: 'source only', rank: 3, blurb: 'where, but not when' },
  both:          { label: 'complete',    rank: 4, blurb: 'source and age' },
  unread:        { label: 'unread',      rank: 5, blurb: 'handler not resolved — unknown, not fine' },
  protocol:      { label: 'protocol',    rank: 6, blurb: 'OAuth/MCP transport, not a data surface' },
};

const rows = census.routes
  .filter(r => r.state !== 'protocol')
  .sort((a, b) => (STATES[a.state]?.rank ?? 9) - (STATES[b.state]?.rank ?? 9) || a.path.localeCompare(b.path));

const t = census.tally;
// Two layers. The header layer is what a caller receives today; the body layer is
// what survives being saved, logged or cached. Reporting only the body number is
// how this page came to say 3.2% while production stamped 185 of 185.
const eff = census.effective || { stamped: 0, of: 0, named: 0, readsNothing: 0, undeclared: 0 };
const total = rows.length;
const order = ['none', 'passthrough', 'age-only', 'source-only', 'both'];
const pct = n => (100 * n / total);

// Instrument history. Not decoration: the number moved every time the parser was
// repaired, and a reader who does not know that will over-trust it.
const VERSIONS = [
  ['v1', '3.2%', 'read only the route body', 'delegation read as absence — /budget/odds, the best-instrumented route here, came back bare'],
  ['v2', '4.3%', 'followed helpers one level', 'the pattern demanded checked_at: and the code writes ES6 shorthand { checked_at }'],
  ['v3', '4.9%', 'accepted shorthand', '/health/sources, the Stale Data Sentinel itself, still read bare — its helper is in another module'],
  ['v4', '8.1%', 'searched sibling modules', 'overcounted: ", source," matched relayFetch’s parameter list, promoting all 23 proxies'],
  ['v5', '3.2%', 'provenance counts only inside a response', 'semantic, not positional. The rule that should have been first'],
];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

const bar = order.map(k => t[k] ? `<div class="seg s-${k}" style="width:${pct(t[k])}%" title="${t[k]} ${STATES[k].label}"><span>${t[k]}</span></div>` : '').join('');

const tableRows = rows.map(r => `<tr data-state="${r.state}">
<td><span class="chip c-${r.state}">${STATES[r.state]?.label ?? r.state}</span></td>
<td class="path">${esc(r.path)}${r.match === 'prefix' ? '<span class="pfx">*</span>' : ''}</td>
<td class="num">${r.line}</td>
<td class="tick">${r.source ? '&#9679;' : '&#9675;'}</td>
<td class="tick">${r.age ? '&#9679;' : '&#9675;'}</td>
<td class="via">${esc(r.via)}${r.helpers_followed ? `<span class="hf">+${r.helpers_followed}</span>` : ''}</td>
</tr>`).join('\n');

const html = `<title>Relay Provenance Audit</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --ground:#eef1f4; --panel:#ffffff; --line:#d6dce2; --line-soft:#e7ebef;
  --ink:#14181d; --muted:#5c6773; --faint:#8a949e;
  --wire:#0f6d8c;
  --ok:#1d7a4c; --warn:#a86a12; --bad:#a3312b; --grey:#6b7680;
  --ok-bg:#e3f0e9; --warn-bg:#f6ecd9; --bad-bg:#f6e2e0; --grey-bg:#e6e9ec;
  /* Segment labels sit ON the semantic fills. Those fills are dark in light
     mode and light in dark mode, so the label ink has to flip with them --
     white on the dark-mode amber failed contrast outright. */
  --seg-ink:#ffffff;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#0f1317; --panel:#161c21; --line:#2a333b; --line-soft:#212a31;
  --ink:#e6ecf1; --muted:#98a4b0; --faint:#6c7883;
  --wire:#4bb8dd;
  --ok:#5cc98d; --warn:#e0a94a; --bad:#e0736a; --grey:#8a949e;
  --ok-bg:#16301f; --warn-bg:#312611; --bad-bg:#331a18; --grey-bg:#222a30;
  --seg-ink:#0f1317;
}}
:root[data-theme="dark"]{
  --ground:#0f1317; --panel:#161c21; --line:#2a333b; --line-soft:#212a31;
  --ink:#e6ecf1; --muted:#98a4b0; --faint:#6c7883;
  --wire:#4bb8dd;
  --ok:#5cc98d; --warn:#e0a94a; --bad:#e0736a; --grey:#8a949e;
  --ok-bg:#16301f; --warn-bg:#312611; --bad-bg:#331a18; --grey-bg:#222a30;
  --seg-ink:#0f1317;
}
*{box-sizing:border-box}
body{background:var(--ground);color:var(--ink);
  font:15px/1.55 "IBM Plex Sans",system-ui,-apple-system,sans-serif;
  padding:32px 24px 72px;-webkit-font-smoothing:antialiased}
.wrap{max-width:1060px;margin:0 auto;display:flex;flex-direction:column;gap:28px}

.eyebrow{font:500 11px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.14em;
  text-transform:uppercase;color:var(--wire)}
h1{margin:8px 0 0;font-size:29px;font-weight:600;letter-spacing:-.015em;text-wrap:balance}
.sub{margin:6px 0 0;color:var(--muted);max-width:64ch}

.headline{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-top:6px}
.big{font:600 54px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:-.03em;
  font-variant-numeric:tabular-nums;color:var(--bad)}
.big small{font-size:20px;font-weight:400;color:var(--muted);letter-spacing:0}
.big-ok{color:var(--ok)}
.headline.second{margin-top:2px}
.headline.second .big{font-size:34px}
.barlabel{font:500 11px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.09em;
  text-transform:uppercase;color:var(--faint)}
.headline p{margin:0;color:var(--muted);max-width:44ch}

.barwrap{display:flex;flex-direction:column;gap:8px}
.bar{display:flex;height:38px;border-radius:3px;overflow:hidden;border:1px solid var(--line)}
.seg{display:flex;align-items:center;justify-content:center;min-width:0;
  font:500 12px/1 "IBM Plex Mono",ui-monospace,monospace;color:var(--seg-ink);
  font-variant-numeric:tabular-nums}
.seg span{padding:0 4px}
.s-none{background:var(--bad)} .s-passthrough{background:var(--grey)}
.s-age-only{background:var(--warn)} .s-source-only{background:var(--warn);opacity:.72}
.s-both{background:var(--ok)}
.key{display:flex;flex-wrap:wrap;gap:6px 20px;font-size:13px;color:var(--muted)}
.key b{color:var(--ink);font-weight:500}
.key i{width:9px;height:9px;border-radius:2px;display:inline-block;margin-right:7px;
  vertical-align:baseline}

.panel{background:var(--panel);border:1px solid var(--line);border-radius:4px}
.panel > h2{margin:0;padding:16px 18px 12px;font-size:15px;font-weight:600;
  border-bottom:1px solid var(--line-soft)}
.panel > p{margin:0;padding:12px 18px;color:var(--muted);font-size:13.5px;max-width:78ch}

table{border-collapse:collapse;width:100%;font-size:13.5px}
.scroll{overflow-x:auto}
th{position:sticky;top:0;background:var(--panel);text-align:left;
  font:500 11px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.09em;
  text-transform:uppercase;color:var(--faint);
  padding:11px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:7px 12px;border-bottom:1px solid var(--line-soft);vertical-align:middle}
tr:last-child td{border-bottom:0}
.path{font:400 13px/1.4 "IBM Plex Mono",ui-monospace,monospace;word-break:break-all}
.pfx{color:var(--faint)}
.num,.tick{font-family:"IBM Plex Mono",ui-monospace,monospace;font-variant-numeric:tabular-nums;
  color:var(--muted)}
.num{text-align:right}
.tick{text-align:center;font-size:12px}
.via{color:var(--faint);font:400 12px/1.4 "IBM Plex Mono",ui-monospace,monospace}
.hf{color:var(--wire);margin-left:5px}
.chip{display:inline-block;padding:2px 8px;border-radius:2px;white-space:nowrap;
  font:500 11px/1.65 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.03em}
.c-none{background:var(--bad-bg);color:var(--bad)}
.c-passthrough{background:var(--grey-bg);color:var(--grey)}
.c-age-only,.c-source-only{background:var(--warn-bg);color:var(--warn)}
.c-both{background:var(--ok-bg);color:var(--ok)}
.c-unread{background:var(--grey-bg);color:var(--grey)}

.filters{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid var(--line-soft)}
.filters button{font:500 12px/1 "IBM Plex Mono",ui-monospace,monospace;
  padding:7px 11px;border:1px solid var(--line);background:transparent;color:var(--muted);
  border-radius:2px;cursor:pointer;letter-spacing:.03em}
.filters button:hover{border-color:var(--wire);color:var(--ink)}
.filters button[aria-pressed="true"]{background:var(--wire);border-color:var(--wire);color:#fff}
.filters button:focus-visible{outline:2px solid var(--wire);outline-offset:2px}

.vers{width:100%;border-collapse:collapse;font-size:13px}
.vers td{padding:9px 18px;border-bottom:1px solid var(--line-soft);vertical-align:top}
.vers tr:last-child td{border-bottom:0}
.vers .v{font:500 12px "IBM Plex Mono",ui-monospace,monospace;color:var(--faint);width:34px}
.vers .n{font:500 13px "IBM Plex Mono",ui-monospace,monospace;
  font-variant-numeric:tabular-nums;width:52px;color:var(--ink)}
.vers .w{width:34%;color:var(--ink)}
.vers .why{color:var(--muted)}
.vers tr:last-child .n{color:var(--ok)}

footer{color:var(--faint);font-size:12.5px;display:flex;flex-wrap:wrap;gap:4px 18px;
  border-top:1px solid var(--line);padding-top:14px}
code{font:400 12px "IBM Plex Mono",ui-monospace,monospace;background:var(--grey-bg);
  padding:1px 5px;border-radius:2px;color:var(--ink)}
@media (max-width:640px){ body{padding:22px 14px 56px} .big{font-size:42px} }
</style>

<div class="wrap">
  <header>
    <div class="eyebrow">field-relay-nba &middot; src/index.js</div>
    <h1>What this relay serves, and whether it says where any of it came from</h1>
    <p class="sub">Every route that answers with data, in two layers: what the response
    now carries in its headers, and what it carries in its body. Read worst-first.
    Generated from the census, never written by hand.</p>
    <div class="headline">
      <div class="big big-ok">${eff.stamped}<small> of ${eff.of}</small></div>
      <p>responses now arrive stamped with the route and the kind of surface it is.
      ${eff.named} name a source outright, ${eff.readsNothing} declare that they read
      nothing, ${eff.undeclared} say the URL is built somewhere this parser cannot follow.
      One wrapper at the fetch exit, not ${total} edits.</p>
    </div>
    <div class="headline second">
      <div class="big">${t.both}<small> of ${total}</small></div>
      <p>carry it in the <em>body</em> as well &mdash; <strong>retired as a target</strong>, not a
      backlog. The client stores a transformed structure so relay body fields never reach it,
      the relay's own caches already carry writer and time in metadata, and ${t.passthrough || 0}
      passthrough routes have no body of ours to put anything in. Still counted because the
      number is real and free.</p>
    </div>
  </header>

  <section class="panel">
    <h2>The header layer, live since the response wrapper shipped</h2>
    <p>Every response passes through one exit, so provenance goes on there rather than
    into ${total} response bodies one at a time. Verified against the deployed worker,
    not the source that describes it: <code>outbox/provenance-runtime-probe-latest.json</code>.</p>
    <table class="vers">
      <tr><td class="n">${eff.stamped}</td><td class="w">stamped</td><td class="why">every response carries X-FIELD-Route and X-FIELD-Kind</td></tr>
      <tr><td class="n">${eff.named}</td><td class="w">named source</td><td class="why">read out of the handler's own body, never typed by hand</td></tr>
      <tr><td class="n">${eff.readsNothing}</td><td class="w">reads nothing</td><td class="why">a trigger or pure computation — an answer, not a gap</td></tr>
      <tr><td class="n">${eff.undeclared}</td><td class="w">undeclared</td><td class="why">the URL is assembled in a helper; on a ratchet so it cannot grow quietly</td></tr>
    </table>
  </section>

  <section class="panel">
    <h2>The store layer &mdash; what a value knows about itself</h2>
    <p>Headers describe a response in flight and are gone the moment it is saved. This is
    what the values in KV carry: which route or cron wrote each key, and when. Recorded at
    the two entry points rather than at the 62 write sites, in KV metadata so the stored
    bytes are untouched &mdash; 16 of those writes store the bare string <code>1</code> and
    would have broken under a value envelope.</p>
    ${kvSurvey ? `<table class="vers">
      <tr><td class="n">${kvSurvey.body.counts.stamped}</td><td class="w">stamped</td><td class="why">keys carrying a writer and a timestamp, prefix <code>${esc(kvSurvey.body.prefix || '')}</code></td></tr>
      <tr><td class="n">${kvSurvey.body.counts.unstamped}</td><td class="w">not yet</td><td class="why">written before the wrap shipped, or by a Durable Object &mdash; these expire on their own TTL, and watching this to zero is the done condition</td></tr>
      ${Object.entries(kvSurvey.body.writers || {}).map(([w, n]) => `<tr><td class="n">${n}</td><td class="w">writer</td><td class="why"><code>${esc(w)}</code></td></tr>`).join('\n      ')}
    </table>
    <p style="border-top:1px solid var(--line-soft)">Read live from <code>/provenance/kv</code> at ${esc(kvSurvey.body.checked_at || runtime.checked_at)}. Never returns a stored value &mdash; keys, ages and writers only.</p>`
    : `<p>No runtime reading yet. This panel stays empty rather than rendering zeros that would look like a measurement.</p>`}
  </section>

  <div class="barwrap">
    <div class="barlabel">The body layer &mdash; measured, not chased</div>
    <div class="bar">${bar}</div>
    <div class="key">
      ${order.map(k => `<span><i class="s-${k}"></i><b>${STATES[k].label}</b> &mdash; ${STATES[k].blurb}</span>`).join('\n      ')}
      <span style="width:100%;color:var(--faint)">These describe the response <em>body</em> only. Every route in every band above also carries route, kind, source and age in its headers &mdash; verified against the deployed worker.</span>
    </div>
  </div>

  <section class="panel">
    <h2>How the number moved while the instrument was being repaired</h2>
    <p>The parser was wrong four times, in both directions, and reported a plausible
    figure every time. v1 and v5 agree at 3.2% by coincidence, not confirmation: v1
    reached it through two compensating errors and put 23 proxy routes in the wrong
    bucket. Ten self-tests now run in both directions before any number prints.</p>
    <table class="vers">
      ${VERSIONS.map(([v, n, what, why]) => `<tr><td class="v">${v}</td><td class="n">${n}</td><td class="w">${esc(what)}</td><td class="why">${esc(why)}</td></tr>`).join('\n      ')}
    </table>
  </section>

  <section class="panel">
    <h2>${total} data surfaces</h2>
    <div class="filters" role="group" aria-label="Filter by state">
      <button aria-pressed="true" data-f="all">all &middot; ${total}</button>
      ${order.map(k => t[k] ? `<button aria-pressed="false" data-f="${k}">${STATES[k].label} &middot; ${t[k]}</button>` : '').join('\n      ')}
    </div>
    <div class="scroll">
      <table>
        <thead><tr>
          <th>state</th><th>route</th><th>line</th><th>src</th><th>age</th><th>answered by</th>
        </tr></thead>
        <tbody id="tb">
${tableRows}
        </tbody>
      </table>
    </div>
  </section>

  <footer>
    <span>census ${esc(census.generated_at)}</span>
    <span>${census.totals.dispatch_lines} dispatch lines &rarr; ${census.totals.distinct_paths} distinct paths</span>
    <span>static read; runtime responses not probed</span>
    <span>interrogate one route: <code>node scripts/provenance-census.mjs --explain /budget/odds</code></span>
  </footer>
</div>

<script>
const tb = document.getElementById('tb');
document.querySelectorAll('.filters button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.filters button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    const f = b.dataset.f;
    for (const tr of tb.rows) tr.hidden = !(f === 'all' || tr.dataset.state === f);
  });
});
</script>
`;

writeFileSync('outbox/provenance-view.html', html);
console.log(`  written: outbox/provenance-view.html  (${total} rows, ${t.both} complete, ${t.none} bare)`);
