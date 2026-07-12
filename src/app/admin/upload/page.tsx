"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { compressImage } from "@/lib/media/compress";
import { buildCaptureInput, sha256Hex, extractPhotoExtras, type MediaExtras } from "@/lib/media/extract";
import {
  earliestCapture,
  resolveCaptureDate,
  type CaptureDate,
  type CaptureDateInput,
} from "@/lib/media/capture-date";
import { captureSourceLabel, formatDisplayDate, isEstimatedDate } from "@/lib/datetime";
import { defaultLayout } from "@/lib/media/layout";
import { MAX_UPLOAD_BYTES } from "@/lib/media/upload-limits";
import MetadataFields, { useMetadataOptions } from "@/components/MetadataFields";

// ─── Types ───────────────────────────────────────────────────────────────────

type UploadState = "idle" | "uploading" | "success" | "error";

interface MediaFile {
  id: string;
  file: File;
  preview: string;
  type: "photo" | "video";
  posterDataUrl?: string;
  /** Raw capture-date inputs from the original, resolved server-side (10.1a). */
  capture?: CaptureDateInput;
  /** The same inputs resolved locally — feeds the "Suggested date" preview.
   *  resolveCaptureDate is pure, so this matches the server's resolution
   *  (minus the upload_fallback stamp, which needs the server clock). */
  resolved?: CaptureDate;
  /** SHA-256 of the original bytes — identity for dedup/backfill (10.1b). */
  contentHash?: string;
  /** GPS + device + raw EXIF from the original (10.1c). */
  extras?: MediaExtras;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let fileIdCounter = 0;
function nextFileId() {
  return `f-${++fileIdCounter}-${Date.now()}`;
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/");
}

/** How many px at the top/bottom of a row trigger "new row" vs "merge into row" */
const NEW_ROW_ZONE = 40;

/**
 * Pure layout computation — used by both the live-preview useMemo and drag-end
 * so the committed layout is always based on the freshest insert position.
 */
function computeDisplayRows(
  rows: MediaFile[][],
  activeId: string | null,
  insertAt: { rowIdx: number; colIdx: number; isNewRow?: boolean } | null
): MediaFile[][] {
  if (!activeId || !insertAt) return rows;
  const activeFile = rows.flat().find((f) => f.id === activeId);
  if (!activeFile) return rows;
  const sourceRowIdx = rows.findIndex((row) => row.some((f) => f.id === activeId));
  const sourceRowWillBeEmpty = rows[sourceRowIdx]?.length === 1;
  const stripped = rows
    .map((row) => row.filter((f) => f.id !== activeId))
    .filter((r) => r.length > 0);
  let targetRowIdx = insertAt.rowIdx;
  if (sourceRowWillBeEmpty && sourceRowIdx < insertAt.rowIdx) targetRowIdx--;

  if (insertAt.isNewRow) {
    targetRowIdx = Math.max(0, Math.min(targetRowIdx, stripped.length));
    const result = [...stripped];
    result.splice(targetRowIdx, 0, [activeFile]);
    return result;
  }

  if (targetRowIdx < 0 || targetRowIdx >= stripped.length) return rows;
  if (stripped[targetRowIdx].length >= 3) return rows;
  const colIdx = Math.min(insertAt.colIdx, stripped[targetRowIdx].length);
  return stripped.map((row, i) => {
    if (i !== targetRowIdx) return row;
    const r = [...row];
    r.splice(colIdx, 0, activeFile);
    return r;
  });
}

/**
 * Haptic feedback.
 * - Android/Chrome: Vibration API.
 * - iOS Safari: navigator.vibrate isn't supported. Instead we play a 15ms
 *   click tone through a pre-unlocked AudioContext. The AudioContext must be
 *   created inside an active touch handler (handleDragStart) to satisfy iOS's
 *   user-gesture requirement; subsequent plays work without a gesture.
 */
function playHapticClick(ctx: AudioContext) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0.45, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.015);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.015);
  } catch { /* ignore */ }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // rows is the source of truth — layout IS the row structure
  const [rows, setRows] = useState<MediaFile[][]>([]);

  // Metadata
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");

  // Tags / People / Albums
  const metadataOptions = useMetadataOptions();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<string[]>([]);

  // Upload state
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [resultSlug, setResultSlug] = useState("");
  // Status banner while pulling in items shared from the iOS share sheet.
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);

  // Drag state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<{
    rowIdx: number;
    colIdx: number;
    isNewRow?: boolean;
  } | null>(null);

  // Flat file list for upload ordering
  const flatFiles = useMemo(() => rows.flat(), [rows]);

  // "Suggested date" — what the server rollup will pick if the date field is
  // left empty: the earliest resolved capture across the queue, in display
  // order (the exact rule the server applies). Live as files change.
  const suggested = useMemo(
    () => earliestCapture(flatFiles.map((f) => f.resolved)),
    [flatFiles]
  );

  // Live preview — uses debounced insertAt so rapid zone-boundary oscillations
  // don't cause the layout to thrash; committed on drag end via pendingInsertRef
  const displayRows = useMemo(
    () => computeDisplayRows(rows, activeId, insertAt),
    [rows, activeId, insertAt]
  );

  // Refs for debounced insert zone — pendingInsertRef always has the latest
  // calculated zone; insertAt state only updates after 80ms of stability
  const pendingInsertRef = useRef<{ rowIdx: number; colIdx: number; isNewRow?: boolean } | null>(null);
  const insertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hit-test pointer position against rows/items during drag.
  // NEW_ROW_ZONE px at top/bottom of each row = "new row" zone; middle = merge.
  // insertAt is debounced 80ms so zone-boundary oscillations don't thrash the
  // layout preview; pendingInsertRef always has the latest raw value for drop.
  useEffect(() => {
    if (!activeId) return;

    function scheduleInsert(value: typeof insertAt) {
      pendingInsertRef.current = value;
      if (insertTimerRef.current) clearTimeout(insertTimerRef.current);
      insertTimerRef.current = setTimeout(() => {
        setInsertAt(value);
        insertTimerRef.current = null;
      }, 80);
    }

    function onPointerMove(e: PointerEvent) {
      if (!containerRef.current) return;
      const rowEls = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>("[data-row]")
      );
      if (rowEls.length === 0) { scheduleInsert(null); return; }

      // Pointer below all rows → new row at end
      const lastRect = rowEls[rowEls.length - 1].getBoundingClientRect();
      if (e.clientY > lastRect.bottom) {
        scheduleInsert({ rowIdx: rowEls.length, colIdx: 0, isNewRow: true });
        return;
      }

      // Pointer above the first row (or in its top band) → new top row.
      // Makes "drag to the top to start a new top row" an easy, large target.
      const firstRect = rowEls[0].getBoundingClientRect();
      if (e.clientY < firstRect.top + NEW_ROW_ZONE) {
        scheduleInsert({ rowIdx: 0, colIdx: 0, isNewRow: true });
        return;
      }

      for (let ri = 0; ri < rowEls.length; ri++) {
        const rowRect = rowEls[ri].getBoundingClientRect();
        if (e.clientY < rowRect.top || e.clientY > rowRect.bottom) continue;

        // Row has only the dragging ghost — keep as standalone new row
        const realItemEls = Array.from(
          rowEls[ri].querySelectorAll<HTMLElement>("[data-item]:not([data-dragging])")
        );
        if (realItemEls.length === 0) {
          scheduleInsert({ rowIdx: ri, colIdx: 0, isNewRow: true });
          return;
        }

        // Top zone → new row before this row
        if (e.clientY < rowRect.top + NEW_ROW_ZONE) {
          scheduleInsert({ rowIdx: ri, colIdx: 0, isNewRow: true });
          return;
        }
        // Bottom zone → new row after this row
        if (e.clientY > rowRect.bottom - NEW_ROW_ZONE) {
          scheduleInsert({ rowIdx: ri + 1, colIdx: 0, isNewRow: true });
          return;
        }

        // Middle → drop into this row
        let colIdx = realItemEls.length;
        for (let ci = 0; ci < realItemEls.length; ci++) {
          const r = realItemEls[ci].getBoundingClientRect();
          if (e.clientX < r.left + r.width / 2) { colIdx = ci; break; }
        }
        scheduleInsert({ rowIdx: ri, colIdx, isNewRow: false });
        return;
      }
      scheduleInsert(null);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (insertTimerRef.current) { clearTimeout(insertTimerRef.current); insertTimerRef.current = null; }
    };
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── File handling ──────────────────────────────────────────────────────────

  /** Process raw originals into MediaFile rows and append them to the queue.
   *  Shared by the file picker and the share-to-upload ?ingest= flow. */
  const ingestFiles = useCallback(async (newFiles: File[]): Promise<{ oversizedCount: number }> => {
    if (!newFiles.length) return { oversizedCount: 0 };

    // Reject oversized photos up front — a friendlier, earlier version of
    // the size cap the server enforces for real in
    // src/app/api/admin/upload/complete/route.ts. Checked against the
    // ORIGINAL file (before compression), since that's what the server sees
    // for the originals-upload path. Videos aren't capped here.
    const oversized = newFiles.filter(
      (f) => !isVideoFile(f) && f.size > MAX_UPLOAD_BYTES
    );
    const acceptedFiles = newFiles.filter((f) => !oversized.includes(f));
    if (oversized.length > 0) {
      // Reuse the informational banner (rather than the full error state) —
      // this is a per-file warning, not a failure of the whole page; any
      // accepted files below should still queue up normally.
      const limitMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
      const names = oversized.map((f) => `"${f.name}"`).join(", ");
      setIngestStatus(
        `${names} ${oversized.length === 1 ? "is" : "are"} over the ${limitMb} MB limit and ${oversized.length === 1 ? "wasn't" : "weren't"} added.`
      );
    }
    if (acceptedFiles.length === 0) return { oversizedCount: oversized.length };

    const mediaFiles: MediaFile[] = await Promise.all(
      acceptedFiles.map(async (f) => {
        const isVideo = isVideoFile(f);
        // Rich capture inputs must be read from the original — for photos,
        // compression re-encodes via canvas and strips EXIF; videos carry
        // their date in the MP4/MOV container. Resolved for real server-side
        // (10.1a); also resolved here for the "Suggested date" preview.
        const capture = await buildCaptureInput(f, isVideo);
        const resolved = resolveCaptureDate(capture);
        // SHA-256 of the original for dedup/backfill identity (10.1b). Photos
        // only — videos can be huge and hashing them client-side is unsafe.
        const contentHash = isVideo ? undefined : ((await sha256Hex(f)) ?? undefined);
        // GPS + device + raw EXIF from the original (10.1c). Photos only.
        const extras = isVideo ? undefined : await extractPhotoExtras(f);
        const processed = isVideo ? f : await compressImage(f);
        return {
          id: nextFileId(),
          file: processed,
          preview: URL.createObjectURL(processed),
          type: isVideo ? ("video" as const) : ("photo" as const),
          capture,
          resolved,
          contentHash,
          extras,
        };
      })
    );
    setRows((prev) =>
      prev.length === 0
        ? defaultLayout(mediaFiles)
        : [...prev, ...defaultLayout(mediaFiles)]
    );
    // Don't clobber the oversized-file warning we may have just set above.
    if (oversized.length === 0) setIngestStatus(null);
    setError("");
    setState("idle");
    return { oversizedCount: oversized.length };
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files || []);
    if (!newFiles.length) return;
    await ingestFiles(newFiles);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Share-to-upload: the iOS Shortcut presigns + PUTs originals to R2, then opens
  // /admin/upload?ingest=<comma-separated r2 keys>. Each key ends in
  // original.<ext>, so we recover the content type from the extension. Pull each
  // back through the same-origin proxy and drop it into the queue — a shared
  // photo/video lands here ready to publish, no app-open-first needed.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("ingest");
    if (!raw) return;
    // Strip the param so a refresh / re-render doesn't re-ingest.
    const url = new URL(window.location.href);
    url.searchParams.delete("ingest");
    window.history.replaceState({}, "", url.toString());

    const EXT_TYPE: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
      heic: "image/heic", heif: "image/heif",
      mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    };
    const keys = raw
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.startsWith("media/"));
    if (keys.length === 0) {
      setIngestStatus("Couldn't read the shared items.");
      return;
    }

    (async () => {
      setIngestStatus(`Loading ${keys.length} shared item${keys.length > 1 ? "s" : ""}…`);
      const files: File[] = [];
      for (const key of keys) {
        const ext = key.split(".").pop()?.toLowerCase() || "";
        const type = EXT_TYPE[ext] || "";
        try {
          const res = await fetch(
            `/api/admin/upload/ingest-fetch?key=${encodeURIComponent(key)}&type=${encodeURIComponent(type)}`
          );
          if (!res.ok) continue;
          const blob = await res.blob();
          files.push(
            new File([blob], `shared-${files.length + 1}.${ext || "jpg"}`, {
              type: type || blob.type || "application/octet-stream",
            })
          );
        } catch {
          // Skip individual failures; ingest whatever loaded.
        }
      }
      if (files.length === 0) {
        setIngestStatus("Couldn't load the shared items — try again from the app.");
        return;
      }
      const { oversizedCount } = await ingestFiles(files);
      // Leave the oversized-file warning ingestFiles just set in place.
      if (oversizedCount === 0) setIngestStatus(null);
    })();
  }, [ingestFiles]);

  function removeFile(id: string) {
    setRows((prev) =>
      prev
        .map((row) => {
          const f = row.find((x) => x.id === id);
          if (f) URL.revokeObjectURL(f.preview);
          return row.filter((x) => x.id !== id);
        })
        .filter((r) => r.length > 0)
    );
  }

  // ─── Video poster capture ──────────────────────────────────────────────────

  const captureVideoPoster = useCallback(
    (fileId: string, videoEl: HTMLVideoElement) => {
      const canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      setRows((prev) =>
        prev.map((row) =>
          row.map((f) => (f.id === fileId ? { ...f, posterDataUrl: dataUrl } : f))
        )
      );
    },
    []
  );

  // ─── Drag reorder ──────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 10 } })
  );

  // Crop target — when set, show crop modal for that file
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);

  // AudioContext for iOS haptic click — must be created inside an active touch
  // handler to satisfy iOS's user-gesture requirement; reused across drags.
  const audioCtxRef = useRef<AudioContext | null>(null);
  useEffect(() => () => { audioCtxRef.current?.close(); }, []);

  // Haptic fires on the same paint frame as visual drag-start
  useEffect(() => {
    if (!activeId) return;
    requestAnimationFrame(() => {
      if (navigator.vibrate) { navigator.vibrate(30); return; }
      if (audioCtxRef.current) playHapticClick(audioCtxRef.current);
    });
  }, [activeId]);

  function handleDragStart(event: DragStartEvent) {
    // Initialise / resume AudioContext here — we're inside an active touch event,
    // so iOS will allow audio unlock. Subsequent plays work without a gesture.
    if (!audioCtxRef.current) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
        if (Ctx) audioCtxRef.current = new Ctx();
      } catch { /* ignore */ }
    } else if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }
    setActiveId(event.active.id as string);
  }

  function handleDragEnd() {
    // Flush pending debounced insert so the committed layout uses the freshest
    // position, not the last value that survived the 80ms timer
    if (insertTimerRef.current) { clearTimeout(insertTimerRef.current); insertTimerRef.current = null; }
    const finalInsert = pendingInsertRef.current;
    const finalRows = computeDisplayRows(rows, activeId, finalInsert);
    if (finalRows !== rows) setRows(finalRows);
    pendingInsertRef.current = null;
    setActiveId(null);
    setInsertAt(null);
  }

  function handleDragCancel() {
    if (insertTimerRef.current) { clearTimeout(insertTimerRef.current); insertTimerRef.current = null; }
    pendingInsertRef.current = null;
    setActiveId(null);
    setInsertAt(null);
  }

  // ─── Upload ─────────────────────────────────────────────────────────────────

  async function handleUpload() {
    if (flatFiles.length === 0) return;
    setState("uploading");
    setError("");

    try {
      setProgress(`Uploading ${flatFiles.length} ${flatFiles.length === 1 ? "file" : "files"}...`);

      const uploadPromises = flatFiles.map(async (mf, i) => {
        const presignRes = await fetch("/api/admin/upload/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: mf.file.type }),
        });
        if (!presignRes.ok) {
          const data = await presignRes.json();
          throw new Error(data.error || `Failed to get upload URL for file ${i + 1}`);
        }
        const { uploadUrl, r2Key, keyPrefix } = await presignRes.json();
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": mf.file.type },
          body: mf.file,
        });
        if (!uploadRes.ok) throw new Error(`Failed to upload file ${i + 1}`);
        return {
          r2Key,
          keyPrefix,
          type: mf.type,
          posterDataUrl: mf.posterDataUrl,
          capture: mf.capture,
          contentHash: mf.contentHash,
          meta: mf.extras,
        };
      });

      const uploadedItems = await Promise.all(uploadPromises);
      const photosetLayout = rows.map((r) => r.length).join("");

      setProgress("Finalizing...");
      // Only a date the user actually typed is sent — the server treats `date`
      // as a manual override (date_source='manual'). Left empty, the server
      // rolls up the earliest capture across the items, which is exactly what
      // the "Suggested date" preview showed.
      const completeRes = await fetch("/api/admin/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: uploadedItems,
          title: title.trim() || undefined,
          date: date || undefined,
          tags: selectedTags,
          people: selectedPeople,
          albumIds: selectedAlbumIds,
          photosetLayout: flatFiles.length > 1 ? photosetLayout : undefined,
        }),
      });

      const data = await completeRes.json();
      if (!completeRes.ok) throw new Error(data.error || "Processing failed");

      setState("success");
      setResultSlug(data.slug);
      router.push("/");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Network error — please try again");
    }
  }

  function reset() {
    flatFiles.forEach((f) => URL.revokeObjectURL(f.preview));
    setRows([]);
    setTitle("");
    setDate("");
    setSelectedTags([]);
    setSelectedPeople([]);
    setSelectedAlbumIds([]);
    setState("idle");
    setProgress("");
    setError("");
    setResultSlug("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const disabled = state === "uploading" || state === "success";

  const activeFile = activeId ? flatFiles.find((f) => f.id === activeId) ?? null : null;

  // ─── Render ─────────────────────────────────────────────────────────────────

  const isEmpty = flatFiles.length === 0;

  return (
    <div className="relative paper-grain min-h-screen bg-[#1a1918] text-[#c9c4ba] px-4 pt-14 pb-4 flex flex-col">
      {/* Single file input, shared by the empty-state drop zone and the "add more" picker */}
      <input
        id="upload-input"
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
        multiple
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
      />

      {/* Share-to-upload status (pulling in items shared from the share sheet) */}
      {ingestStatus && (
        <div className="max-w-lg mx-auto w-full mb-3 rounded-lg border border-[#3a342c] bg-[#211e1a] px-4 py-2.5 text-center text-[13px] text-[#c2a467]">
          {ingestStatus}
        </div>
      )}

      {/* ── Empty state ── */}
      {isEmpty && (
        <div className="relative max-w-lg mx-auto w-full flex flex-col flex-1 min-h-0">
          <div className="text-center">
            <h1 className="font-serif text-[32px] font-semibold tracking-[-0.01em] text-[#efeae1] mb-1.5">
              Upload
            </h1>
            <p className="text-[15px] text-[#8a8378]">Add new moments to the family archive.</p>
          </div>

          {/* Fanned photo-card stack */}
          <div className="flex-1 flex flex-col items-center justify-center gap-[26px] py-6">
            <div className="relative w-[172px] h-[128px]">
              <div
                className="absolute left-2 top-[18px] w-[122px] h-[94px] rounded-[13px] border border-[#2b2722]"
                style={{
                  background: "repeating-linear-gradient(135deg,#272320 0 8px,#201d1b 8px 16px)",
                  transform: "rotate(-9deg)",
                  boxShadow: "0 10px 22px rgba(0,0,0,0.34)",
                }}
              />
              <div
                className="absolute right-2 top-4 w-[122px] h-[94px] rounded-[13px] border border-[#2b2722]"
                style={{
                  background: "repeating-linear-gradient(135deg,#272320 0 8px,#201d1b 8px 16px)",
                  transform: "rotate(9deg)",
                  boxShadow: "0 10px 22px rgba(0,0,0,0.34)",
                }}
              />
              <div
                className="absolute left-1/2 top-[14px] -translate-x-1/2 w-[122px] h-24 rounded-[13px] flex items-center justify-center"
                style={{
                  background: "repeating-linear-gradient(135deg,#2b2722 0 8px,#221f1c 8px 16px)",
                  border: "1px solid rgba(194,164,103,0.36)",
                  boxShadow: "0 14px 28px rgba(0,0,0,0.42)",
                }}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="#9a8758" strokeWidth="1.6" />
                  <circle cx="8.5" cy="10" r="1.7" fill="#9a8758" />
                  <path d="M5 17l4.5-4 3 2.5L16 12l3 3" stroke="#9a8758" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            <div className="text-center max-w-[280px]">
              <div className="font-serif text-[21px] font-semibold text-[#f0ebe2] mb-2">
                Your album is waiting
              </div>
              <p className="text-[14.5px] leading-[1.55] text-[#8a8378]">
                Add photos or videos and they&apos;ll quietly file themselves into the right year by date.
              </p>
            </div>
          </div>

          {/* Sticky footer: tactile drop zone + back */}
          <div className="sticky bottom-0 mt-2 pt-3 pb-6 bg-[#1a1918]">
            <label
              htmlFor="upload-input"
              className="group relative flex items-center gap-4 overflow-hidden rounded-[20px] bg-[#201d1a] px-5 py-[22px] cursor-pointer transition-colors hover:bg-[#252118]"
              style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 14px 32px rgba(0,0,0,0.32)" }}
            >
              <span
                className="pointer-events-none absolute inset-2 rounded-[13px]"
                style={{ border: "1.5px dashed rgba(194,164,103,0.42)" }}
              />
              <span
                className="relative flex-none w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{
                  background: "rgba(194,164,103,0.14)",
                  border: "1px solid rgba(194,164,103,0.36)",
                  boxShadow: "0 8px 22px rgba(122,96,42,0.2)",
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5" stroke="#c2a467" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3" stroke="#c2a467" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <span className="relative flex-1">
                <span className="block font-serif text-[18px] font-semibold text-[#f0ebe2] mb-[3px]">
                  Tap to choose photos or videos
                </span>
                <span className="block text-[13px] text-[#7d7468]">
                  or drag them straight in · JPG, PNG, MOV, MP4
                </span>
              </span>
              <svg width="9" height="16" viewBox="0 0 9 16" fill="none" className="relative flex-none">
                <path d="M1 1l6 7-6 7" stroke="#a9925f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </label>
            <a
              href="/"
              className="flex items-center gap-[7px] min-h-[44px] mt-1.5 pl-1 text-[15px] font-medium text-[#938b82] hover:text-[#c9c4ba] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </a>
          </div>
        </div>
      )}

      {/* ── Editing state (files chosen) ── */}
      {!isEmpty && (
      <div className="relative max-w-lg mx-auto w-full">
        <h1 className="font-serif text-[28px] font-semibold tracking-[-0.01em] text-[#efeae1] mb-6">Upload</h1>

        {/* Add more files */}
        <label
          htmlFor="upload-input"
          className="block rounded-xl p-6 text-center cursor-pointer transition-colors mb-4 bg-[#201d1a]"
          style={{ border: "1.5px dashed rgba(194,164,103,0.42)" }}
        >
          <div className="text-[#a39e93] space-y-1">
            <div className="text-2xl text-[#c2a467]">+</div>
            <div className="text-sm">Add more files</div>
          </div>
        </label>

        {/* Media grid + metadata */}
        {flatFiles.length > 0 && (
          <div className="space-y-6">
            {/* Tumblr-style row-based photoset grid */}
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div ref={containerRef} className="space-y-2">
                {displayRows.map((row, rowIdx) => {
                  // Lone dragged item → horizontal new-row indicator line
                  if (activeId && row.length === 1 && row[0].id === activeId) {
                    return (
                      <div key={rowIdx} data-row className="flex items-center" style={{ height: 20 }}>
                        <DraggableItem
                          key={row[0].id}
                          mf={row[0]}
                          disabled={disabled}
                          onRemove={removeFile}
                          onPosterCapture={captureVideoPoster}
                          onCrop={setCropTargetId}
                          asIndicator="horizontal"
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={rowIdx} data-row className="flex gap-2" style={{ height: 160 }}>
                      {row.map((mf) => (
                        <DraggableItem
                          key={mf.id}
                          mf={mf}
                          disabled={disabled}
                          onRemove={removeFile}
                          onPosterCapture={captureVideoPoster}
                          onCrop={setCropTargetId}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>

              <DragOverlay dropAnimation={null}>
                {activeFile ? (
                  <div className="w-36 h-40 rounded-lg overflow-hidden opacity-95 shadow-2xl cursor-grabbing select-none ring-2 ring-[#427ea3]">
                    {activeFile.posterDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={activeFile.posterDataUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : activeFile.type === "photo" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={activeFile.preview}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-[#141313] flex items-center justify-center text-[#666] text-xs">
                        VIDEO
                      </div>
                    )}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>

            {/* Crop modal — rendered outside DndContext so it sits above everything */}
            {cropTargetId && (() => {
              const cropFile = flatFiles.find((f) => f.id === cropTargetId);
              return cropFile ? (
                <CropModal
                  mf={cropFile}
                  onApply={(newFile, newPreview) => {
                    setRows((prev) =>
                      prev.map((row) =>
                        row.map((f) => {
                          if (f.id !== cropTargetId) return f;
                          URL.revokeObjectURL(f.preview);
                          return { ...f, file: newFile, preview: newPreview, posterDataUrl: undefined };
                        })
                      )
                    );
                    setCropTargetId(null);
                  }}
                  onCancel={() => setCropTargetId(null)}
                />
              ) : null;
            })()}

            {flatFiles.length > 1 && !disabled && (
              <p className="text-[10px] text-[#666] text-center -mt-4">
                Hold to reorder · tap crop icon to adjust
              </p>
            )}

            {/* Title / date / tags / people / albums */}
            <MetadataFields
              options={metadataOptions}
              title={title}
              onTitleChange={setTitle}
              date={date}
              onDateChange={setDate}
              dateLabel="Date (leave empty to use the suggested date)"
              dateHint={
                suggested ? (
                  date ? (
                    <span className="text-[#888]">
                      Your date replaces the suggested{" "}
                      <span className="text-[#c9c4ba]">
                        {formatDisplayDate(suggested.takenAt ?? "", suggested.localDate)}
                      </span>{" "}
                      and is saved as manually set.
                    </span>
                  ) : (
                    <span className={isEstimatedDate(suggested.source) ? "text-[#c2a467]" : "text-[#888]"}>
                      Suggested date:{" "}
                      <span className="font-semibold text-[#c9c4ba]">
                        {formatDisplayDate(suggested.takenAt ?? "", suggested.localDate)}
                      </span>{" "}
                      · {captureSourceLabel(suggested.source)}
                      {isEstimatedDate(suggested.source) &&
                        " — set the real date above if this looks wrong"}
                    </span>
                  )
                ) : (
                  <span className="text-[#c2a467]">
                    No capture date found in{" "}
                    {flatFiles.length === 1 ? "this file" : "these files"} — the post will be
                    dated today unless you set one.
                  </span>
                )
              }
              selectedTags={selectedTags}
              onTagsChange={setSelectedTags}
              selectedPeople={selectedPeople}
              onPeopleChange={setSelectedPeople}
              selectedAlbumIds={selectedAlbumIds}
              onAlbumIdsChange={setSelectedAlbumIds}
              disabled={disabled}
            />

            {/* Upload button */}
            {state === "idle" && (
              <button
                onClick={handleUpload}
                className="w-full bg-[#c2a467] text-[#1a1715] rounded-lg py-3 font-bold hover:bg-[#d2b577] transition-colors"
              >
                Upload {flatFiles.length} {flatFiles.length === 1 ? "file" : "files"}
              </button>
            )}

            {/* Uploading state */}
            {state === "uploading" && (
              <div className="text-center py-3 text-[#888]">
                <div className="inline-block w-5 h-5 border-2 border-[#427ea3] border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                {progress || "Uploading..."}
              </div>
            )}

            {/* Success state */}
            {state === "success" && (
              <div className="bg-[#1a2e1a] border border-[#2d4a2d] rounded-lg p-4 space-y-1">
                <div className="text-[#6db86d] font-semibold">
                  {flatFiles.length === 1 ? "Photo" : "Post"} uploaded!
                </div>
                <div className="text-xs text-[#888]">Redirecting to post...</div>
              </div>
            )}

            {/* Error state */}
            {state === "error" && (
              <div className="space-y-3">
                <div className="bg-[#2e1a1a] border border-[#4a2d2d] rounded-lg p-4 text-[#d86d6d]">
                  {error}
                </div>
                <button
                  onClick={() => setState("idle")}
                  className="w-full bg-[#2a2929] text-[#d3d3d3] rounded-lg py-3 hover:bg-[#333] transition-colors"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Discard — non-floating, sits at the bottom below all fields */}
            {rows.length > 0 && !disabled && (
              <button
                onClick={reset}
                className="w-full flex items-center justify-center gap-2 text-sm text-[#8a8078] hover:text-[#d86d6d] transition-colors py-2.5"
                aria-label="Discard post"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-[17px] h-[17px]">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
                Discard post
              </button>
            )}
          </div>
        )}

        {/* Back link */}
        <div className="mt-8 text-center">
          <a href="/" className="text-sm text-[#938b82] hover:text-[#c2a467] transition-colors">
            Back to feed
          </a>
        </div>
      </div>
      )}

    </div>
  );
}

// ─── Draggable Media Item ─────────────────────────────────────────────────────

function DraggableItem({
  mf,
  disabled,
  onRemove,
  onPosterCapture,
  onCrop,
  asIndicator,
}: {
  mf: MediaFile;
  disabled: boolean;
  onRemove: (id: string) => void;
  onPosterCapture: (fileId: string, video: HTMLVideoElement) => void;
  onCrop: (id: string) => void;
  asIndicator?: "horizontal";
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: mf.id,
    disabled,
  });

  // Horizontal new-row indicator — full-width blue line.
  // No data-item so the hit-test sees zero real items → correctly marks as new-row zone.
  if (asIndicator === "horizontal") {
    return (
      <div ref={setNodeRef} {...attributes} className="flex-1 h-0.5 rounded-full bg-[#427ea3]" />
    );
  }

  // Vertical within-row indicator — slim blue line in the item's flex slot.
  // Keeps data-item + data-dragging so hit-test still ignores it.
  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        data-item
        data-dragging=""
        {...attributes}
        {...listeners}
        style={{ touchAction: "pan-y" }}
        className="flex-shrink-0 w-0.5 h-full rounded-full bg-[#427ea3]"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-item
      {...attributes}
      {...listeners}
      style={{ touchAction: "pan-y" }}
      className={`relative h-full flex-1 min-w-0 overflow-hidden rounded-lg bg-[#141313] select-none ${
        disabled ? "cursor-default" : "cursor-grab"
      }`}
    >
      <div className="h-full opacity-100">
        {mf.type === "video" ? (
          <VideoPreview file={mf} onPosterCapture={onPosterCapture} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mf.preview}
            alt=""
            className="w-full h-full object-cover pointer-events-none"
          />
        )}
      </div>

      {!disabled && !isDragging && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemove(mf.id)}
          className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-[10px] flex items-center justify-center text-white"
        >
          ×
        </button>
      )}

      {mf.type === "video" && !isDragging && (
        <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white">
          VIDEO
        </div>
      )}

      {/* Crop button — bottom-right, stops pointer propagation so it doesn't start a drag */}
      {!disabled && !isDragging && mf.type === "photo" && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onCrop(mf.id)}
          className="absolute bottom-1 right-1 w-7 h-7 flex items-center justify-center bg-black/55 rounded active:bg-[#427ea3]/80"
          aria-label="Crop image"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M6 2v14a2 2 0 002 2h14" />
            <path d="M18 22V8a2 2 0 00-2-2H2" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Crop Modal ──────────────────────────────────────────────────────────────

interface CropBox { x: number; y: number; w: number; h: number }

function CropModal({
  mf,
  onApply,
  onCancel,
}: {
  mf: MediaFile;
  onApply: (file: File, preview: string) => void;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [crop, setCrop] = useState<CropBox>({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });

  function getScale() {
    const img = imgRef.current;
    const c = containerRef.current;
    if (!img || !c || !img.naturalWidth) return null;
    const s = Math.min(c.clientWidth / img.naturalWidth, c.clientHeight / img.naturalHeight);
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    return { s, dw, dh, ox: (c.clientWidth - dw) / 2, oy: (c.clientHeight - dh) / 2 };
  }

  function makeDragHandlers(corner: string) {
    return {
      onPointerDown(e: React.PointerEvent) {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove(e: React.PointerEvent) {
        if (!(e.buttons & 1) && e.pointerType === "mouse") return;
        const sc = getScale();
        if (!sc) return;
        const dx = e.movementX / sc.dw;
        const dy = e.movementY / sc.dh;
        const MIN = 0.08;
        setCrop((c) => {
          let { x, y, w, h } = c;
          if (corner === "tl") {
            const nx = Math.min(x + w - MIN, Math.max(0, x + dx));
            const ny = Math.min(y + h - MIN, Math.max(0, y + dy));
            w += x - nx; h += y - ny; x = nx; y = ny;
          } else if (corner === "tr") {
            const ny = Math.min(y + h - MIN, Math.max(0, y + dy));
            h += y - ny; y = ny;
            w = Math.max(MIN, Math.min(1 - x, w + dx));
          } else if (corner === "bl") {
            const nx = Math.min(x + w - MIN, Math.max(0, x + dx));
            w += x - nx; x = nx;
            h = Math.max(MIN, Math.min(1 - y, h + dy));
          } else if (corner === "br") {
            w = Math.max(MIN, Math.min(1 - x, w + dx));
            h = Math.max(MIN, Math.min(1 - y, h + dy));
          } else {
            x = Math.max(0, Math.min(1 - w, x + dx));
            y = Math.max(0, Math.min(1 - h, y + dy));
          }
          return { x, y, w, h };
        });
      },
    };
  }

  function handleApply() {
    const img = imgRef.current;
    if (!img) return;
    const sx = Math.round(crop.x * img.naturalWidth);
    const sy = Math.round(crop.y * img.naturalHeight);
    const sw = Math.round(crop.w * img.naturalWidth);
    const sh = Math.round(crop.h * img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = sw; canvas.height = sh;
    canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    canvas.toBlob((blob) => {
      if (!blob) { onCancel(); return; }
      const file = new File([blob], mf.file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
      onApply(file, URL.createObjectURL(file));
    }, "image/jpeg", 0.92);
  }

  const sc = loaded ? getScale() : null;
  const box = sc ? {
    left: sc.ox + crop.x * sc.dw,
    top:  sc.oy + crop.y * sc.dh,
    w:    crop.w * sc.dw,
    h:    crop.h * sc.dh,
  } : null;

  const corners = [
    { id: "tl", style: { left: box ? box.left - 14 : 0, top: box ? box.top - 14 : 0 } },
    { id: "tr", style: { left: box ? box.left + box.w - 14 : 0, top: box ? box.top - 14 : 0 } },
    { id: "bl", style: { left: box ? box.left - 14 : 0, top: box ? box.top + box.h - 14 : 0 } },
    { id: "br", style: { left: box ? box.left + box.w - 14 : 0, top: box ? box.top + box.h - 14 : 0 } },
  ];

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      <div ref={containerRef} className="flex-1 relative overflow-hidden select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={mf.preview}
          alt=""
          className="w-full h-full object-contain"
          onLoad={() => setLoaded(true)}
          draggable={false}
        />
        {box && (
          <>
            {/* Dimming overlay with crop hole via box-shadow */}
            <div
              className="absolute border border-white/80 pointer-events-none"
              style={{
                left: box.left, top: box.top,
                width: box.w, height: box.h,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
              }}
            />
            {/* Center drag — moves whole box */}
            <div
              className="absolute touch-none cursor-move"
              style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
              {...makeDragHandlers("center")}
            />
            {/* Corner handles */}
            {corners.map(({ id, style }) => (
              <div
                key={id}
                className="absolute w-7 h-7 flex items-center justify-center touch-none cursor-grab z-10"
                style={style}
                {...makeDragHandlers(id)}
              >
                <div className="w-3.5 h-3.5 rounded-full bg-white shadow-md" />
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-6 py-4 bg-black border-t border-white/10">
        <button onClick={onCancel} className="text-white/60 text-base px-4 py-2 active:text-white">
          Cancel
        </button>
        <button
          onClick={handleApply}
          className="bg-[#427ea3] text-white text-base font-semibold px-6 py-2.5 rounded-full active:bg-[#3a6f91]"
        >
          Apply crop
        </button>
      </div>
    </div>
  );
}

// ─── Video Preview Component ─────────────────────────────────────────────────

function VideoPreview({
  file,
  onPosterCapture,
}: {
  file: MediaFile;
  onPosterCapture: (fileId: string, video: HTMLVideoElement) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [captured, setCaptured] = useState(false);

  function handleLoaded() {
    if (captured || !videoRef.current) return;
    videoRef.current.currentTime = 1;
  }

  function handleSeeked() {
    if (captured || !videoRef.current) return;
    onPosterCapture(file.id, videoRef.current);
    setCaptured(true);
  }

  if (file.posterDataUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={file.posterDataUrl} alt="" className="w-full h-full object-cover" />
    );
  }

  return (
    <video
      ref={videoRef}
      src={file.preview}
      muted
      autoPlay
      playsInline
      onLoadedData={handleLoaded}
      onSeeked={handleSeeked}
      className="w-full h-full object-cover"
    />
  );
}
