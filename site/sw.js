/* Offline support: the app and its libraries are served from cache and refreshed in the
   background; map tiles you've looked at are kept (up to MAX_TILES) so they work offline.
   Bump VERSION when the list of app files changes. */
const VERSION = "troglog-v1";
const TILES = "troglog-tiles";
const MAX_TILES = 1500;
const APP = ["./", "index.html", "styles.css", "app.js", "sync.js", "config.js", "places.js", "manifest.webmanifest", "icons/icon-192.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css", "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(APP.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("tile.openstreetmap.org")) return e.respondWith(tile(req));
  const ours = url.origin === location.origin || url.hostname === "unpkg.com" || url.hostname === "cdn.jsdelivr.net";
  if (!ours) return; // Supabase, search etc. always go to the network
  // Stale-while-revalidate: instant from cache, updated copy next time.
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: url.origin === location.origin });
    const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

async function tile(req) {
  const c = await caches.open(TILES);
  const hit = await c.match(req); if (hit) return hit;
  try {
    const r = await fetch(req);
    if (r.ok || r.type === "opaque") {
      await c.put(req, r.clone());
      const ks = await c.keys(); if (ks.length > MAX_TILES) await Promise.all(ks.slice(0, ks.length - MAX_TILES).map((k) => c.delete(k)));
    }
    return r;
  } catch { return new Response("", { status: 504 }); }
}
