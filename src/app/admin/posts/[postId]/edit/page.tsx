"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
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
import { resolveCaptureDate, type CaptureDateInput } from "@/lib/media/capture-date";
import { captureSourceLabel, formatDisplayDate, isEstimatedDate } from "@/lib/datetime";
import {
  collectDateEvidence,
  collectTagSuggestions,
  useMediaEnrichment,
  type EnrichableItem,
} from "@/lib/enrich/useMediaEnrichment";
import { pickDateSuggestion } from "@/lib/enrich/date-evidence";
import MetadataFields, { useMetadataOptions } from "@/components/MetadataFields";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CropBox { x: number; y: number; w: number; h: number }

type EditItem =
  | { kind: "existing"; id: string; mediaId: string; thumbUrl: string; type: "photo" | "video"; crop?: CropBox }
  | {
      kind: "new";
      id: string;
      file: File;
      preview: string;
      type: "photo" | "video";
      posterDataUrl?: string;
      crop?: CropBox;
      /** Capture/identity/EXIF from the ORIGINAL file (compression strips it) —
       *  same extraction as the upload page, so edit-added media keeps its
       *  metadata (10.1a-c). */
      capture?: CaptureDateInput;
      contentHash?: string;
      extras?: MediaExtras;
    };

type SaveState = "idle" | "saving" | "success" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let fileIdCounter = 0;
function nextFileId() { return `new-${++fileIdCounter}-${Date.now()}`; }

function isVideoFile(file: File) { return file.type.startsWith("video/"); }

const NEW_ROW_ZONE = 40;

function computeDisplayRows(
  rows: EditItem[][],
  activeId: string | null,
  insertAt: { rowIdx: number; colIdx: number; isNewRow?: boolean } | null
): EditItem[][] {
  if (!activeId || !insertAt) return rows;
  const activeItem = rows.flat().find((f) => f.id === activeId);
  if (!activeItem) return rows;
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
    result.splice(targetRowIdx, 0, [activeItem]);
    return result;
  }

  if (targetRowIdx < 0 || targetRowIdx >= stripped.length) return rows;
  if (stripped[targetRowIdx].length >= 3) return rows;
  const colIdx = Math.min(insertAt.colIdx, stripped[targetRowIdx].length);
  return stripped.map((row, i) => {
    if (i !== targetRowIdx) return row;
    const r = [...row];
    r.splice(colIdx, 0, activeItem);
    return r;
  });
}

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

function defaultLayout(items: EditItem[]): EditItem[][] {
  if (items.length === 0) return [];
  if (items.length <= 3) return [items];
  if (items.length === 4) return [[items[0], items[1]], [items[2], items[3]]];
  const rows: EditItem[][] = [];
  let i = 0;
  while (i < items.length) {
    const rem = items.length - i;
    if (rem <= 3) { rows.push(items.slice(i)); break; }
    if (rem === 4) { rows.push(items.slice(i, i + 2), items.slice(i + 2)); break; }
    rows.push(items.slice(i, i + 3));
    i += 3;
  }
  return rows;
}

/**
 * The datetime-local value for the edit form: the date the feed actually shows
 * (capture-local day, Phase 10.2) rather than the legacy posts.date, so what
 * the user sees in the form matches the post. Time-of-day comes from the
 * capture instant's UTC clock — for offset-carrying captures that can differ
 * from local time-of-day, but the day (which is what display/grouping use) is
 * always the capture-local one.
 */
function effectiveDateInput(post: {
  date?: string | null;
  takenAt?: string | null;
  localDate?: string | null;
}): string {
  if (post.localDate && /^\d{4}-\d{2}-\d{2}$/.test(post.localDate)) {
    let time = "12:00";
    if (post.takenAt) {
      const d = new Date(post.takenAt);
      if (!isNaN(d.getTime())) {
        time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      }
    }
    return `${post.localDate}T${time}`;
  }
  return post.date || "";
}

function layoutToRows(items: EditItem[], layout: string | null): EditItem[][] {
  if (!layout || items.length === 0) return defaultLayout(items);
  const digits = layout.split("").map(Number);
  if (digits.reduce((a, b) => a + b, 0) !== items.length) return defaultLayout(items);
  const rows: EditItem[][] = [];
  let idx = 0;
  for (const count of digits) {
    rows.push(items.slice(idx, idx + count));
    idx += count;
  }
  return rows;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EditPostPage() {
  const params = useParams();
  const postId = params.postId as string;
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Loading state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [postSlug, setPostSlug] = useState("");

  // rows is the source of truth
  const [rows, setRows] = useState<EditItem[][]>([]);

  // Metadata
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  // Where the post's current date came from (posts.date_source), for the hint.
  const [dateSource, setDateSource] = useState<string | null>(null);
  // The loaded date — only a date the user actually changed is sent on save,
  // so an untouched form never overwrites the capture-derived rollup.
  const initialDateRef = useRef("");

  // Tags / People / Albums
  const metadataOptions = useMetadataOptions();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<string[]>([]);

  // Save / delete state
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Drag state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cropTargetId, setCropTargetId] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<{ rowIdx: number; colIdx: number; isNewRow?: boolean } | null>(null);
  const pendingInsertRef = useRef<{ rowIdx: number; colIdx: number; isNewRow?: boolean } | null>(null);
  const insertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flatItems = useMemo(() => rows.flat(), [rows]);

  const displayRows = useMemo(
    () => computeDisplayRows(rows, activeId, insertAt),
    [rows, activeId, insertAt]
  );

  // Vision enrichment for NEWLY ADDED files (existing media was enriched at
  // its own upload, or is covered by the backfill). Same background pass as
  // the upload page.
  const enrichableItems = useMemo<EnrichableItem[]>(
    () =>
      flatItems
        .filter((i): i is Extract<EditItem, { kind: "new" }> => i.kind === "new")
        .map((i) => ({
          id: i.id,
          file: i.file,
          type: i.type,
          contentHash: i.contentHash,
          gps:
            i.extras?.gps && i.extras.gps.lat != null && i.extras.gps.lng != null
              ? { lat: i.extras.gps.lat, lng: i.extras.gps.lng }
              : null,
          takenAt: i.capture ? resolveCaptureDate(i.capture).takenAt : null,
        })),
    [flatItems]
  );
  const { enrichments } = useMediaEnrichment(enrichableItems, { excludePostId: postId });

  // Date read off an added photo (cloud vision + local OCR), weighed against
  // the post's current date. Once the field matches the evidence (or the
  // user edits it close enough), the suggestion disappears on its own.
  const dateEvidence = useMemo(
    () =>
      pickDateSuggestion(collectDateEvidence(enrichments), {
        localDate: date ? date.slice(0, 10) : null,
        source: dateSource,
      }),
    [enrichments, date, dateSource]
  );

  const tagSuggestions = useMemo(() => collectTagSuggestions(enrichments), [enrichments]);

  // ─── Load post data ───────────────────────────────────────────────────────

  useEffect(() => {
    fetch(`/api/admin/posts/${postId}`)
      .then((r) => r.json())
      .then((post) => {
        if (post.error) { setLoadError(post.error); setLoading(false); return; }

        setPostSlug(post.slug as string);
        setTitle(post.title || "");
        const effDate = effectiveDateInput(post);
        setDate(effDate);
        initialDateRef.current = effDate;
        setDateSource(post.dateSource ?? null);
        setSelectedTags(post.tags || []);
        setSelectedPeople(post.people || []);
        setSelectedAlbumIds(post.albumIds || []);

        const existingItems: EditItem[] = (post.media || []).map(
          (m: { id: string; thumbUrl: string; type: "photo" | "video" }) => ({
            kind: "existing" as const,
            id: `existing-${m.id}`,
            mediaId: m.id,
            thumbUrl: m.thumbUrl,
            type: m.type,
          })
        );
        setRows(layoutToRows(existingItems, post.photoset_layout));
        setLoading(false);
      })
      .catch(() => { setLoadError("Failed to load post"); setLoading(false); });
  }, [postId]);

  // ─── Pointer-based drag hit testing ──────────────────────────────────────

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
      const rowEls = Array.from(containerRef.current.querySelectorAll<HTMLElement>("[data-row]"));
      if (rowEls.length === 0) { scheduleInsert(null); return; }

      const lastRect = rowEls[rowEls.length - 1].getBoundingClientRect();
      if (e.clientY > lastRect.bottom) {
        scheduleInsert({ rowIdx: rowEls.length, colIdx: 0, isNewRow: true });
        return;
      }

      for (let ri = 0; ri < rowEls.length; ri++) {
        const rowRect = rowEls[ri].getBoundingClientRect();
        if (e.clientY < rowRect.top || e.clientY > rowRect.bottom) continue;

        const realItemEls = Array.from(rowEls[ri].querySelectorAll<HTMLElement>("[data-item]:not([data-dragging])"));
        if (realItemEls.length === 0) { scheduleInsert({ rowIdx: ri, colIdx: 0, isNewRow: true }); return; }

        if (e.clientY < rowRect.top + NEW_ROW_ZONE) { scheduleInsert({ rowIdx: ri, colIdx: 0, isNewRow: true }); return; }
        if (e.clientY > rowRect.bottom - NEW_ROW_ZONE) { scheduleInsert({ rowIdx: ri + 1, colIdx: 0, isNewRow: true }); return; }

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

  // ─── File handling ────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files || []);
    if (!newFiles.length) return;
    const newItems: EditItem[] = await Promise.all(
      newFiles.map(async (f) => {
        const isVideo = isVideoFile(f);
        // Read capture/identity/EXIF from the ORIGINAL before compression
        // strips it — mirrors the upload page so media added here keeps its
        // metadata instead of silently losing it.
        const capture = await buildCaptureInput(f, isVideo);
        const contentHash = isVideo ? undefined : ((await sha256Hex(f)) ?? undefined);
        const extras = isVideo ? undefined : await extractPhotoExtras(f);
        const processed = isVideo ? f : await compressImage(f);
        return {
          kind: "new" as const,
          id: nextFileId(),
          file: processed,
          preview: URL.createObjectURL(processed),
          type: isVideo ? ("video" as const) : ("photo" as const),
          capture,
          contentHash,
          extras,
        };
      })
    );
    setRows((prev) => {
      const addLayout = defaultLayout(newItems);
      return prev.length === 0 ? addLayout : [...prev, ...addLayout];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeItem(id: string) {
    setRows((prev) =>
      prev
        .map((row) => {
          const item = row.find((x) => x.id === id);
          if (item?.kind === "new") URL.revokeObjectURL(item.preview);
          return row.filter((x) => x.id !== id);
        })
        .filter((r) => r.length > 0)
    );
  }

  function setItemCrop(id: string, crop: CropBox | undefined) {
    setRows((prev) =>
      prev.map((row) => row.map((x) => (x.id === id ? { ...x, crop } : x)))
    );
  }

  const cropTarget = cropTargetId ? flatItems.find((i) => i.id === cropTargetId) : null;
  const cropSrc =
    cropTarget?.kind === "existing"
      ? cropTarget.thumbUrl
      : cropTarget?.kind === "new"
      ? cropTarget.preview
      : null;

  // ─── Video poster capture ─────────────────────────────────────────────────

  const captureVideoPoster = useCallback((itemId: string, videoEl: HTMLVideoElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    setRows((prev) =>
      prev.map((row) =>
        row.map((item) =>
          item.id === itemId && item.kind === "new"
            ? { ...item, posterDataUrl: dataUrl }
            : item
        )
      )
    );
  }, []);

  // ─── Drag ─────────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 400, tolerance: 10 } })
  );

  const audioCtxRef = useRef<AudioContext | null>(null);
  useEffect(() => () => { audioCtxRef.current?.close(); }, []);

  useEffect(() => {
    if (!activeId) return;
    requestAnimationFrame(() => {
      if (navigator.vibrate) { navigator.vibrate(30); return; }
      if (audioCtxRef.current) playHapticClick(audioCtxRef.current);
    });
  }, [activeId]);

  function handleDragStart(event: DragStartEvent) {
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

  // ─── Save ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaveState("saving");
    setSaveError("");

    try {
      // Upload new files first
      const newItems = flatItems.filter((item): item is Extract<EditItem, { kind: "new" }> => item.kind === "new");
      const uploadedNewMap = new Map<string, { r2Key: string; keyPrefix: string }>();

      for (const item of newItems) {
        const presignRes = await fetch("/api/admin/upload/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: item.file.type }),
        });
        if (!presignRes.ok) {
          const data = await presignRes.json();
          throw new Error(data.error || "Failed to get upload URL");
        }
        const { uploadUrl, r2Key, keyPrefix } = await presignRes.json();
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": item.file.type },
          body: item.file,
        });
        if (!uploadRes.ok) throw new Error("Failed to upload file");
        uploadedNewMap.set(item.id, { r2Key, keyPrefix });
      }

      // Build mediaList preserving row order
      const photosetLayout = rows.map((r) => r.length).join("");
      const mediaList = flatItems.map((item) => {
        if (item.kind === "existing") {
          return { kind: "existing" as const, mediaId: item.mediaId, crop: item.crop };
        }
        const uploaded = uploadedNewMap.get(item.id)!;
        return {
          kind: "new" as const,
          r2Key: uploaded.r2Key,
          keyPrefix: uploaded.keyPrefix,
          type: item.type,
          posterDataUrl: item.posterDataUrl,
          crop: item.crop,
          capture: item.capture,
          contentHash: item.contentHash,
          meta: item.extras,
          enrichment: enrichments[item.id]?.cloud,
          ocr: enrichments[item.id]?.ocr,
        };
      });

      const res = await fetch(`/api/admin/posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          // Only send a date the user actually changed — the server records a
          // provided date as a manual override (date_source='manual'), which
          // must not happen from merely opening and saving the form.
          date: date && date !== initialDateRef.current ? date : undefined,
          tags: selectedTags,
          people: selectedPeople,
          albumIds: selectedAlbumIds,
          mediaList,
          photosetLayout: flatItems.length > 1 ? photosetLayout : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");

      setSaveState("success");
      // Don't return via router.back(): back/forward navigation restores the
      // feed from the Router Cache (the pre-edit snapshot) and bypasses the
      // refresh() invalidation, so the edit wouldn't show until a manual
      // refresh. Clear the cache and navigate *forward* to the feed — a dynamic
      // route with no cached entry left, so it refetches fresh from the server.
      setTimeout(() => {
        router.refresh();
        router.replace("/");
      }, 600);
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Network error");
    }
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/posts/${postId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }
      // Clear the Router Cache and navigate forward (not back) so the feed
      // refetches without the deleted post — see the note in handleSave.
      router.refresh();
      router.replace("/");
    } catch (err) {
      setDeleting(false);
      setConfirmDelete(false);
      setSaveError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const activeItem = activeId ? flatItems.find((f) => f.id === activeId) ?? null : null;
  const isBusy = saveState === "saving" || deleting;

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[#1d1c1c] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#427ea3] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#1d1c1c] flex flex-col items-center justify-center gap-4">
        <p className="text-[#d86d6d]">{loadError}</p>
        <a href="/" className="text-sm text-[#888] hover:text-[#427ea3]">Back to feed</a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1d1c1c] text-[#d3d3d3] px-4 py-8">
      <div className="max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-6">Edit post</h1>

        {/* Add more files */}
        <label className="block border-2 border-dashed border-[#3a3939] rounded-xl p-6 text-center cursor-pointer hover:border-[#427ea3] transition-colors mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
            multiple
            className="hidden"
            onChange={handleFileChange}
            disabled={isBusy}
          />
          <div className="text-[#888] space-y-0.5">
            <div className="text-2xl">+</div>
            <div className="text-sm">Add photos or videos</div>
          </div>
        </label>

        {/* Media grid */}
        {flatItems.length > 0 && (
          <div className="space-y-6">
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div ref={containerRef} className="space-y-2">
                {displayRows.map((row, rowIdx) => {
                  if (activeId && row.length === 1 && row[0].id === activeId) {
                    return (
                      <div key={rowIdx} data-row className="flex items-center" style={{ height: 20 }}>
                        <DraggableItem
                          item={row[0]}
                          disabled={isBusy}
                          onRemove={removeItem}
                          onPosterCapture={captureVideoPoster}
                          asIndicator="horizontal"
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={rowIdx} data-row className="flex gap-2" style={{ height: 160 }}>
                      {row.map((item) => (
                        <DraggableItem
                          key={item.id}
                          item={item}
                          disabled={isBusy}
                          onRemove={removeItem}
                          onCrop={setCropTargetId}
                          onPosterCapture={captureVideoPoster}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>

              <DragOverlay dropAnimation={null}>
                {activeItem ? (
                  <div className="w-36 h-40 rounded-lg overflow-hidden opacity-95 shadow-2xl cursor-grabbing select-none ring-2 ring-[#427ea3]">
                    {activeItem.kind === "existing" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={activeItem.thumbUrl} alt="" className="w-full h-full object-cover" />
                    ) : activeItem.kind === "new" && activeItem.posterDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={activeItem.posterDataUrl} alt="" className="w-full h-full object-cover" />
                    ) : activeItem.kind === "new" && activeItem.type === "photo" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={activeItem.preview} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-[#141313] flex items-center justify-center text-[#666] text-xs">VIDEO</div>
                    )}
                  </div>
                ) : null}
              </DragOverlay>
            </DndContext>

            {flatItems.length > 1 && !isBusy && (
              <p className="text-[10px] text-[#666] text-center -mt-4">Hold to reorder</p>
            )}

            {/* Title / date / tags / people / albums */}
            <MetadataFields
              options={metadataOptions}
              title={title}
              onTitleChange={setTitle}
              date={date}
              onDateChange={setDate}
              dateLabel="Date"
              dateHint={
                <>
                  {date && date !== initialDateRef.current ? (
                    <span className="text-[#c2a467]">
                      Will be saved as{" "}
                      <span className="font-semibold">
                        {formatDisplayDate(date, date.slice(0, 10))}
                      </span>{" "}
                      · set manually.
                    </span>
                  ) : date ? (
                    <span className={isEstimatedDate(dateSource) ? "text-[#c2a467]" : "text-[#888]"}>
                      Shown on the post as{" "}
                      <span className="text-[#c9c4ba]">
                        {formatDisplayDate(date, date.slice(0, 10))}
                      </span>{" "}
                      · {captureSourceLabel(dateSource)}. Change it above if it&apos;s wrong.
                    </span>
                  ) : null}
                  {dateEvidence && (
                    <span className="block mt-1.5 text-[#c2a467]">
                      An added photo shows{" "}
                      <span className="text-[#c9c4ba]">&ldquo;{dateEvidence.quotedText}&rdquo;</span>
                      {dateEvidence.conflict && " — which disagrees with the current date"}
                      .{" "}
                      <button
                        onClick={() => setDate(`${dateEvidence.date}T12:00`)}
                        className="underline decoration-dotted underline-offset-2 font-semibold text-[#c2a467] hover:text-[#d2b577]"
                      >
                        Use {formatDisplayDate("", dateEvidence.date)}
                      </button>
                    </span>
                  )}
                </>
              }
              tagSuggestions={tagSuggestions}
              selectedTags={selectedTags}
              onTagsChange={setSelectedTags}
              selectedPeople={selectedPeople}
              onPeopleChange={setSelectedPeople}
              selectedAlbumIds={selectedAlbumIds}
              onAlbumIdsChange={setSelectedAlbumIds}
              disabled={isBusy}
            />

            {/* Save button */}
            {saveState === "idle" && (
              <button
                onClick={handleSave}
                className="w-full bg-[#427ea3] text-white rounded-lg py-3 font-semibold hover:bg-[#3a6f91] transition-colors"
              >
                Save changes
              </button>
            )}

            {saveState === "saving" && (
              <div className="text-center py-3 text-[#888]">
                <div className="inline-block w-5 h-5 border-2 border-[#427ea3] border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                Saving...
              </div>
            )}

            {saveState === "success" && (
              <div className="bg-[#1a2e1a] border border-[#2d4a2d] rounded-lg p-4 text-[#6db86d] font-semibold text-center">
                Saved!
              </div>
            )}

            {saveState === "error" && (
              <div className="space-y-3">
                <div className="bg-[#2e1a1a] border border-[#4a2d2d] rounded-lg p-4 text-[#d86d6d]">{saveError}</div>
                <button onClick={() => setSaveState("idle")} className="w-full bg-[#2a2929] text-[#d3d3d3] rounded-lg py-3 hover:bg-[#333] transition-colors">Try again</button>
              </div>
            )}
          </div>
        )}

        {/* No media state */}
        {flatItems.length === 0 && !loading && (
          <div className="space-y-6 mt-4">
            <input
              type="text"
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isBusy}
              className="w-full bg-[#2a2929] rounded-lg px-4 py-3 text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3] disabled:opacity-50"
            />
            {saveState === "idle" && (
              <button
                onClick={handleSave}
                className="w-full bg-[#427ea3] text-white rounded-lg py-3 font-semibold hover:bg-[#3a6f91] transition-colors"
              >
                Save changes
              </button>
            )}
            {saveState === "error" && (
              <div className="space-y-3">
                <div className="bg-[#2e1a1a] border border-[#4a2d2d] rounded-lg p-4 text-[#d86d6d]">{saveError}</div>
                <button onClick={() => setSaveState("idle")} className="w-full bg-[#2a2929] text-[#d3d3d3] rounded-lg py-3 hover:bg-[#333] transition-colors">Try again</button>
              </div>
            )}
          </div>
        )}

        {/* Delete section */}
        <div className="mt-10 pt-6 border-t border-[#2a2929]">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={isBusy}
              className="w-full text-sm text-[#664444] hover:text-[#d86d6d] transition-colors py-2 disabled:opacity-50"
            >
              Delete post
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-center text-[#a0a0a0]">
                Delete this post and all its media? This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="flex-1 bg-[#2a2929] text-[#d3d3d3] rounded-lg py-2.5 text-sm hover:bg-[#333] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 bg-[#7a2020] text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-[#8a2525] transition-colors disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : "Yes, delete"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Cancel */}
        <div className="mt-6 text-center">
          <button
            onClick={() => router.back()}
            className="text-sm text-[#888] hover:text-[#427ea3] transition-colors"
          >
            Cancel
          </button>
        </div>

        {cropTargetId && cropSrc && (
          <CropModalCoords
            src={cropSrc}
            initial={cropTarget?.crop}
            hasCrop={!!cropTarget?.crop}
            onApply={(box) => { setItemCrop(cropTargetId, box); setCropTargetId(null); }}
            onReset={() => { setItemCrop(cropTargetId, undefined); setCropTargetId(null); }}
            onCancel={() => setCropTargetId(null)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Draggable Item ───────────────────────────────────────────────────────────

function DraggableItem({
  item,
  disabled,
  onRemove,
  onCrop,
  onPosterCapture,
  asIndicator,
}: {
  item: EditItem;
  disabled: boolean;
  onRemove: (id: string) => void;
  onCrop?: (id: string) => void;
  onPosterCapture: (itemId: string, video: HTMLVideoElement) => void;
  asIndicator?: "horizontal";
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled });

  if (asIndicator === "horizontal") {
    return <div ref={setNodeRef} {...attributes} className="flex-1 h-0.5 rounded-full bg-[#427ea3]" />;
  }

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

  const thumbSrc =
    item.kind === "existing"
      ? item.thumbUrl
      : item.kind === "new" && item.posterDataUrl
      ? item.posterDataUrl
      : item.kind === "new"
      ? item.preview
      : undefined;

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
      {thumbSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbSrc} alt="" className="w-full h-full object-cover pointer-events-none" />
      ) : item.type === "video" ? (
        item.kind === "new" ? (
          <VideoPreview file={item} onPosterCapture={onPosterCapture} />
        ) : (
          <div className="w-full h-full bg-[#141313] flex items-center justify-center text-[#666] text-xs">VIDEO</div>
        )
      ) : null}

      {!disabled && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemove(item.id)}
          className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-[10px] flex items-center justify-center text-white"
        >
          ×
        </button>
      )}

      {item.type === "video" && (
        <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white">VIDEO</div>
      )}

      {/* Crop button — photos only; stops pointer propagation so it doesn't start a drag */}
      {!disabled && onCrop && item.type === "photo" && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onCrop(item.id)}
          className="absolute bottom-1 right-1 w-7 h-7 flex items-center justify-center bg-black/55 rounded active:bg-[#427ea3]/80"
          aria-label="Crop image"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <path d="M6 2v14a2 2 0 002 2h14" />
            <path d="M18 22V8a2 2 0 00-2-2H2" />
          </svg>
        </button>
      )}

      {/* Staged-crop badge — the actual crop is applied server-side on Save */}
      {item.crop && (
        <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-[#c2a467] text-[#1a1715] rounded text-[9px] font-bold flex items-center gap-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
            <path d="M6 2v14a2 2 0 002 2h14" />
            <path d="M18 22V8a2 2 0 00-2-2H2" />
          </svg>
          CROPPED
        </div>
      )}
    </div>
  );
}

// ─── Video Preview ────────────────────────────────────────────────────────────

function VideoPreview({
  file,
  onPosterCapture,
}: {
  file: Extract<EditItem, { kind: "new" }>;
  onPosterCapture: (itemId: string, video: HTMLVideoElement) => void;
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

// ─── Crop Modal (coordinate-based) ──────────────────────────────────────────────
// Captures a crop box as fractions of the image and hands it back; the actual
// pixel crop happens server-side on Save (works for already-uploaded photos and
// avoids reading cross-origin pixels in the browser). Draw logic mirrors the
// upload page's cropper.

function CropModalCoords({
  src,
  initial,
  hasCrop,
  onApply,
  onReset,
  onCancel,
}: {
  src: string;
  initial?: CropBox;
  hasCrop: boolean;
  onApply: (box: CropBox) => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [crop, setCrop] = useState<CropBox>(initial ?? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 });

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

  const sc = loaded ? getScale() : null;
  const box = sc ? {
    left: sc.ox + crop.x * sc.dw,
    top: sc.oy + crop.y * sc.dh,
    w: crop.w * sc.dw,
    h: crop.h * sc.dh,
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
          src={src}
          alt=""
          className="w-full h-full object-contain"
          onLoad={() => setLoaded(true)}
          draggable={false}
        />
        {box && (
          <>
            <div
              className="absolute border border-white/80 pointer-events-none"
              style={{ left: box.left, top: box.top, width: box.w, height: box.h, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
            />
            <div
              className="absolute touch-none cursor-move"
              style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
              {...makeDragHandlers("center")}
            />
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
        <div className="flex items-center gap-2">
          {hasCrop && (
            <button onClick={onReset} className="text-white/60 text-base px-4 py-2 active:text-white">
              Remove crop
            </button>
          )}
          <button
            onClick={() => onApply(crop)}
            className="bg-[#427ea3] text-white text-base font-semibold px-6 py-2.5 rounded-full active:bg-[#3a6f91]"
          >
            Apply crop
          </button>
        </div>
      </div>
    </div>
  );
}
