"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Registers the push service worker (/sw.js) once on load. Mounted globally in
 * the root layout. The SW only handles push + notification clicks (no caching),
 * so registering it everywhere is cheap and means notifications work no matter
 * which page the family member installed the app from.
 */
export default function ServiceWorkerRegister() {
  const router = useRouter();

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

  // When a notification is tapped while the app is already open, the service
  // worker can't reliably navigate the window on iOS — it messages us instead,
  // and we route to the memory page in-app. This listener is global (mounted in
  // the root layout) so it works regardless of which page is showing.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data && data.type === "notification-navigate" && typeof data.url === "string") {
        router.push(data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}

