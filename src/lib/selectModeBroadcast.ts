"use client";

import { useEffect, useState } from "react";

const EVENT_NAME = "hoecks_select_mode_change";

/**
 * Broadcasts Feed's bulk-select mode across the React tree boundary. Feed
 * (a page-level client component) and ArchiveMenu (mounted in the root
 * layout) never share a tree — the same gap useTimelineStyle bridges for the
 * timeline-style preference — but this signal is purely live/ephemeral, so a
 * plain CustomEvent is enough; no localStorage persistence needed.
 */
export function broadcastSelectMode(active: boolean) {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: active }));
}

/** Live-reads the select-mode state broadcast by broadcastSelectMode. */
export function useSelectModeActive(): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    function handle(e: Event) {
      setActive((e as CustomEvent<boolean>).detail);
    }
    window.addEventListener(EVENT_NAME, handle);
    return () => window.removeEventListener(EVENT_NAME, handle);
  }, []);

  return active;
}
