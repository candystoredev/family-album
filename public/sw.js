/* Service worker for The Hoecks — web push notifications.
 *
 * Scope is the site root (served from /sw.js). It deliberately does NOT cache
 * anything: the app already handles freshness via AutoRefresh, and an offline
 * cache here would fight that. The only job is push + notification clicks. */

self.addEventListener("install", () => {
  // Activate immediately on first install / update so pushes work right away.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of already-open tabs without requiring a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "The Hoecks";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    // Big hero image — rendered inline on Android/desktop. iOS ignores it and
    // shows the text teaser only (the photo is one tap away via `data.url`).
    image: data.image || undefined,
    tag: data.tag || "daily-memory",
    // A fresh memory each day should replace yesterday's, not stack.
    renotify: true,
    data: { url: data.url || "/today" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/today";
  const targetUrl = new URL(target, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Reuse an existing window if the PWA is already open.
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      })
  );
});
