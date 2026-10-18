/*
 * Makes this portal installable as an app (Add to Home Screen / Install).
 *
 * It caches one thing: the "you're offline" page. Never a page, never data,
 * never an API answer — so an installed app always shows what the server says
 * now, and nobody's records sit in a phone's cache. Every navigation goes to
 * the network; only when that fails is the offline page shown instead.
 */
const CACHE = "app-shell-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("app-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

/* Tapping a "new message" alert (lib/desktopAlerts.ts): focus an open window
   of this app and take it to the chat, or open one if none is open. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.location.origin));
      if (open) return open.focus().then((c) => (c && "navigate" in c ? c.navigate(url) : undefined));
      return self.clients.openWindow(url);
    }),
  );
});
