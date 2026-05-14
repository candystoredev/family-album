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

// ─── Types ────────────────────────────────────────────────────────────────────

type EditItem =
  | { kind: "existing"; id: string; mediaId: string; thumbUrl: string; type: "photo" | "video" }
  | { kind: "new"; id: string; file: File; preview: string; type: "photo" | "video"; posterDataUrl?: string };

interface TagOption { id: string; name: string; slug: string }
interface PersonOption { id: string; name: string; slug: string }
interface AlbumOption { id: string; title: string; slug: string }

type SaveState = "idle" | "saving" | "success" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let fileIdCounter = 0;
function nextFileId() { return `new-${++fileIdCounter}-${Date.now()}`; }

function isVideoFile(file: File) { return file.type.startsWith("video/"); }

async function compressImage(file: File, maxPx = 1920, quality = 0.82): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxPx && h <= maxPx) { resolve(file); return; }
      const scale = maxPx / Math.max(w, h);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

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

  // Tags / People / Albums
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [allPeople, setAllPeople] = useState<PersonOption[]>([]);
  const [allAlbums, setAllAlbums] = useState<AlbumOption[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [newPerson, setNewPerson] = useState("");

  // Save / delete state
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Drag state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<{ rowIdx: number; colIdx: number; isNewRow?: boolean } | null>(null);
  const pendingInsertRef = useRef<{ rowIdx: number; colIdx: number; isNewRow?: boolean } | null>(null);
  const insertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flatItems = useMemo(() => rows.flat(), [rows]);

  const displayRows = useMemo(
    () => computeDisplayRows(rows, activeId, insertAt),
    [rows, activeId, insertAt]
  );

  // ─── Load post data ───────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/posts/${postId}`).then((r) => r.json()),
      fetch("/api/admin/tags").then((r) => r.json()).catch(() => []),
      fetch("/api/admin/people").then((r) => r.json()).catch(() => []),
      fetch("/api/admin/albums").then((r) => r.json()).catch(() => []),
    ])
      .then(([post, tags, people, albums]) => {
        if (post.error) { setLoadError(post.error); setLoading(false); return; }

        setPostSlug(post.slug as string);
        setTitle(post.title || "");
        setDate(post.date || "");
        setSelectedTags(post.tags || []);
        setSelectedPeople(post.people || []);
        setSelectedAlbumIds(post.albumIds || []);
        setAllTags(tags);
        setAllPeople(people);
        setAllAlbums(albums);

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
        const processed = isVideo ? f : await compressImage(f);
        return {
          kind: "new" as const,
          id: nextFileId(),
          file: processed,
          preview: URL.createObjectURL(processed),
          type: isVideo ? ("video" as const) : ("photo" as const),
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

  // ─── Tag/People helpers ───────────────────────────────────────────────────

  function addTag(name: string) {
    const t = name.trim();
    if (!t) return;
    if (!selectedTags.includes(t)) setSelectedTags((prev) => [...prev, t]);
    setNewTag("");
  }

  function addPerson(name: string) {
    const t = name.trim();
    if (!t) return;
    if (!selectedPeople.includes(t)) setSelectedPeople((prev) => [...prev, t]);
    setNewPerson("");
  }

  function toggleAlbum(id: string) {
    setSelectedAlbumIds((prev) => prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]);
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
          return { kind: "existing" as const, mediaId: item.mediaId };
        }
        const uploaded = uploadedNewMap.get(item.id)!;
        return {
          kind: "new" as const,
          r2Key: uploaded.r2Key,
          keyPrefix: uploaded.keyPrefix,
          type: item.type,
          posterDataUrl: item.posterDataUrl,
        };
      });

      const res = await fetch(`/api/admin/posts/${postId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          date: date || undefined,
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
      setTimeout(() => router.back(), 600);
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
      router.push("/");
    } catch (err) {
      setDeleting(false);
      setConfirmDelete(false);
      setSaveError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  // ─── Suggestions ─────────────────────────────────────────────────────────

  const tagSuggestions = allTags.filter(
    (t) => !selectedTags.includes(t.name) && t.name.toLowerCase().includes(newTag.toLowerCase()) && newTag.length > 0
  );

  const peopleSuggestions = allPeople.filter(
    (p) => !selectedPeople.includes(p.name) && p.name.toLowerCase().includes(newPerson.toLowerCase()) && newPerson.length > 0
  );

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

            {/* Title */}
            <input
              type="text"
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isBusy}
              className="w-full bg-[#2a2929] rounded-lg px-4 py-3 text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3] disabled:opacity-50"
            />

            {/* Date */}
            <div>
              <label className="block text-xs text-[#888] mb-1">Date</label>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={isBusy}
                className="w-full bg-[#2a2929] rounded-lg px-4 py-3 text-[#d3d3d3] outline-none focus:ring-1 focus:ring-[#427ea3] disabled:opacity-50"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs text-[#888] mb-1">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedTags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-1 bg-[#2a2929] rounded text-sm text-[#a0a0a0]">
                    #{tag}
                    {!isBusy && (
                      <button onClick={() => setSelectedTags((p) => p.filter((t) => t !== tag))} className="text-[#666] hover:text-[#d86d6d] ml-0.5">×</button>
                    )}
                  </span>
                ))}
              </div>
              {!isBusy && (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Add tag..."
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && newTag.trim()) { e.preventDefault(); addTag(newTag); } }}
                    className="w-full bg-[#2a2929] rounded-lg px-4 py-2.5 text-sm text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3]"
                  />
                  {tagSuggestions.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-[#2a2929] rounded-lg border border-[#3a3939] max-h-40 overflow-y-auto">
                      {tagSuggestions.map((t) => (
                        <button key={t.id} onClick={() => addTag(t.name)} className="w-full text-left px-4 py-2 text-sm text-[#a0a0a0] hover:bg-[#333] hover:text-[#d3d3d3]">#{t.name}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* People */}
            <div>
              <label className="block text-xs text-[#888] mb-1">People</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedPeople.map((person) => (
                  <span key={person} className="inline-flex items-center gap-1 px-2 py-1 bg-[#2a2929] rounded text-sm text-[#a0a0a0]">
                    @{person}
                    {!isBusy && (
                      <button onClick={() => setSelectedPeople((p) => p.filter((x) => x !== person))} className="text-[#666] hover:text-[#d86d6d] ml-0.5">×</button>
                    )}
                  </span>
                ))}
              </div>
              {!isBusy && (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Add person..."
                    value={newPerson}
                    onChange={(e) => setNewPerson(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && newPerson.trim()) { e.preventDefault(); addPerson(newPerson); } }}
                    className="w-full bg-[#2a2929] rounded-lg px-4 py-2.5 text-sm text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3]"
                  />
                  {peopleSuggestions.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-[#2a2929] rounded-lg border border-[#3a3939] max-h-40 overflow-y-auto">
                      {peopleSuggestions.map((p) => (
                        <button key={p.id} onClick={() => addPerson(p.name)} className="w-full text-left px-4 py-2 text-sm text-[#a0a0a0] hover:bg-[#333] hover:text-[#d3d3d3]">@{p.name}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Albums */}
            {allAlbums.length > 0 && (
              <div>
                <label className="block text-xs text-[#888] mb-1">Albums</label>
                <div className="flex flex-wrap gap-1.5">
                  {allAlbums.map((album) => (
                    <button
                      key={album.id}
                      onClick={() => !isBusy && toggleAlbum(album.id)}
                      disabled={isBusy}
                      className={`px-3 py-1.5 rounded text-sm transition-colors ${
                        selectedAlbumIds.includes(album.id)
                          ? "bg-[#427ea3] text-white"
                          : "bg-[#2a2929] text-[#a0a0a0] hover:bg-[#333]"
                      } disabled:opacity-50`}
                    >
                      {album.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
      </div>
    </div>
  );
}

// ─── Draggable Item ───────────────────────────────────────────────────────────

function DraggableItem({
  item,
  disabled,
  onRemove,
  onPosterCapture,
  asIndicator,
}: {
  item: EditItem;
  disabled: boolean;
  onRemove: (id: string) => void;
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
