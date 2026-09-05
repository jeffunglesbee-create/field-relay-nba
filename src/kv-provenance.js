// src/kv-provenance.js — every KV write records who wrote it and when.
//
// WHY NOT EDIT THE 62 PUT SITES. Two reasons, and the second is the one that
// decided it.
//
// First, 62 edits in a 19k-line file is a diff nobody can review, in exactly
// the code that must not break.
//
// Second, and fatal to the obvious approach: the values are not all JSON. 16 of
// the 62 store the bare string '1' -- warn flags and once-per-day gates read
// back as `if (await KV.get(k))`. Others store a bare number: the odds credit
// counter is String(used + units). Wrapping those in a provenance envelope
// would break every reader of them, silently, because `'1'` and
// `'{"v":"1","_at":...}'` are both truthy.
//
// KV HAS A PLACE FOR THIS ALREADY. put(key, value, { metadata }) stores metadata
// alongside the value and changes the value bytes not at all. Every existing
// reader calling .get() is unaffected -- not "probably fine", structurally
// unaffected, because it reads the same bytes it read before. Readers that want
// provenance call .getWithMetadata(), and list() returns metadata for a whole
// prefix in one call, so a diagnostic can survey a key space without reading a
// single value.
//
// THE WRAP HAPPENS AT THE TWO ENTRY POINTS, not at the writes. The fetch and
// scheduled exports are the only ways into this worker, so wrapping env there
// covers every write beneath them. That also makes the provenance BETTER than a
// hand-written site label would be: the wrapper knows the request path, so a
// value records the route that caused it to be written, which is the question
// someone looking at a stale key actually has. Cron writes record the trigger.
//
// Durable Objects hold their own env and are not covered here. That is a real
// boundary, stated rather than papered over: AmbientDO and GameDO write through
// their own bindings and need their own wrap, which is its own change.

const KV_BINDINGS = new Set(['FIELD_JOURNALISM', 'PUSH_SUBS', 'MCP_OAUTH']);

// Metadata is capped at 1024 bytes by KV. Ours is ~80, but a source string built
// from a long path could grow, and a write that fails because its provenance was
// too big would be a self-inflicted outage.
const MAX_SRC = 160;

function wrapBinding(kv, src, reads) {
    return new Proxy(kv, {
        get(target, prop, receiver) {
            const v = Reflect.get(target, prop, target);

            // READS, so the response can stop lying about the age of its data.
            //
            // stampProvenance sets X-FIELD-Served-At from the clock, which is
            // true of the RESPONSE and false of what is in it: a payload read
            // from a KV cache can be an hour old and the header said "now".
            // Recording it here is the same choke-point move as the writes --
            // one wrap instead of touching every read site.
            //
            // .get() is served by getWithMetadata(), which is the SAME KV
            // operation and returns the metadata alongside the value at no extra
            // read. The caller still receives exactly the value it asked for, so
            // no reader changes; the metadata is diverted into `reads` for the
            // stamp to summarise. The type argument is passed through, because
            // .get(key, 'json') is a shape the callers here rely on.
            if (prop === 'get' && typeof v === 'function' && typeof target.getWithMetadata === 'function') {
                return async function get(key, options) {
                    try {
                        const r = await target.getWithMetadata(key, options);
                        if (r && r.metadata && r.metadata._at) reads.push(r.metadata._at);
                        return r ? r.value : null;
                    } catch (_) {
                        // Any doubt, take the plain read. A diagnostic must never
                        // change what a caller receives, or fail to deliver it.
                        return target.get(key, options);
                    }
                };
            }

            if (prop !== 'put' || typeof v !== 'function') {
                return typeof v === 'function' ? v.bind(target) : v;
            }
            return function put(key, value, options) {
                try {
                    const opts = { ...(options || {}) };
                    opts.metadata = {
                        ...(opts.metadata || {}),
                        _src: String(src).slice(0, MAX_SRC),
                        _at: new Date().toISOString(),
                    };
                    return target.put(key, value, opts);
                } catch (_) {
                    // Provenance must never cost a write. The value matters;
                    // knowing where it came from is a bonus on top of it.
                    return target.put(key, value, options);
                }
            };
        },
    });
}

export function withKvProvenance(env, src) {
    if (!env) return env;
    try {
        const cache = new Map();
        const reads = [];
        return new Proxy(env, {
            get(target, prop, receiver) {
                // The reads collected under this request, for stampProvenance.
                // Named with a symbol-ish prefix so it cannot collide with a
                // real binding, and returning it never touches the store.
                if (prop === '__kvReads') return reads;
                const v = Reflect.get(target, prop, target);
                if (!KV_BINDINGS.has(prop) || !v || typeof v.put !== 'function') return v;
                if (!cache.has(prop)) cache.set(prop, wrapBinding(v, src, reads));
                return cache.get(prop);
            },
        });
    } catch (_) {
        return env;
    }
}

// The oldest thing this response was built from. Oldest rather than newest
// because staleness is decided by the worst input, not the best: a response
// mixing a fresh read with an hour-old one is an hour old.
export function oldestRead(env) {
    try {
        const reads = env && env.__kvReads;
        if (!Array.isArray(reads) || !reads.length) return null;
        let oldest = null;
        for (const at of reads) {
            const t = Date.parse(at);
            if (!Number.isFinite(t)) continue;
            if (oldest === null || t < oldest) oldest = t;
        }
        return oldest === null ? null : new Date(oldest).toISOString();
    } catch (_) {
        return null;
    }
}
