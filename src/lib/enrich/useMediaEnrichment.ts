"use client";

import { useEffect, useRef, useState } from "react";
import { compressImage } from "../media/compress";
import { extractDatesFromText } from "./extract-dates";
import { ocrText } from "./ocr";
import type { MediaEnrichment, OcrResult } from "./types";

/**
 * Compose-time enrichment runner, shared by the upload and edit pages.
 *
 * For each queued photo it renders ONE small analysis rendition (≤1024px
 * JPEG) and feeds three independent sources, merging results as they land —
 * all while the user is still filling in the form:
 *
 *  1. LOCAL OCR (tesseract.js in-browser) + written-date extraction — free,
 *     nothing leaves the device. Always runs.
 *  2. Phash similarity (/api/admin/similar-tags) — model-free tag propagation
 *     from visually-identical, already-tagged photos. Always runs.
 *  3. Cloud vision (/api/admin/enrich) — captions/labels/closed-vocabulary
 *     tags/date evidence. OPTIONAL: a 503 (no API key configured) turns this
 *     source off for the session; the local sources keep working.
 *
 * Soft-fail everywhere: publishing never waits on any of this.
 */

export interface EnrichableItem {
  id: string;
  file: File;
  type: "photo" | "video";
  /** SHA-256 of the ORIGINAL bytes, for the cloud dedup cache. */
  contentHash?: string;
}

/** Merged per-item results; each field appears when its source finishes. */
export interface ItemEnrichment {
  cloud?: MediaEnrichment;
  ocr?: OcrResult;
  similarTags?: string[];
}

const CONCURRENCY = 2;

async function renderAnalysisJpeg(file: File): Promise<{ file: File; base64: string }> {
  // The queued file is already a compressed JPEG (≤1920px); re-render at
  // ≤1024px so vision stays ~1.4k tokens and POST bodies stay small.
  const small = await compressImage(file, 1024, 0.7);
  const buf = await small.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { file: small, base64: btoa(binary) };
}

export function useMediaEnrichment(items: EnrichableItem[]) {
  const [enrichments, setEnrichments] = useState<Record<string, ItemEnrichment>>({});
  // Scheduling bookkeeping lives in refs — it shouldn't trigger renders.
  const startedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(0);
  const queueRef = useRef<EnrichableItem[]>([]);
  const cloudDisabledRef = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    for (const item of items) {
      if (item.type !== "photo") continue; // v1: photos only
      if (startedRef.current.has(item.id)) continue;
      startedRef.current.add(item.id);
      queueRef.current.push(item);
    }

    const merge = (id: string, patch: ItemEnrichment) =>
      setEnrichments((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

    const pump = () => {
      while (inFlightRef.current < CONCURRENCY && queueRef.current.length > 0) {
        const item = queueRef.current.shift()!;
        inFlightRef.current++;
        setPendingCount((n) => n + 1);
        (async () => {
          try {
            const rendition = await renderAnalysisJpeg(item.file);

            const cloudP = cloudDisabledRef.current
              ? Promise.resolve()
              : fetch("/api/admin/enrich", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    imageBase64: rendition.base64,
                    mediaType: "image/jpeg",
                    contentHash: item.contentHash,
                  }),
                })
                  .then(async (res) => {
                    if (res.status === 503) {
                      cloudDisabledRef.current = true; // not configured — local-only mode
                      return;
                    }
                    if (!res.ok) return;
                    const data = await res.json();
                    if (data?.enrichment) merge(item.id, { cloud: data.enrichment });
                  })
                  .catch(() => {});

            const ocrP = ocrText(rendition.file)
              .then((text) => {
                const dates = extractDatesFromText(text, new Date().getFullYear());
                if (text.trim() || dates.length > 0) {
                  merge(item.id, { ocr: { text: text.trim(), dates, version: 1 } });
                }
              })
              .catch(() => {});

            const similarP = fetch("/api/admin/similar-tags", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageBase64: rendition.base64 }),
            })
              .then(async (res) => {
                if (!res.ok) return;
                const data = await res.json();
                if (Array.isArray(data?.tags) && data.tags.length > 0) {
                  merge(item.id, { similarTags: data.tags });
                }
              })
              .catch(() => {});

            await Promise.allSettled([cloudP, ocrP, similarP]);
          } catch {
            // Rendition failed — nothing to analyze for this item.
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

  return { enrichments, pendingCount };
}

/** All date evidence for an item set — cloud vision first, then OCR. */
export function collectDateEvidence(enrichments: Record<string, ItemEnrichment>) {
  return Object.values(enrichments).flatMap((e) => [
    ...(e.cloud?.dates ?? []),
    ...(e.ocr?.dates ?? []),
  ]);
}

/** Merged tag-suggestion chips across items: existing-vocabulary suggestions
 *  (cloud + phash-propagated) first, then cloud's new proposals; capped. */
export function collectTagSuggestions(
  enrichments: Record<string, ItemEnrichment>,
  max = 8
): { name: string; isNew?: boolean }[] {
  const existing = new Set<string>();
  const proposals = new Set<string>();
  for (const e of Object.values(enrichments)) {
    for (const t of e.similarTags ?? []) existing.add(t);
    for (const t of e.cloud?.suggestedTags ?? []) existing.add(t);
    for (const t of e.cloud?.newTagProposals ?? []) proposals.add(t);
  }
  for (const t of existing) proposals.delete(t);
  return [
    ...[...existing].map((name) => ({ name })),
    ...[...proposals].map((name) => ({ name, isNew: true })),
  ].slice(0, max);
}
