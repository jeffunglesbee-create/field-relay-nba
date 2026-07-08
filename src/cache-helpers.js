// src/cache-helpers.js
// Shared response-caching helper via the Workers Cache API (caches.default).
// Extracted from src/index.js (CC-CMD-2026-07-08-afl-kali-relayfetch-fix) —
// a separate concern from budget-helpers.js's KV-based quota counting, per
// this codebase's one-file-one-concern convention.
//
// Uses caches.default directly rather than fetch()'s cf:{} shorthand
// because the cache key (new Request(targetUrl, {method:'GET'})) never
// includes request headers, including Authorization. Cloudflare does not
// cache responses to requests carrying an Authorization header by default
// when using fetch()'s cf:{} shorthand, and cacheEverything does not
// override this — confirmed live (CC-CMD-2026-07-08-afl-kali-cache-audit)
// via CF-Cache-Status: BYPASS on every request to an authenticated Kali
// endpoint despite cf:{cacheTtl,cacheEverything} being present. relayFetch
// sidesteps this by keying the cache on the target URL alone; the
// Authorization header is only ever sent on the single upstream fetch that
// happens on a genuine cache miss, never touching the cache key itself.

// Kept in sync with index.js's own CORS constant by convention (same
// pattern already used in wp-resolver.js for its own header constants) —
// not imported, to avoid a circular dependency risk as this module grows.
const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Expose-Headers': 'X-JQ-Score, X-JQ-Retries, X-JQ-Layers, X-FIELD-Proxy',
};

export async function relayFetch(targetUrl, headers, ttl, source, ctx) {
    const cache    = caches.default;
    const cacheKey = new Request(targetUrl, { method: 'GET' });
    let   response = await cache.match(cacheKey);
    if (response) return response;
    let upstream;
    try {
        upstream = await fetch(targetUrl, { headers, cf: { cacheTtl: ttl, cacheEverything: true } });
    } catch (err) {
        return new Response(`${source} network error: ${err.message}`, { status: 502, headers: { 'X-RELAY-Error': `${source}-network`, ...CORS } });
    }
    if (!upstream.ok) {
        return new Response(`${source} returned ${upstream.status}`, { status: upstream.status, headers: { 'X-RELAY-Error': `${source}-${upstream.status}`, ...CORS } });
    }
    response = new Response(upstream.body, {
        status: 200,
        headers: {
            'Content-Type':               'application/json',
            ...CORS,
            'Cache-Control':              `public, max-age=${ttl}`,
            'X-FIELD-Proxy':              `relay-${source}`,
            'X-Cache-TTL':                String(ttl),
            // Forward quota headers from upstream where present
            ...(upstream.headers.get('x-requests-remaining') !== null
                ? {'X-Requests-Remaining': upstream.headers.get('x-requests-remaining')}
                : {}),
            ...(upstream.headers.get('x-requests-used') !== null
                ? {'X-Requests-Used': upstream.headers.get('x-requests-used')}
                : {}),
        }
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}

// relayFetchAwaited: same caching strategy as relayFetch (caches.default,
// URL-only cache key -- sidesteps the Authorization-header cache
// restriction the same way), for callers with no ExecutionContext to hand
// it. Confirmed live (CC-CMD-2026-07-08-afl-kali-relayfetch-fix probe):
// UserDO's constructor is (state, env) only -- no ctx, no ctx.waitUntil
// equivalent, and no existing precedent anywhere in this codebase for
// Cache API usage from inside a Durable Object. A directly-awaited
// cache.put() is correct here, not a shortcut: a DO's fetch() handler
// doesn't return until its whole async chain completes anyway (unlike the
// stateless Worker, where waitUntil exists specifically to extend
// execution past an already-sent response) -- there is no early return
// this would need to survive past.
// timeoutMs is optional (default 5000ms, matching every other fetch call in
// wp-resolver.js, this function's only caller today) -- relayFetch itself
// takes no timeout param and is left untouched (none of its 24 existing
// Worker-side callers pass one either, and none did before this CC-CMD),
// but relayFetchAwaited's one caller (resolveWinProbability's AFL branch)
// already had a 5s AbortSignal.timeout on this exact call before this
// refactor; dropping it here would be a real regression, not a cleanup.
export async function relayFetchAwaited(targetUrl, headers, ttl, source, timeoutMs = 5000) {
    const cache    = caches.default;
    const cacheKey = new Request(targetUrl, { method: 'GET' });
    let   response = await cache.match(cacheKey);
    if (response) return response;
    let upstream;
    try {
        upstream = await fetch(targetUrl, { headers, cf: { cacheTtl: ttl, cacheEverything: true }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
        return new Response(`${source} network error: ${err.message}`, { status: 502, headers: { 'X-RELAY-Error': `${source}-network`, ...CORS } });
    }
    if (!upstream.ok) {
        return new Response(`${source} returned ${upstream.status}`, { status: upstream.status, headers: { 'X-RELAY-Error': `${source}-${upstream.status}`, ...CORS } });
    }
    response = new Response(upstream.body, {
        status: 200,
        headers: {
            'Content-Type':               'application/json',
            ...CORS,
            'Cache-Control':              `public, max-age=${ttl}`,
            'X-FIELD-Proxy':              `relay-${source}`,
            'X-Cache-TTL':                String(ttl),
            ...(upstream.headers.get('x-requests-remaining') !== null
                ? {'X-Requests-Remaining': upstream.headers.get('x-requests-remaining')}
                : {}),
            ...(upstream.headers.get('x-requests-used') !== null
                ? {'X-Requests-Used': upstream.headers.get('x-requests-used')}
                : {}),
        }
    });
    await cache.put(cacheKey, response.clone());
    return response;
}

// relayFetchKV: KV-backed alternative to relayFetch/relayFetchAwaited, for
// Workers with no custom domain. The Cache API (caches.default) is
// documented by Cloudflare as functional only on Workers attached to a
// custom domain -- confirmed live via wrangler tail
// (CC-CMD-2026-07-08-afl-kali-relayfetch-fix follow-up): cache.put()
// resolved without error on every request, but cache.match() never hit the
// same key seconds later, because field-relay-nba has no [[routes]] or
// custom domain in wrangler.toml, only the *.workers.dev subdomain. KV
// namespaces are not zone-scoped -- they work identically regardless of
// which domain the Worker is invoked through, sidestepping the restriction
// entirely.
//
// Takes a KV namespace binding directly (not env), matching this
// codebase's one-namespace-per-concern convention -- field-kali-cache
// (binding KALI_CACHE) is dedicated to this, distinct from
// FIELD_JOURNALISM's prose-only contract (ADR-002 Rule A).
//
// No ExecutionContext needed at all (unlike relayFetch's ctx.waitUntil) --
// kv.put() works identically from the stateless Worker and from inside a
// Durable Object (UserDO), so this one function covers both this
// module's two Kali call sites without a ctx-vs-no-ctx split.
//
// timeoutMs defaults to null (no timeout) to match relayFetch's original,
// timeout-free behavior for buildAFLJournalismContext's call. Callers that
// need a timeout (resolveWinProbability's AFL branch, which had a 5s
// AbortSignal.timeout via relayFetchAwaited before this) pass it explicitly.
export async function relayFetchKV(targetUrl, headers, ttl, source, kv, timeoutMs = null) {
    const cacheKey = targetUrl;
    const cached   = await kv.get(cacheKey);
    if (cached !== null) {
        return new Response(cached, {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...CORS, 'X-FIELD-Proxy': `relay-${source}-kv` }
        });
    }
    let upstream;
    try {
        upstream = await fetch(targetUrl, {
            headers,
            ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
        });
    } catch (err) {
        return new Response(`${source} network error: ${err.message}`, { status: 502, headers: { 'X-RELAY-Error': `${source}-network`, ...CORS } });
    }
    if (!upstream.ok) {
        return new Response(`${source} returned ${upstream.status}`, { status: upstream.status, headers: { 'X-RELAY-Error': `${source}-${upstream.status}`, ...CORS } });
    }
    const bodyText = await upstream.text();
    await kv.put(cacheKey, bodyText, { expirationTtl: ttl });
    return new Response(bodyText, {
        status: 200,
        headers: {
            'Content-Type':               'application/json',
            ...CORS,
            'Cache-Control':              `public, max-age=${ttl}`,
            'X-FIELD-Proxy':              `relay-${source}`,
            'X-Cache-TTL':                String(ttl),
            ...(upstream.headers.get('x-requests-remaining') !== null
                ? {'X-Requests-Remaining': upstream.headers.get('x-requests-remaining')}
                : {}),
            ...(upstream.headers.get('x-requests-used') !== null
                ? {'X-Requests-Used': upstream.headers.get('x-requests-used')}
                : {}),
        }
    });
}
