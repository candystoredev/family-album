"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getMediaDate, type DateSource } from "@/lib/media/exif";
import { groupByGap, GAP_THRESHOLDS } from "@/lib/media/grouping";
import { defaultLayout } from "@/lib/media/layout";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BulkItem {
  id: string;
  file: File;
  date: Date;
  dateSource: DateSource;
  /** ≤320px preview blob URL — null until generated, stays null if undecodable */
  thumb: string | null;
  thumbFailed: boolean;
}

interface BulkGroup {
  id: string;
  itemIds: string[];
}

const THUMB_MAX_PX = 320;
const EXIF_CONCURRENCY = 8;
const THUMB_CONCURRENCY = 4;

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run fn over items with bounded concurrency. */
async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    })
  );
}

/**
 * Small preview thumbnail. Decodes at reduced size where the browser supports
 * it so 200 originals never sit in memory at once.
 */
async function makeThumb(file: File): Promise<string | null> {
  try {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, {
        resizeWidth: THUMB_MAX_PX,
        resizeQuality: "low",
      });
    } catch {
      // Older Safari: no resize options — decode full, scale on canvas
      bitmap = await createImageBitmap(file);
    }
    const scale = Math.min(1, THUMB_MAX_PX / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", 0.7)
    );
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    // Undecodable in this browser (e.g. HEIC in Chrome) — placeholder tile
    return null;
  }
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

// ─── Page ────────────────────────────────────────────────────────────────────

export default function BulkImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const [items, setItems] = useState<Record<string, BulkItem>>({});
  const [groups, setGroups] = useState<BulkGroup[]>([]);
  const [thresholdIdx, setThresholdIdx] = useState(0);
  const [edited, setEdited] = useState(false);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);

  // Invalidates in-flight thumb work on clear/unmount
  const generationRef = useRef(0);

  const itemCount = Object.keys(items).length;

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Unsaved-work guard
  useEffect(() => {
    if (itemCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [itemCount]);

  // Revoke thumbs on unmount
  useEffect(() => {
    const gen = generationRef;
    return () => {
      gen.current++;
    };
  }, []);

  function toGroups(grouped: BulkItem[][]): BulkGroup[] {
    return grouped.map((g) => ({ id: nextId("g"), itemIds: g.map((it) => it.id) }));
  }

  // ─── Ingest ────────────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).filter((f) =>
      f.type.startsWith("image/")
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!files.length) return;

    const gen = generationRef.current;
    setReading({ done: 0, total: files.length });

    // Pass 1: dates only — header reads, fast. Groups render right after.
    const newItems: BulkItem[] = new Array(files.length);
    await runPool(files, EXIF_CONCURRENCY, async (file, i) => {
      const { date, source } = await getMediaDate(file);
      newItems[i] = {
        id: nextId("i"),
        file,
        date,
        dateSource: source,
        thumb: null,
        thumbFailed: false,
      };
      setReading((prev) =>
        prev ? { ...prev, done: prev.done + 1 } : prev
      );
    });
    if (generationRef.current !== gen) return;

    setItems((prev) => {
      const merged = { ...prev };
      for (const it of newItems) merged[it.id] = it;

      if (!edited) {
        // No manual edits yet — regroup everything together
        setGroups(toGroups(groupByGap(Object.values(merged), GAP_THRESHOLDS[thresholdIdx].ms)));
      } else {
        // Preserve manual work: group only the new items, append as new cards
        setGroups((prevGroups) => [
          ...prevGroups,
          ...toGroups(groupByGap(newItems, GAP_THRESHOLDS[thresholdIdx].ms)),
        ]);
      }
      return merged;
    });
    setReading(null);

    // Pass 2: thumbnails, progressively
    runPool(newItems, THUMB_CONCURRENCY, async (item) => {
      if (generationRef.current !== gen) return;
      const thumb = await makeThumb(item.file);
      if (generationRef.current !== gen) {
        if (thumb) URL.revokeObjectURL(thumb);
        return;
      }
      setItems((prev) =>
        prev[item.id]
          ? { ...prev, [item.id]: { ...prev[item.id], thumb, thumbFailed: !thumb } }
          : prev
      );
    });
  }

  // ─── Group operations ──────────────────────────────────────────────────────

  function changeThreshold(idx: number) {
    if (edited) return;
    setThresholdIdx(idx);
    setGroups(toGroups(groupByGap(Object.values(items), GAP_THRESHOLDS[idx].ms)));
  }

  function mergeIntoPrevious(groupIdx: number) {
    if (groupIdx === 0) return;
    setGroups((prev) => {
      const next = [...prev];
      const target = next[groupIdx - 1];
      const source = next[groupIdx];
      const mergedIds = [...target.itemIds, ...source.itemIds].sort(
        (a, b) => items[a].date.getTime() - items[b].date.getTime()
      );
      next[groupIdx - 1] = { ...target, itemIds: mergedIds };
      next.splice(groupIdx, 1);
      return next;
    });
    setEdited(true);
  }

  /** Split a group so that the photo at itemIdx starts a new group. */
  function splitGroup(groupIdx: number, itemIdx: number) {
    if (itemIdx === 0) return;
    setGroups((prev) => {
      const next = [...prev];
      const group = next[groupIdx];
      const first = { ...group, itemIds: group.itemIds.slice(0, itemIdx) };
      const second = { id: nextId("g"), itemIds: group.itemIds.slice(itemIdx) };
      next.splice(groupIdx, 1, first, second);
      return next;
    });
    setEdited(true);
  }

  function clearAll() {
    if (!window.confirm("Discard all photos and groups?")) return;
    generationRef.current++;
    for (const it of Object.values(items)) {
      if (it.thumb) URL.revokeObjectURL(it.thumb);
    }
    setItems({});
    setGroups([]);
    setEdited(false);
    setReading(null);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!mounted) return <div className="min-h-screen bg-[#1d1c1c]" />;

  if (isMobile) {
    return (
      <div className="min-h-screen bg-[#1d1c1c] text-[#d3d3d3] flex items-center justify-center px-6">
        <div className="bg-[#2a2929] rounded-xl p-6 max-w-sm text-center space-y-3">
          <div className="text-2xl">🖥️</div>
          <h1 className="font-semibold">Bulk Import is a desktop tool</h1>
          <p className="text-sm text-[#888]">
            Reviewing and grouping lots of photos needs a bigger screen. On your
            phone, use the regular upload instead.
          </p>
          <a
            href="/admin/upload"
            className="inline-block bg-[#427ea3] text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:bg-[#3a6f91] transition-colors"
          >
            Go to Upload
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#1d1c1c] text-[#d3d3d3]"
      style={{ "--bulk-cols": 3 } as React.CSSProperties}
    >
      {/* Toolbar */}
      <div className="sticky top-0 z-20 bg-[#1d1c1c]/95 backdrop-blur border-b border-[#2a2929] px-6 py-3 flex items-center gap-4 flex-wrap">
        <h1 className="text-lg font-semibold mr-2">Bulk Import</h1>

        {itemCount > 0 && (
          <span className="text-sm text-[#888] tabular-nums">
            {groups.length} {groups.length === 1 ? "post" : "posts"} · {itemCount}{" "}
            {itemCount === 1 ? "photo" : "photos"}
          </span>
        )}

        {reading && (
          <span className="text-sm text-[#427ea3] tabular-nums">
            Reading photo {reading.done}/{reading.total}…
          </span>
        )}

        <div className="flex-1" />

        {/* Gap threshold */}
        {itemCount > 0 && (
          <div className="flex items-center gap-2" title={edited ? "Locked — you've edited groups manually" : "Photos further apart than this start a new post"}>
            <span className="text-xs text-[#666]">
              {edited ? "Group gap 🔒" : "Group gap"}
            </span>
            <div className="flex rounded-lg overflow-hidden border border-[#3a3939]">
              {GAP_THRESHOLDS.map((t, i) => (
                <button
                  key={t.label}
                  onClick={() => changeThreshold(i)}
                  disabled={edited}
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    i === thresholdIdx
                      ? "bg-[#427ea3] text-white"
                      : "bg-[#2a2929] text-[#888] hover:bg-[#333]"
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="bg-[#427ea3] text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#3a6f91] transition-colors cursor-pointer">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          {itemCount === 0 ? "Choose photos" : "Add photos"}
        </label>

        {itemCount > 0 && (
          <button
            onClick={clearAll}
            className="text-sm text-[#666] hover:text-[#d86d6d] transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Empty state */}
      {itemCount === 0 && !reading && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <label className="border-2 border-dashed border-[#3a3939] rounded-xl px-16 py-12 text-center cursor-pointer hover:border-[#427ea3] transition-colors">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="text-[#888] space-y-2">
              <div className="text-4xl">+</div>
              <div className="text-sm">Choose a batch of photos</div>
              <div className="text-xs text-[#555]">
                They&apos;ll be grouped into posts by time taken
              </div>
            </div>
          </label>
        </div>
      )}

      {/* Group cards */}
      {groups.length > 0 && (
        <div
          className="p-6 grid gap-4"
          style={{ gridTemplateColumns: "repeat(var(--bulk-cols, 3), minmax(0, 1fr))" }}
        >
          {groups.map((group, gi) => (
            <GroupCard
              key={group.id}
              group={group}
              items={items}
              canMergeUp={gi > 0}
              onMergeUp={() => mergeIntoPrevious(gi)}
              onSplit={(itemIdx) => splitGroup(gi, itemIdx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Group Card ──────────────────────────────────────────────────────────────

function GroupCard({
  group,
  items,
  canMergeUp,
  onMergeUp,
  onSplit,
}: {
  group: BulkGroup;
  items: Record<string, BulkItem>;
  canMergeUp: boolean;
  onMergeUp: () => void;
  onSplit: (itemIdx: number) => void;
}) {
  const groupItems = useMemo(
    () => group.itemIds.map((id) => items[id]).filter(Boolean),
    [group.itemIds, items]
  );
  const first = groupItems[0];
  if (!first) return null;

  const last = groupItems[groupItems.length - 1];
  const sameDay = first.date.toDateString() === last.date.toDateString();
  const rows = defaultLayout(groupItems);

  // Running index per photo so split knows the position within the group
  let flatIdx = -1;

  return (
    <div
      className="bg-[#252424] rounded-xl overflow-hidden"
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 320px" }}
    >
      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2 text-xs">
        <span className="text-[#d3d3d3] font-medium">{DATE_FMT.format(first.date)}</span>
        <span className="text-[#666]">
          {sameDay
            ? TIME_FMT.format(first.date)
            : `– ${DATE_FMT.format(last.date)}`}
        </span>
        {first.dateSource !== "exif" && (
          <span
            className="text-[#a08545] border border-[#a08545]/40 rounded px-1.5 py-px text-[10px]"
            title={
              first.dateSource === "filename"
                ? "No EXIF data — date guessed from the filename"
                : "No EXIF data — date taken from the file's modification time"
            }
          >
            ≈ {first.dateSource === "filename" ? "from filename" : "from file"}
          </span>
        )}
        <span className="text-[#666] ml-auto tabular-nums">{groupItems.length}</span>
        {canMergeUp && (
          <button
            onClick={onMergeUp}
            title="Merge into previous group"
            className="text-[#666] hover:text-[#427ea3] transition-colors px-1"
          >
            ⤴
          </button>
        )}
      </div>

      {/* Mini photo grid */}
      <div className="p-1.5 pt-0 space-y-1.5">
        {rows.map((row, ri) => (
          <div key={ri} className="flex gap-1.5" style={{ height: 90 }}>
            {row.map((item) => {
              flatIdx++;
              const idx = flatIdx;
              return (
                <div
                  key={item.id}
                  className="relative flex-1 min-w-0 rounded-md overflow-hidden bg-[#141313] group/photo"
                >
                  {item.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumb}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : item.thumbFailed ? (
                    <div
                      className="w-full h-full flex items-center justify-center text-[#555] text-[9px] px-1 text-center break-all"
                      title={`${item.file.name} — preview unavailable in this browser; still imports fine`}
                    >
                      {item.file.name}
                    </div>
                  ) : (
                    <div className="w-full h-full animate-pulse bg-[#2a2929]" />
                  )}

                  {/* Split-before affordance — not on the first photo */}
                  {idx > 0 && (
                    <button
                      onClick={() => onSplit(idx)}
                      title="Split into a new post starting here"
                      className="absolute left-0 top-0 bottom-0 w-5 flex items-center justify-center opacity-0 group-hover/photo:opacity-100 focus:opacity-100 transition-opacity bg-gradient-to-r from-black/60 to-transparent"
                    >
                      <span className="text-[#d3d3d3] text-xs">✂</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
