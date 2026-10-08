"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes this portal installable as an app
 * (public/app-sw.js — it caches only the offline page). Production only: in
 * development a service worker gets in the way of hot reload.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/app-sw.js").catch(() => {
      /* not installable in this browser; the portal works as before */
    });
  }, []);
  return null;
}
