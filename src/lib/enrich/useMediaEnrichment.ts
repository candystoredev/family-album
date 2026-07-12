"use client";

import { useEffect, useRef, useState } from "react";
import { compressImage } from "../media/compress";
import type { MediaEnrichment } from "./types";

/**
 * Compose-time enrichment runner, shared by the upload and edit pages.
 *
 * Watches the queued photo files and, for each one, posts a small analysis
 * rendition (≤1024px JPEG) to /api/admin/enrich in the background — while the
 * user is typing the title/tags, so the results are usually in before they
 * hit Upload/Save. Results accumulate in a map keyed by the item's client id.
 *
 * Soft-fail by design: a 503 (no API key configured) turns the feature off
 * for the session; individual failures are recorded and skipped. Publishing
 * never waits on this.
 */

export interface EnrichableItem {
  id: string;
  file: File;
  type: "photo" | "video";
  /** SHA-256 of the ORIGINAL bytes, for the server-side dedup cache. */
  contentHash?: string;
}

const CONCURRENCY = 2;

async function toAnalysisBase64(file: File): Promise<string> {
  // The queued file is already a compressed JPEG (≤1920px); re-render at
  // ≤1024px so the vision call stays ~1.4k tokens and the POST body small.
  const small = await compressImage(file, 1024, 0.7);
  const buf = await small.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function useMediaEnrichment(items: EnrichableItem[]) {
  const [enrichments, setEnrichments] = useState<Record<string, MediaEnrichment>>({});
  // ids we've started (or finished) — never re-request. Refs, not state:
  // scheduling bookkeeping shouldn't trigger renders.
  const startedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(0);
  const queueRef = useRef<EnrichableItem[]>([]);
  const disabledRef = useRef(false);
  const [disabled, setDisabled] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (disabledRef.current) return;

    for (const item of items) {
      if (item.type !== "photo") continue; // v1: photos only
      if (startedRef.current.has(item.id)) continue;
      startedRef.current.add(item.id);
      queueRef.current.push(item);
    }

    const pump = () => {
      while (inFlightRef.current < CONCURRENCY && queueRef.current.length > 0) {
        const item = queueRef.current.shift()!;
        inFlightRef.current++;
        setPendingCount((n) => n + 1);
        (async () => {
          try {
            const imageBase64 = await toAnalysisBase64(item.file);
            const res = await fetch("/api/admin/enrich", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                imageBase64,
                mediaType: "image/jpeg",
                contentHash: item.contentHash,
              }),
            });
            if (res.status === 503) {
              // Not configured — stop asking for the rest of the session.
              disabledRef.current = true;
              queueRef.current = [];
              setDisabled(true);
              return;
            }
            if (!res.ok) return; // this photo just goes unenriched
            const data = await res.json();
            if (data?.enrichment) {
              setEnrichments((prev) => ({ ...prev, [item.id]: data.enrichment }));
            }
          } catch {
            // Network hiccup — skip; the backfill pass can cover it later.
          } finally {
            inFlightRef.current--;
            setPendingCount((n) => n - 1);
            pump();
          }
        })();
      }
    };
    pump();
  }, [items]);

  return { enrichments, pendingCount, disabled };
}
