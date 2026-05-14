"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";

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

/**
 * Derive the default row layout for N photos.
 * Returns an array of row widths, e.g. [2, 2] for 4 photos.
 * The resulting layout string (joined) matches the DB photoset_layout format.
 */
function deriveRowLayout(count: number): number[] {
  if (count === 0) return [];
  if (count === 1) return [1];
  if (count === 2) return [2];
  if (count === 3) return [2, 1];
  if (count === 4) return [2, 2];
  // 5+: fill rows of 3; when 4 remain, split 2+2 to avoid orphaned single
  const rows: number[] = [];
  let rem = count;
  while (rem > 0) {
    if (rem <= 3) { rows.push(rem); break; }
    if (rem === 4) { rows.push(2, 2); break; }
    rows.push(3);
    rem -= 3;
  }
  return rows;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Media files (flat ordered array — source of truth)
  const [files, setFiles] = useState<MediaFile[]>([]);

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
  const [overId, setOverId] = useState<string | null>(null);

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

  // ─── File handling ──────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files || []);
    if (!newFiles.length) return;
    const mediaFiles: MediaFile[] = newFiles.map((f) => ({
      id: nextFileId(),
      file: f,
      preview: URL.createObjectURL(f),
      type: isVideoFile(f) ? "video" : "photo",
    }));
    setFiles((prev) => [...prev, ...mediaFiles]);
    setError("");
    setState("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(id: string) {
    setFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.preview);
      return prev.filter((x) => x.id !== id);
    });
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
      setFiles((prev) =>
        prev.map((f) => (f.id === fileId ? { ...f, posterDataUrl: dataUrl } : f))
      );
    },
    []
  );

  // ─── Drag reorder ──────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Live reorder preview: reflects where the dragged item would land before drop
  const displayFiles = useMemo(() => {
    if (!activeId || !overId || activeId === overId) return files;
    const ai = files.findIndex((f) => f.id === activeId);
    const oi = files.findIndex((f) => f.id === overId);
    return ai >= 0 && oi >= 0 ? arrayMove(files, ai, oi) : files;
  }, [files, activeId, overId]);

  // Row layout auto-derived from count — produces the photoset_layout string
  const rowLayout = useMemo(() => deriveRowLayout(displayFiles.length), [displayFiles.length]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragOver(event: DragOverEvent) {
    setOverId((event.over?.id as string) ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    setOverId(null);
    if (!over || active.id === over.id) return;
    setFiles((prev) => {
      const ai = prev.findIndex((f) => f.id === active.id);
      const oi = prev.findIndex((f) => f.id === over.id);
      return arrayMove(prev, ai, oi);
    });
  }

  function handleDragCancel() {
    setActiveId(null);
    setOverId(null);
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
    if (files.length === 0) return;
    setState("uploading");
    setError("");

    try {
      setProgress(`Uploading ${files.length} ${files.length === 1 ? "file" : "files"}...`);

      const uploadPromises = files.map(async (mf, i) => {
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

      // Derive layout from the committed file order at upload time
      const layout = deriveRowLayout(files.length);

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
          photosetLayout: files.length > 1 ? layout.join("") : undefined,
        }),
      });

      const data = await completeRes.json();
      if (!completeRes.ok) throw new Error(data.error || "Processing failed");

      setState("success");
      setResultSlug(data.slug);
      router.push(`/posts/${data.slug}`);
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Network error — please try again");
    }
  }

  function reset() {
    files.forEach((f) => URL.revokeObjectURL(f.preview));
    setFiles([]);
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

  const activeFile = activeId ? files.find((f) => f.id === activeId) ?? null : null;

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
              {files.length === 0 ? "Tap to choose photos or videos" : "Add more files"}
            </div>
          </div>
        </label>

        {/* Media grid + metadata */}
        {files.length > 0 && (
          <div className="space-y-6">
            {/* Row-based photoset grid */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext
                items={displayFiles.map((f) => f.id)}
                strategy={rectSortingStrategy}
              >
                <div className="space-y-2">
                  {(() => {
                    const rows: React.ReactNode[] = [];
                    let cursor = 0;
                    for (let r = 0; r < rowLayout.length; r++) {
                      const width = rowLayout[r];
                      const rowFiles = displayFiles.slice(cursor, cursor + width);
                      const startIdx = cursor;
                      cursor += width;
                      rows.push(
                        <div key={startIdx} className="flex gap-2" style={{ height: 128 }}>
                          {rowFiles.map((mf, i) => (
                            <SortableMediaItem
                              key={mf.id}
                              mf={mf}
                              disabled={disabled}
                              onRemove={removeFile}
                              onPosterCapture={captureVideoPoster}
                            />
                          ))}
                        </div>
                      );
                    }
                    return rows;
                  })()}
                </div>
              </SortableContext>

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

            {files.length > 1 && !disabled && (
              <p className="text-[10px] text-[#666] text-center -mt-4">
                Drag to reorder
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
                Upload {files.length} {files.length === 1 ? "file" : "files"}
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
                  {files.length === 1 ? "Photo" : "Post"} uploaded!
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
    </div>
  );
}

// ─── Sortable Media Item ─────────────────────────────────────────────────────

function SortableMediaItem({
  mf,
  disabled,
  onRemove,
  onPosterCapture,
}: {
  mf: MediaFile;
  disabled: boolean;
  onRemove: (id: string) => void;
  onPosterCapture: (fileId: string, video: HTMLVideoElement) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: mf.id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`relative h-full flex-1 min-w-0 overflow-hidden rounded-lg bg-[#141313] select-none ${
        disabled ? "cursor-default" : isDragging ? "cursor-grabbing" : "cursor-grab"
      }`}
    >
      {/* Content — hidden when this slot is the active drag source */}
      <div className={isDragging ? "opacity-0" : "opacity-100"}>
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

      {/* Insertion slot indicator — shown while dragging */}
      {isDragging && (
        <div className="absolute inset-0 border-2 border-dashed border-[#427ea3]/60 rounded-lg" />
      )}

      {/* Remove button */}
      {!disabled && !isDragging && (
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onRemove(mf.id)}
          className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-[10px] flex items-center justify-center text-white"
        >
          ×
        </button>
      )}

      {/* Video indicator */}
      {mf.type === "video" && !isDragging && (
        <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white">
          VIDEO
        </div>
      )}
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
