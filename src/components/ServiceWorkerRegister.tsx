"use client";

import { useEffect } from "react";

/**
 * Registers the push service worker (/sw.js) once on load. Mounted globally in
 * the root layout. The SW only handles push + notification clicks (no caching),
 * so registering it everywhere is cheap and means notifications work no matter
 * which page the family member installed the app from.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("Service worker registration failed:", err);
      });
    };
    // Wait until the page is fully loaded so SW registration never competes
    // with first paint.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
