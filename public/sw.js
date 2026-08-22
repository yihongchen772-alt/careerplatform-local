// Minimal service worker: only exists to satisfy PWA installability.
// Deliberately does not cache anything — this app is fully dynamic/authenticated,
// so serving stale HTML or API responses would be worse than no offline support.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // no-op: always fall through to the network
});
