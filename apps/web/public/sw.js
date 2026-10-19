// Minimal service worker: required for installability. Pages are always fetched from
// the network (data is per-user and changes constantly); only a tiny offline page is cached.
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("sweeptrack-v1").then((c) => c.add(OFFLINE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
