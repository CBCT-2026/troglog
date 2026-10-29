/* Offline support: the app and its libraries are served from cache and refreshed in the
   background; map tiles you've looked at are kept (up to MAX_TILES) so they work offline.
   Bump VERSION when the list of app files changes. */
const VERSION = "troglog-v2";
const TILES = "troglog-tiles";
const MAX_TILES = 1500;
const APP = ["./", "index.html", "styles.css", "app.js", "sync.js", "config.js", "places.js", "manifest.webmanifest", "icons/icon-192.png",
  "vendor/leaflet.css", "vendor/leaflet.js", "vendor/MarkerCluster.css", "vendor/MarkerCluster.Default.css", "vendor/leaflet.markercluster.js", "vendor/supabase.js",
  "vendor/images/marker-icon.png", "vendor/images/marker-icon-2x.png", "vendor/images/marker-shadow.png", "vendor/images/layers.png", "vendor/images/layers-2x.png"];

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
  if (url.origin !== location.origin) return; // Supabase, search etc. always go to the network
  // Stale-while-revalidate: instant from cache, updated copy next time.
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
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
