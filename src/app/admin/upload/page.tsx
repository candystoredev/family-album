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

// ─── Types ───────────────────────────────────────────────────────────────────

type UploadState = "idle" | "uploading" | "success" | "error";

interface MediaFile {
  id: string;
  file: File;
  preview: string;
  type: "photo" | "video";
  posterDataUrl?: string;
}

interface TagOption {
  id: string;
  name: string;
  slug: string;
}
interface PersonOption {
  id: string;
  name: string;
  slug: string;
}
interface AlbumOption {
  id: string;
  title: string;
  slug: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let fileIdCounter = 0;
function nextFileId() {
  return `f-${++fileIdCounter}-${Date.now()}`;
}

function isVideoFile(file: File) {
  return file.type.startsWith("video/");
}

/** Resize + JPEG-compress a photo client-side before upload. Falls back to original on error. */
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

/** Convert a flat array into the default 2D row layout. */
function defaultLayout(files: MediaFile[]): MediaFile[][] {
  if (files.length === 0) return [];
  if (files.length <= 3) return [files];
  if (files.length === 4) return [[files[0], files[1]], [files[2], files[3]]];
  const rows: MediaFile[][] = [];
  let i = 0;
  while (i < files.length) {
    const rem = files.length - i;
    if (rem <= 3) { rows.push(files.slice(i)); break; }
    if (rem === 4) { rows.push(files.slice(i, i + 2), files.slice(i + 2)); break; }
    rows.push(files.slice(i, i + 3));
    i += 3;
  }
  return rows;
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
  const [allTags, setAllTags] = useState<TagOption[]>([]);
  const [allPeople, setAllPeople] = useState<PersonOption[]>([]);
  const [allAlbums, setAllAlbums] = useState<AlbumOption[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [newPerson, setNewPerson] = useState("");

  // Upload state
  const [state, setState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [resultSlug, setResultSlug] = useState("");

  // Drag state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [insertAt, setInsertAt] = useState<{
    rowIdx: number;
    colIdx: number;
    isNewRow?: boolean;
  } | null>(null);

  // Flat file list for upload ordering
  const flatFiles = useMemo(() => rows.flat(), [rows]);

  // Live preview: item moves to hovered row/col while dragging
  const displayRows = useMemo(() => {
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
  }, [rows, activeId, insertAt]);

  // Load tags/people/albums on mount
  useEffect(() => {
    fetch("/api/admin/tags")
      .then((r) => r.json())
      .then(setAllTags)
      .catch(() => {});
    fetch("/api/admin/people")
      .then((r) => r.json())
      .then(setAllPeople)
      .catch(() => {});
    fetch("/api/admin/albums")
      .then((r) => r.json())
      .then(setAllAlbums)
      .catch(() => {});
  }, []);

  // Hit-test pointer position against rows/items during drag.
  // Top/bottom 24px of each row = create new row; middle = drop into row.
  useEffect(() => {
    if (!activeId) return;
    const NEW_ROW_ZONE = 24;
    function onPointerMove(e: PointerEvent) {
      if (!containerRef.current) return;
      const rowEls = Array.from(
        containerRef.current.querySelectorAll<HTMLElement>("[data-row]")
      );
      if (rowEls.length === 0) { setInsertAt(null); return; }

      // Pointer below all rows → new row at end
      const lastRect = rowEls[rowEls.length - 1].getBoundingClientRect();
      if (e.clientY > lastRect.bottom) {
        setInsertAt({ rowIdx: rowEls.length, colIdx: 0, isNewRow: true });
        return;
      }

      for (let ri = 0; ri < rowEls.length; ri++) {
        const rowRect = rowEls[ri].getBoundingClientRect();
        if (e.clientY < rowRect.top || e.clientY > rowRect.bottom) continue;

        // Row has only the dragging ghost — keep it as a standalone new row
        const realItemEls = Array.from(
          rowEls[ri].querySelectorAll<HTMLElement>("[data-item]:not([data-dragging])")
        );
        if (realItemEls.length === 0) {
          setInsertAt({ rowIdx: ri, colIdx: 0, isNewRow: true });
          return;
        }

        // Top zone → new row before this row
        if (e.clientY < rowRect.top + NEW_ROW_ZONE) {
          setInsertAt({ rowIdx: ri, colIdx: 0, isNewRow: true });
          return;
        }
        // Bottom zone → new row after this row
        if (e.clientY > rowRect.bottom - NEW_ROW_ZONE) {
          setInsertAt({ rowIdx: ri + 1, colIdx: 0, isNewRow: true });
          return;
        }

        // Middle → drop into this row; use only real (non-dragging) items for column detection
        let colIdx = realItemEls.length;
        for (let ci = 0; ci < realItemEls.length; ci++) {
          const r = realItemEls[ci].getBoundingClientRect();
          if (e.clientX < r.left + r.width / 2) { colIdx = ci; break; }
        }
        setInsertAt({ rowIdx: ri, colIdx, isNewRow: false });
        return;
      }
      setInsertAt(null);
    }
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [activeId]);

  // ─── File handling ──────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files || []);
    if (!newFiles.length) return;
    const mediaFiles: MediaFile[] = await Promise.all(
      newFiles.map(async (f) => {
        const isVideo = isVideoFile(f);
        const processed = isVideo ? f : await compressImage(f);
        return {
          id: nextFileId(),
          file: processed,
          preview: URL.createObjectURL(processed),
          type: isVideo ? ("video" as const) : ("photo" as const),
        };
      })
    );
    setRows((prev) =>
      prev.length === 0
        ? defaultLayout(mediaFiles)
        : [...prev, ...defaultLayout(mediaFiles)]
    );
    setError("");
    setState("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

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

  function handleDragStart(event: DragStartEvent) {
    navigator.vibrate?.(40); // haptic on Android (iOS Safari doesn't support this)
    setActiveId(event.active.id as string);
  }

  function handleDragEnd() {
    if (insertAt && displayRows !== rows) setRows(displayRows);
    setActiveId(null);
    setInsertAt(null);
  }

  function handleDragCancel() {
    setActiveId(null);
    setInsertAt(null);
  }

  // ─── Tag/People helpers ─────────────────────────────────────────────────────

  function addTag(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!selectedTags.includes(trimmed)) setSelectedTags((prev) => [...prev, trimmed]);
    setNewTag("");
  }

  function removeTag(name: string) {
    setSelectedTags((prev) => prev.filter((t) => t !== name));
  }

  function addPerson(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!selectedPeople.includes(trimmed)) setSelectedPeople((prev) => [...prev, trimmed]);
    setNewPerson("");
  }

  function removePerson(name: string) {
    setSelectedPeople((prev) => prev.filter((p) => p !== name));
  }

  function toggleAlbum(id: string) {
    setSelectedAlbumIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
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
        return { r2Key, keyPrefix, type: mf.type, posterDataUrl: mf.posterDataUrl };
      });

      const uploadedItems = await Promise.all(uploadPromises);
      const photosetLayout = rows.map((r) => r.length).join("");

      setProgress("Finalizing...");
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
    setNewTag("");
    setNewPerson("");
    setState("idle");
    setProgress("");
    setError("");
    setResultSlug("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const disabled = state === "uploading" || state === "success";

  // ─── Filtered suggestions ──────────────────────────────────────────────────

  const tagSuggestions = allTags.filter(
    (t) =>
      !selectedTags.includes(t.name) &&
      t.name.toLowerCase().includes(newTag.toLowerCase()) &&
      newTag.length > 0
  );

  const peopleSuggestions = allPeople.filter(
    (p) =>
      !selectedPeople.includes(p.name) &&
      p.name.toLowerCase().includes(newPerson.toLowerCase()) &&
      newPerson.length > 0
  );

  const activeFile = activeId ? flatFiles.find((f) => f.id === activeId) ?? null : null;

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#1d1c1c] text-[#d3d3d3] px-4 py-8">
      <div className="max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-6">Upload</h1>

        {/* File picker */}
        <label className="block border-2 border-dashed border-[#3a3939] rounded-xl p-8 text-center cursor-pointer hover:border-[#427ea3] transition-colors mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/webm"
            multiple
            className="hidden"
            onChange={handleFileChange}
            disabled={disabled}
          />
          <div className="text-[#888] space-y-1">
            <div className="text-3xl">+</div>
            <div className="text-sm">
              {flatFiles.length === 0 ? "Tap to choose photos or videos" : "Add more files"}
            </div>
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
                {displayRows.map((row, rowIdx) => (
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
                ))}
              </div>

              <DragOverlay dropAnimation={null}>
                {activeFile ? (
                  <div className="w-28 h-28 rounded-lg overflow-hidden opacity-90 shadow-2xl cursor-grabbing select-none ring-2 ring-[#427ea3]">
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

            {/* Title */}
            <input
              type="text"
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled}
              className="w-full bg-[#2a2929] rounded-lg px-4 py-3 text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3] disabled:opacity-50"
            />

            {/* Date override */}
            <div>
              <label className="block text-xs text-[#888] mb-1">
                Date (auto-detected from photo EXIF if left empty)
              </label>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={disabled}
                className="w-full bg-[#2a2929] rounded-lg px-4 py-3 text-[#d3d3d3] outline-none focus:ring-1 focus:ring-[#427ea3] disabled:opacity-50"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-xs text-[#888] mb-1">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-[#2a2929] rounded text-sm text-[#a0a0a0]"
                  >
                    #{tag}
                    {!disabled && (
                      <button
                        onClick={() => removeTag(tag)}
                        className="text-[#666] hover:text-[#d86d6d] ml-0.5"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {!disabled && (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Add tag..."
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newTag.trim()) {
                        e.preventDefault();
                        addTag(newTag);
                      }
                    }}
                    className="w-full bg-[#2a2929] rounded-lg px-4 py-2.5 text-sm text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3]"
                  />
                  {tagSuggestions.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-[#2a2929] rounded-lg border border-[#3a3939] max-h-40 overflow-y-auto">
                      {tagSuggestions.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => addTag(t.name)}
                          className="w-full text-left px-4 py-2 text-sm text-[#a0a0a0] hover:bg-[#333] hover:text-[#d3d3d3]"
                        >
                          #{t.name}
                        </button>
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
                  <span
                    key={person}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-[#2a2929] rounded text-sm text-[#a0a0a0]"
                  >
                    @{person}
                    {!disabled && (
                      <button
                        onClick={() => removePerson(person)}
                        className="text-[#666] hover:text-[#d86d6d] ml-0.5"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {!disabled && (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Add person..."
                    value={newPerson}
                    onChange={(e) => setNewPerson(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newPerson.trim()) {
                        e.preventDefault();
                        addPerson(newPerson);
                      }
                    }}
                    className="w-full bg-[#2a2929] rounded-lg px-4 py-2.5 text-sm text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3]"
                  />
                  {peopleSuggestions.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-[#2a2929] rounded-lg border border-[#3a3939] max-h-40 overflow-y-auto">
                      {peopleSuggestions.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => addPerson(p.name)}
                          className="w-full text-left px-4 py-2 text-sm text-[#a0a0a0] hover:bg-[#333] hover:text-[#d3d3d3]"
                        >
                          @{p.name}
                        </button>
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
                      onClick={() => !disabled && toggleAlbum(album.id)}
                      disabled={disabled}
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

            {/* Upload button */}
            {state === "idle" && (
              <button
                onClick={handleUpload}
                className="w-full bg-[#427ea3] text-white rounded-lg py-3 font-semibold hover:bg-[#3a6f91] transition-colors"
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

            {/* Reset */}
            {state === "idle" && (
              <button
                onClick={reset}
                className="w-full text-sm text-[#666] hover:text-[#888] transition-colors py-2"
              >
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Back link */}
        <div className="mt-8 text-center">
          <a href="/" className="text-sm text-[#888] hover:text-[#427ea3] transition-colors">
            Back to feed
          </a>
        </div>
      </div>

      {/* Trash FAB — discard in-progress post */}
      {rows.length > 0 && !disabled && (
        <button
          onClick={reset}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-14 h-14 rounded-full bg-[#d4d4d4] shadow-lg shadow-black/40 flex items-center justify-center active:scale-95 transition-transform duration-100"
          aria-label="Discard post"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
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
}: {
  mf: MediaFile;
  disabled: boolean;
  onRemove: (id: string) => void;
  onPosterCapture: (fileId: string, video: HTMLVideoElement) => void;
  onCrop: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: mf.id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      data-item
      {...(isDragging ? { "data-dragging": "" } : {})}
      {...attributes}
      {...listeners}
      style={{ touchAction: "pan-y" }}
      className={`relative h-full flex-1 min-w-0 overflow-hidden rounded-lg bg-[#141313] select-none ${
        disabled ? "cursor-default" : "cursor-grab"
      }`}
    >
      <div className={`h-full ${isDragging ? "opacity-0" : "opacity-100"}`}>
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

      {isDragging && (
        <div className="absolute inset-0 border-2 border-dashed border-[#427ea3]/60 rounded-lg" />
      )}

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
      playsInline
      onLoadedData={handleLoaded}
      onSeeked={handleSeeked}
      className="w-full h-full object-cover"
    />
  );
}
