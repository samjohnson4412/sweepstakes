"use client";

import { useEffect } from "react";

/** Registers the minimal service worker that makes the app installable (and a share target). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}
