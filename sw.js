"use strict";

const STATIC_CACHE = "kadastra-static-v6";
const DATA_CACHE   = "kadastra-data-v1";
const STATIC_URLS  = [
  "./",
  "./lib/three.min.js",
];
const DATA_URL = "./data/concept_graph.json";

// ── Install: precache static assets ──────────────────────────────────────────
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(c => c.addAll(STATIC_URLS))
  );
  self.skipWaiting();
});

// ── Activate: remove stale caches ────────────────────────────────────────────
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", e => {
  const {pathname} = new URL(e.request.url);
  if (pathname.endsWith("concept_graph.json")) {
    e.respondWith(etagFetch(e.request));
  } else if (e.request.mode === "navigate" || pathname.endsWith("/") || pathname.endsWith(".html")) {
    e.respondWith(networkFirst(e.request));
  } else {
    e.respondWith(cacheFirst(e.request));
  }
});

// Network-first for the page itself so viewer edits show up; cached copy when offline.
async function networkFirst(request) {
  try {
    const response = await fetch(request, {cache: "no-cache"});
    if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
    return response;
  } catch (_) {
    return (await caches.match(request)) ?? Response.error();
  }
}

// Cache-first: serve from cache, fall back to network and cache the result.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

// ETag-conditional fetch for concept_graph.json:
// - Send If-None-Match with the stored ETag.
// - 304 → return cached.
// - 200 → update cache and return fresh.
// - Network error → return cached (offline fallback).
async function etagFetch(request) {
  const cache  = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const etag   = cached?.headers.get("ETag");

  try {
    const headers  = etag ? {"If-None-Match": etag} : {};
    const response = await fetch(request, {headers});
    if (response.status === 304) return cached;
    if (response.ok) {
      await cache.put(request, response.clone());
      return response;
    }
  } catch (_) { /* offline */ }

  return cached ?? new Response("{}", {status: 503, headers: {"Content-Type": "application/json"}});
}
