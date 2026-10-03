self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // Legacy registration may still update on older clients. Never erase caches
  // belonging to the offline shell or local AI models. The current application
  // replaces this registration with /learning-sw.js at the same root scope.
  event.waitUntil(self.clients.claim());
});
