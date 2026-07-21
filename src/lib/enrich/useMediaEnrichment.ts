"use client";

import { useEffect, useRef, useState } from "react";
import { compressImage } from "../media/compress";
import { extractDatesFromText } from "./extract-dates";
import { ocrText } from "./ocr";
import { detectFaces, imageFromBlob } from "../faces/detect";
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
  /** GPS from the original EXIF (10.1c) — feeds place-based tag suggestions. */
  gps?: { lat: number; lng: number } | null;
  /** Resolved capture instant (UTC ISO) — feeds temporal-neighbour suggestions. */
  takenAt?: string | null;
}

/** Options for the enrichment hook. */
export interface UseMediaEnrichmentOptions {
  /** Exclude this post from temporal matching (set on the edit page). */
  excludePostId?: string;
}

/** Merged per-item results; each field appears when its source finishes. */
export interface ItemEnrichment {
  cloud?: MediaEnrichment;
  ocr?: OcrResult;
  similarTags?: string[];
  /** Existing-vocabulary tags from temporal/place context (suggest-tags route). */
  contextTags?: string[];
  /** New-tag proposals (unmatched place components) from the suggest-tags route. */
  contextProposals?: string[];
  /** Reverse-geocoded place label for the item's GPS, if any. */
  place?: string | null;
  /** Known people whose face appears in this photo (compose-time face match). */
  suggestedPeople?: { personId: string; name: string }[];
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

/**
 * Soft-failing context source: POST the item's GPS/capture-time to the
 * suggest-tags route and merge the temporal + place suggestions. Skips items
 * with neither signal, and skips a redundant call when another item already
 * covered the same rounded-gps + hour bucket. Never throws.
 */
function fetchContextSuggestions(
  item: EnrichableItem,
  options: UseMediaEnrichmentOptions,
  queried: Set<string>,
  merge: (id: string, patch: ItemEnrichment) => void
): Promise<void> {
  const hasGps =
    !!item.gps && Number.isFinite(item.gps.lat) && Number.isFinite(item.gps.lng);
  const hasTime = typeof item.takenAt === "string" && item.takenAt.length > 0;
  if (!hasGps && !hasTime) return Promise.resolve();

  const gpsKey = hasGps ? `${item.gps!.lat.toFixed(3)},${item.gps!.lng.toFixed(3)}` : "";
  const timeKey = hasTime ? item.takenAt!.slice(0, 13) : ""; // YYYY-MM-DDTHH
  const dedupeKey = `${gpsKey}|${timeKey}`;
  if (queried.has(dedupeKey)) return Promise.resolve();
  queried.add(dedupeKey);

  return fetch("/api/admin/suggest-tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      takenAt: hasTime ? item.takenAt : undefined,
      gps: hasGps ? { lat: item.gps!.lat, lng: item.gps!.lng } : undefined,
      excludePostId: options.excludePostId,
    }),
  })
    .then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      const patch: ItemEnrichment = {};
      if (Array.isArray(data?.tags) && data.tags.length > 0) patch.contextTags = data.tags;
      if (Array.isArray(data?.newTagProposals) && data.newTagProposals.length > 0)
        patch.contextProposals = data.newTagProposals;
      if (typeof data?.place === "string") patch.place = data.place;
      if (Object.keys(patch).length > 0) merge(item.id, patch);
    })
    .catch(() => {});
}

export function useMediaEnrichment(
  items: EnrichableItem[],
  options: UseMediaEnrichmentOptions = {}
) {
  const [enrichments, setEnrichments] = useState<Record<string, ItemEnrichment>>({});
  // Scheduling bookkeeping lives in refs — it shouldn't trigger renders.
  const startedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(0);
  const queueRef = useRef<EnrichableItem[]>([]);
  const cloudDisabledRef = useRef(false);
  // De-dupes context requests: items sharing a rounded-gps + hour bucket would
  // return the same suggestions, so we only query the first.
  const contextQueriedRef = useRef<Set<string>>(new Set());
  // Latest options without re-running the effect (excludePostId is page-stable).
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Resolves to whether compose-time face matching is worth running this
  // session — false when no people have been named yet (nothing to match), so
  // we never pay the ~7 MB face-model load for zero suggestions. Fetched once.
  const facesGateRef = useRef<Promise<boolean> | null>(null);
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

    // One-shot gate: is there at least one named person to match faces against?
    const facesEnabled = () => {
      if (!facesGateRef.current) {
        facesGateRef.current = fetch("/api/admin/faces/status")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => Number(d?.referenceCount ?? 0) > 0)
          .catch(() => false);
      }
      return facesGateRef.current;
    };

    const pump = () => {
      while (inFlightRef.current < CONCURRENCY && queueRef.current.length > 0) {
        const item = queueRef.current.shift()!;
        inFlightRef.current++;
        setPendingCount((n) => n + 1);
        (async () => {
          // Context (temporal + place) needs no image rendition, so fire it up
          // front and let it settle independently of the vision pipeline.
          const contextP = fetchContextSuggestions(
            item,
            optionsRef.current,
            contextQueriedRef.current,
            merge
          );
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

            // Face → known-people match: detect faces in-browser (nothing but
            // abstract descriptors ever leaves the device) and ask which named
            // people appear. Gated so it never runs before anyone is named.
            const facesP = (async () => {
              if (!(await facesEnabled())) return;
              const img = await imageFromBlob(rendition.file);
              const faces = await detectFaces(img);
              if (faces.length === 0) return;
              const res = await fetch("/api/admin/faces/match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ descriptors: faces.map((f) => f.descriptor) }),
              });
              if (!res.ok) return;
              const data = await res.json();
              if (Array.isArray(data?.people) && data.people.length > 0) {
                merge(item.id, { suggestedPeople: data.people });
              }
            })().catch(() => {});

            await Promise.allSettled([cloudP, ocrP, similarP, contextP, facesP]);
          } catch {
            // Rendition failed — no image analysis, but the context lookup
            // (GPS/time only) can still land.
            await contextP;
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
 *  (cloud + phash-propagated first, then temporal/place context) followed by
 *  new proposals (cloud, then unmatched place components); deduped and capped.
 *  Earlier sources are higher-confidence, so they lead. */
export function collectTagSuggestions(
  enrichments: Record<string, ItemEnrichment>,
  max = 8
): { name: string; isNew?: boolean }[] {
  const existing = new Set<string>();
  const contextExisting = new Set<string>();
  const proposals = new Set<string>();
  for (const e of Object.values(enrichments)) {
    for (const t of e.similarTags ?? []) existing.add(t);
    for (const t of e.cloud?.suggestedTags ?? []) existing.add(t);
    for (const t of e.contextTags ?? []) contextExisting.add(t);
    for (const t of e.cloud?.newTagProposals ?? []) proposals.add(t);
    for (const t of e.contextProposals ?? []) proposals.add(t);
  }
  // Context existing sits after the higher-confidence phash/vision matches.
  for (const t of existing) contextExisting.delete(t);
  const allExisting = [...existing, ...contextExisting];
  for (const t of allExisting) proposals.delete(t);
  return [
    ...allExisting.map((name) => ({ name })),
    ...[...proposals].map((name) => ({ name, isNew: true })),
  ].slice(0, max);
}

/** Distinct known-people suggestions across items (closest-match first, capped).
 *  These are always EXISTING named people — face matching is closed-vocabulary,
 *  just like tags — so they're offered as tap-to-add, never auto-applied. */
export function collectPeopleSuggestions(
  enrichments: Record<string, ItemEnrichment>,
  max = 8
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const e of Object.values(enrichments)) {
    for (const p of e.suggestedPeople ?? []) {
      if (!seen.has(p.personId)) {
        seen.add(p.personId);
        names.push(p.name);
      }
    }
  }
  return names.slice(0, max);
}
