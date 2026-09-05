// src/provenance-stamp.js
//
// Lifted out of index.js so the deploy gate can import and exercise the REAL
// function rather than a copy of it -- the three guards below are exactly the
// kind of thing a re-implemented test would get right while the shipped code
// got it wrong.

import { provenanceFor, ROUTE_PROVENANCE_GENERATED_AT } from './route-provenance.js';
import { oldestRead } from './kv-provenance.js';

// ── Response provenance stamp ────────────────────────────────────────────────
// Every response this worker returns passes through one place: the fetch export
// below. So provenance goes on at that exit, in headers, instead of into 132
// response bodies one at a time.
//
// A census on 2026-09-05 found 6 of 185 data surfaces said where their data came
// from; 132 said nothing at all. Editing 132 handlers produces a diff nobody can
// review and a contract change on every one of them. This is one edit, it covers
// all 185, and because it stamps HEADERS the response bodies are byte-identical
// -- no consumer breaks, no shape changes, Rules 60 and 70 untouched.
//
// It also covers the 23 proxy routes, which is the class that CANNOT be fixed in
// the body at all: we never construct their body, we forward someone else's.
//
// THREE THINGS IT MUST NOT DO, in the order they would bite:
//
// 1. Break a WebSocket. /ws/game/* forwards to GAME_DO, which answers 101 with a
//    live `webSocket` on the response. Rebuilding that response drops the socket.
//    Checked first, returned untouched.
// 2. Buffer a stream. `new Response(resp.body, resp)` re-wraps the SAME
//    ReadableStream -- the SSE routes keep streaming. Reading the body here
//    would break /ambient/* and every other long-lived response.
// 3. Take a route down. Provenance is diagnostic; a bug in it must never cost a
//    response. Wrapped, and the original is returned on any throw (Rule 5).
//
// Headers are opaque to a cross-origin reader unless exposed, so
// Access-Control-Expose-Headers names them -- otherwise the client sees the
// stamp arrive and cannot read it, which is the same as not sending it.
export const PROV_HEADERS = 'X-FIELD-Route, X-FIELD-Source, X-FIELD-Kind, X-FIELD-Served-At, X-FIELD-Manifest, X-FIELD-Data-Written-At, X-FIELD-Data-Age-Seconds';
export // Header VALUES are ByteStrings -- latin-1, not Unicode. `set()` throws on
// anything above U+00FF. The first draft of this file used an em-dash in
// "none - reads nothing", every trigger and computed route threw, the catch
// below swallowed it, and those 23 routes returned with NO provenance headers
// at all while every test that looked at a store-backed route passed. Caught by
// the gate, not by reading. Nothing built into a header value here is anything
// but ASCII, and the gate asserts it for every entry in the manifest.
const ascii = v => String(v).replace(/[^\x20-\x7E]/g, '?');

export function stampProvenance(request, resp, env) {
    try {
        // A 101 carries a live socket. Anything else here would end the call.
        if (!resp || resp.webSocket || resp.status === 101) return resp;
        const pathname = new URL(request.url).pathname;
        const entry = provenanceFor(pathname);
        const stamp = [
            ['X-FIELD-Route',      pathname],
            ['X-FIELD-Kind',       entry ? entry.k : 'unmapped'],
            // null is a real answer: a trigger or a pure computation reads
            // nothing, and saying so differs from not knowing.
            ['X-FIELD-Source',     entry ? (entry.s || 'none (reads nothing)') : 'unmapped'],
            // Served-At is true of the RESPONSE and says nothing about what is
            // in it. A payload read from a KV cache can be an hour old and this
            // header still reads "now" -- our own header lying about age, which
            // is the defect this whole exercise exists to catch.
            ['X-FIELD-Served-At',  new Date().toISOString()],
            ['X-FIELD-Manifest',   ROUTE_PROVENANCE_GENERATED_AT],
        ];

        // So the age of the DATA travels beside it. Oldest read wins: a response
        // mixing a fresh value with an hour-old one is an hour old. Absent when
        // the route read nothing from KV, or read only keys written before the
        // provenance wrap -- which is a real distinction, not a zero.
        const written = oldestRead(env);
        if (written) {
            stamp.push(['X-FIELD-Data-Written-At', written]);
            stamp.push(['X-FIELD-Data-Age-Seconds', String(Math.max(0, Math.round((Date.now() - Date.parse(written)) / 1000)))]);
        }

        // Mutate in place when the headers allow it, and only rebuild when they
        // do not. Responses this worker CONSTRUCTS have mutable headers, which
        // is nearly all of them including every SSE stream we open; responses
        // that came back from fetch() are frozen and are the proxy routes.
        //
        // This matters because `new Response(resp.body, resp)` eagerly pulls a
        // chunk from a ReadableStream. No data is lost, but a long-lived stream
        // should not be touched at all when it does not have to be, and the
        // rebuild is now confined to the proxied responses that leave us no
        // choice.
        let out = resp;
        try {
            out.headers.set('X-FIELD-Route', ascii(pathname));
        } catch (_) {
            out = new Response(resp.body, resp);
        }
        for (const [k, v] of stamp) out.headers.set(k, ascii(v));
        const exposed = out.headers.get('Access-Control-Expose-Headers');
        out.headers.set('Access-Control-Expose-Headers', exposed ? `${exposed}, ${PROV_HEADERS}` : PROV_HEADERS);
        return out;
    } catch (_) {
        // Provenance is diagnostic. A bug in it must never cost a response.
        return resp;
    }
}

