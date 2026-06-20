"use client";

import { useEffect, useState, useCallback } from "react";

export type TimelineStyle = "classic" | "rail";

const STORAGE_KEY = "hoecks_timeline";
const EVENT_NAME = "hoecks_timeline_change";

function read(): TimelineStyle {
  if (typeof window === "undefined") return "classic";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "rail" ? "rail" : "classic";
  } catch {
    return "classic";
  }
}

/**
 * Shared "timeline layout" preference (classic year list vs. year rail).
 *
 * ArchiveMenu lives in the root layout while SettingsClient lives on /settings,
 * so the two never share a React tree. We sync through localStorage plus a
 * custom window event: the cross-tab `storage` event doesn't fire in the tab
 * that made the change, so writers dispatch `hoecks_timeline_change` to update
 * any same-tab listeners (e.g. the menu) live.
 */
export function useTimelineStyle(): [TimelineStyle, (v: TimelineStyle) => void] {
  // Start from "classic" on both server and first client paint to avoid
  // hydration mismatch; sync to the stored value immediately after mount.
  const [style, setStyle] = useState<TimelineStyle>("classic");

  useEffect(() => {
    setStyle(read());

    function sync() {
      setStyle(read());
    }
    window.addEventListener("storage", sync);
    window.addEventListener(EVENT_NAME, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(EVENT_NAME, sync);
    };
  }, []);

  const set = useCallback((v: TimelineStyle) => {
    setStyle(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* ignore (private mode, etc.) */
    }
    window.dispatchEvent(new Event(EVENT_NAME));
  }, []);

  return [style, set];
}
