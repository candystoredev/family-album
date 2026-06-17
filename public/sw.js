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
  const path = (event.notification.data && event.notification.data.url) || "/today";
  const targetUrl = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // If a window is already open, focus it and ask the app to route to the
      // memory page itself. iOS standalone PWAs ignore WindowClient.navigate(),
      // so we postMessage and let the in-page router handle the navigation —
      // otherwise the tap just focuses whatever page the user was already on.
      for (const client of clientList) {
        client.postMessage({ type: "notification-navigate", url: path });
        if ("navigate" in client) {
          // Belt-and-suspenders for platforms where it does work.
          try {
            await client.navigate(targetUrl);
          } catch {
            /* ignored — postMessage path covers it */
          }
        }
        if ("focus" in client) return client.focus();
      }

      // Otherwise open a fresh window straight to the memory page.
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })()
  );
});
