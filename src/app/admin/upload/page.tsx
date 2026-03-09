"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

type UploadState = "idle" | "uploading" | "success" | "error";

interface MediaFile {
  id: string;
  file: File;
  preview: string;
  type: "photo" | "video";
  posterDataUrl?: string; // video poster captured via canvas
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

/** Generate all valid photoset layouts for N photos (rows of 1-3) */
function generateLayoutOptions(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["1"];

  const results: string[] = [];
  function build(remaining: number, current: string) {
    if (remaining === 0) {
      results.push(current);
      return;
    }
    for (let row = 1; row <= Math.min(3, remaining); row++) {
      build(remaining - row, current + row);
    }
  }
  build(count, "");

  // Limit to reasonable number — sort by fewest rows first
  results.sort((a, b) => a.length - b.length);
  return results.slice(0, 20);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Media files
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

  // Photoset layout
  const [customLayout, setCustomLayout] = useState<string | null>(null);

  // Drag state (desktop)
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Touch drag state (mobile)
  const [touchDragIdx, setTouchDragIdx] = useState<number | null>(null);
  const [touchOverIdx, setTouchOverIdx] = useState<number | null>(null);
  const touchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

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

    // Reset input so same file can be re-selected
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
        prev.map((f) =>
          f.id === fileId ? { ...f, posterDataUrl: dataUrl } : f
        )
      );
    },
    []
  );

  // ─── Drag reorder ──────────────────────────────────────────────────────────

  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setDragOverIdx(idx);
  }

  function handleDrop(idx: number) {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }

    setFiles((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(dragIdx, 1);
      updated.splice(idx, 0, moved);
      return updated;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  }

  // ─── Touch drag reorder (long-press to pick up, drag to reorder) ──────────

  function handleTouchStart(e: React.TouchEvent, idx: number) {
    if (disabled) return;
    touchTimeout.current = setTimeout(() => {
      setTouchDragIdx(idx);
      // Prevent scrolling while dragging
      document.body.style.overflow = "hidden";
    }, 300);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (touchDragIdx === null || !gridRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    const gridItems = gridRef.current.querySelectorAll("[data-grid-idx]");
    for (const el of gridItems) {
      const rect = el.getBoundingClientRect();
      if (
        touch.clientX >= rect.left &&
        touch.clientX <= rect.right &&
        touch.clientY >= rect.top &&
        touch.clientY <= rect.bottom
      ) {
        const overIdx = parseInt(el.getAttribute("data-grid-idx") || "-1", 10);
        if (overIdx >= 0 && overIdx !== touchDragIdx) {
          setTouchOverIdx(overIdx);
        }
        break;
      }
    }
  }

  function handleTouchEnd() {
    if (touchTimeout.current) {
      clearTimeout(touchTimeout.current);
      touchTimeout.current = null;
    }
    if (touchDragIdx !== null && touchOverIdx !== null && touchDragIdx !== touchOverIdx) {
      setFiles((prev) => {
        const updated = [...prev];
        const [moved] = updated.splice(touchDragIdx, 1);
        updated.splice(touchOverIdx, 0, moved);
        return updated;
      });
    }
    setTouchDragIdx(null);
    setTouchOverIdx(null);
    document.body.style.overflow = "";
  }

  function handleTouchCancel() {
    if (touchTimeout.current) {
      clearTimeout(touchTimeout.current);
      touchTimeout.current = null;
    }
    setTouchDragIdx(null);
    setTouchOverIdx(null);
    document.body.style.overflow = "";
  }

  // ─── Tag/People helpers ─────────────────────────────────────────────────────

  function addTag(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!selectedTags.includes(trimmed)) {
      setSelectedTags((prev) => [...prev, trimmed]);
    }
    setNewTag("");
  }

  function removeTag(name: string) {
    setSelectedTags((prev) => prev.filter((t) => t !== name));
  }

  function addPerson(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!selectedPeople.includes(trimmed)) {
      setSelectedPeople((prev) => [...prev, trimmed]);
    }
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
      // Step 1: Upload all files to R2 in parallel via presigned URLs
      setProgress(`Uploading ${files.length} ${files.length === 1 ? "file" : "files"}...`);

      const uploadPromises = files.map(async (mf, i) => {
        // Get presigned URL
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

        // Upload to R2
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": mf.file.type },
          body: mf.file,
        });

        if (!uploadRes.ok) {
          throw new Error(`Failed to upload file ${i + 1}`);
        }

        return {
          r2Key,
          keyPrefix,
          type: mf.type,
          posterDataUrl: mf.posterDataUrl,
        };
      });

      const uploadedItems = await Promise.all(uploadPromises);

      // Step 2: Complete — server processes all files + creates post
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
          photosetLayout: customLayout || undefined,
        }),
      });

      const data = await completeRes.json();

      if (!completeRes.ok) {
        throw new Error(data.error || "Processing failed");
      }

      // Immediate redirect — no artificial delay
      setState("success");
      setResultSlug(data.slug);
      router.push(`/posts/${data.slug}`);
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error ? err.message : "Network error — please try again"
      );
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
    setCustomLayout(null);
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

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#1d1c1c] text-[#d3d3d3] px-4 py-8">
      <div className="max-w-lg mx-auto">
        <h1 className="text-xl font-semibold mb-6">Upload</h1>

        {/* File picker — always visible when idle */}
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
              {files.length === 0
                ? "Tap to choose photos or videos"
                : "Add more files"}
            </div>
          </div>
        </label>

        {/* Media preview grid with drag-reorder */}
        {files.length > 0 && (
          <div className="space-y-6">
            <div
              ref={gridRef}
              className="grid grid-cols-3 gap-2"
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchCancel}
            >
              {files.map((mf, idx) => {
                const isDragging = dragIdx === idx || touchDragIdx === idx;
                const isDragOver = dragOverIdx === idx || touchOverIdx === idx;
                return (
                  <div
                    key={mf.id}
                    data-grid-idx={idx}
                    draggable={!disabled}
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={() => handleDrop(idx)}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setDragOverIdx(null);
                    }}
                    onTouchStart={(e) => handleTouchStart(e, idx)}
                    className={`relative aspect-square rounded-lg overflow-hidden bg-[#141313] cursor-grab active:cursor-grabbing transition-all select-none ${
                      isDragOver ? "ring-2 ring-[#427ea3] scale-105" : ""
                    } ${isDragging ? "opacity-40 scale-95" : ""}`}
                  >
                    {mf.type === "video" ? (
                      <VideoPreview
                        file={mf}
                        onPosterCapture={captureVideoPoster}
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mf.preview}
                        alt=""
                        className="w-full h-full object-cover pointer-events-none"
                      />
                    )}

                    {/* Order badge */}
                    <div className="absolute top-1 left-1 w-5 h-5 bg-black/70 rounded-full text-[10px] flex items-center justify-center text-white font-medium">
                      {idx + 1}
                    </div>

                    {/* Remove button */}
                    {!disabled && (
                      <button
                        onClick={() => removeFile(mf.id)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-[10px] flex items-center justify-center text-white"
                      >
                        ×
                      </button>
                    )}

                    {/* Touch drag hint */}
                    {touchDragIdx === idx && (
                      <div className="absolute inset-0 bg-[#427ea3]/20 border-2 border-[#427ea3] rounded-lg" />
                    )}

                    {/* Video indicator */}
                    {mf.type === "video" && (
                      <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white">
                        VIDEO
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {files.length > 1 && !disabled && (
              <p className="text-[10px] text-[#666] text-center -mt-4">
                Drag to reorder &middot; Long-press on mobile
              </p>
            )}

            {/* ─── Photoset Layout Picker ──────────────────────────────── */}
            {files.length >= 2 && !disabled && (
              <LayoutPicker
                count={files.length}
                selected={customLayout}
                onSelect={setCustomLayout}
              />
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
                <label className="block text-xs text-[#888] mb-1">
                  Albums
                </label>
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
                <div className="text-xs text-[#888]">
                  Redirecting to post...
                </div>
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
          <a
            href="/"
            className="text-sm text-[#888] hover:text-[#427ea3] transition-colors"
          >
            Back to feed
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Layout Picker Component ────────────────────────────────────────────────

function LayoutPicker({
  count,
  selected,
  onSelect,
}: {
  count: number;
  selected: string | null;
  onSelect: (layout: string | null) => void;
}) {
  const options = generateLayoutOptions(count);

  // Default layout (what server would auto-generate)
  const defaultLayout =
    count === 1 ? "1" : count === 2 ? "2" : count === 3 ? "21" : count === 4 ? "22" : null;

  return (
    <div>
      <label className="block text-xs text-[#888] mb-2">
        Row layout
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((layout) => {
          const rows = layout.split("").map(Number);
          const isSelected = selected
            ? selected === layout
            : layout === defaultLayout;
          return (
            <button
              key={layout}
              onClick={() => onSelect(layout === defaultLayout ? null : layout)}
              className={`p-1.5 rounded-lg border transition-colors ${
                isSelected
                  ? "border-[#427ea3] bg-[#427ea3]/20"
                  : "border-[#3a3939] bg-[#2a2929] hover:border-[#555]"
              }`}
              title={`Layout: ${rows.join("-")}`}
            >
              <div className="flex flex-col gap-0.5 w-12">
                {rows.map((cols, ri) => (
                  <div key={ri} className="flex gap-0.5">
                    {Array.from({ length: cols }).map((_, ci) => (
                      <div
                        key={ci}
                        className={`h-2 rounded-[1px] flex-1 ${
                          isSelected ? "bg-[#427ea3]" : "bg-[#555]"
                        }`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </button>
          );
        })}
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
    // Seek to 1s for a better poster frame
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
      <img
        src={file.posterDataUrl}
        alt=""
        className="w-full h-full object-cover"
      />
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
