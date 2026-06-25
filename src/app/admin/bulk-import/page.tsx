"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { getMediaDate, type DateSource } from "@/lib/media/exif";
import { groupByGap, nearestGroupWithin, GAP_THRESHOLDS } from "@/lib/media/grouping";
import { defaultLayoutCounts } from "@/lib/media/layout";
import { compressImage } from "@/lib/media/compress";
import { buildCaptureInput, sha256Hex } from "@/lib/media/extract";
import type { CaptureDateInput } from "@/lib/media/capture-date";
import MetadataFields, {
  useMetadataOptions,
  type MetadataOptions,
} from "@/components/MetadataFields";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BulkItem {
  id: string;
  file: File;
  date: Date;
  dateSource: DateSource;
  /** ≤400px preview blob URL — null until generated, stays null if undecodable */
  thumb: string | null;
  thumbFailed: boolean;
  /** width / height of the (orientation-corrected) photo; drives justified rows */
  aspect: number;
  /** Upload-ready file, compressed in the background after ingest so clicking
   *  Publish skips straight to the network. Falls back to on-demand. */
  compressed?: File;
  /** Raw capture-date inputs from the original, resolved server-side (10.1a). */
  capture?: CaptureDateInput;
}

interface BulkGroup {
  id: string;
  /** Flat photo order — canonical membership. */
  itemIds: string[];
  /** Row sizes (each 1–3); sums to itemIds.length. Partitions itemIds into rows. */
  layout: number[];
  title: string;
  date: string;
  selectedTags: string[];
  selectedPeople: string[];
  selectedAlbumIds: string[];
  skipped: boolean;
}

interface GroupPublish {
  state: "uploading" | "done" | "error";
  error?: string;
  slug?: string;
}

/** Where a dragged photo will land. */
type DropTarget =
  | { kind: "row"; groupId: string; rowIdx: number; colIdx: number; isNewRow: boolean }
  // A new post inserted before `beforeId` (or appended when null). `line` is the
  // green between-cards indicator geometry, in viewport coords.
  | {
      kind: "newGroup";
      beforeId: string | null;
      line: { x: number; top: number; height: number };
    };

const THUMB_MAX_PX = 400;
const EXIF_CONCURRENCY = 8;
const THUMB_CONCURRENCY = 4;
/** Background pre-compression after thumbnails — low so the UI stays smooth. */
const COMPRESS_CONCURRENCY = 2;
/** Fallback aspect (landscape 4:3) shown until a photo's real ratio is known. */
const DEFAULT_ASPECT = 4 / 3;
/** Top/bottom band of a row that means "new row here" rather than "into this row". */
const NEW_ROW_ZONE = 40;
/** ms the drop target must hold steady before the preview updates (anti-jitter). */
const TARGET_DEBOUNCE = 80;
const ZOOM_KEY = "bulkImportCardMin";
const ZOOM_MIN = 170;
const ZOOM_MAX = 460;
const ZOOM_STEP = 30;
const ZOOM_DEFAULT = 300;

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
 * Small preview thumbnail + the photo's true aspect ratio. Decodes at reduced
 * size where the browser supports it so 200 originals never sit in memory at
 * once. `imageOrientation: "from-image"` applies EXIF rotation so portraits
 * read as portraits (matches the server's sharp `.rotate()`).
 */
async function makeThumb(file: File): Promise<{ url: string; aspect: number } | null> {
  try {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, {
        resizeWidth: THUMB_MAX_PX,
        resizeQuality: "low",
        imageOrientation: "from-image",
      });
    } catch {
      // Older Safari: no resize options — decode full, scale on canvas
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    }
    const aspect = bitmap.height > 0 ? bitmap.width / bitmap.height : DEFAULT_ASPECT;
    const scale = Math.min(1, THUMB_MAX_PX / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", 0.72)
    );
    return blob ? { url: URL.createObjectURL(blob), aspect } : null;
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

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Split a flat id list into rows per the given counts (with a safety tail). */
function partition(ids: string[], counts: number[]): string[][] {
  const rows: string[][] = [];
  let i = 0;
  for (const c of counts) {
    if (i >= ids.length) break;
    rows.push(ids.slice(i, i + c));
    i += c;
  }
  if (i < ids.length) rows.push(ids.slice(i));
  return rows;
}

const rowsOf = (g: BulkGroup): string[][] => partition(g.itemIds, g.layout);

/** Rebuild a group's itemIds + layout from an explicit 2D row arrangement. */
function withRows(g: BulkGroup, rows: string[][]): BulkGroup {
  const clean = rows.filter((r) => r.length > 0);
  return { ...g, itemIds: clean.flat(), layout: clean.map((r) => r.length) };
}

function makeGroup(groupItems: BulkItem[]): BulkGroup {
  const itemIds = groupItems.map((it) => it.id);
  return {
    id: nextId("g"),
    itemIds,
    layout: defaultLayoutCounts(itemIds.length),
    title: "",
    date: toDatetimeLocal(groupItems[0].date),
    selectedTags: [],
    selectedPeople: [],
    selectedAlbumIds: [],
    skipped: false,
  };
}

const isAutoLayout = (g: BulkGroup): boolean => {
  const def = defaultLayoutCounts(g.itemIds.length);
  return def.length === g.layout.length && def.every((c, i) => c === g.layout[i]);
};

/**
 * Add newly-ingested photos without disturbing the existing arrangement: each
 * photo joins the eligible group holding the photo closest in time (within
 * thresholdMs). Auto-layout groups re-flow to the default; manually-laid-out
 * groups keep their rows and the photo is appended (last row if it has room,
 * else a new row). Photos matching no group are gap-grouped and appended.
 */
function placeIntoGroups(
  prevGroups: BulkGroup[],
  newItems: BulkItem[],
  dateOf: (id: string) => number,
  thresholdMs: number,
  canPlaceInto: (g: BulkGroup) => boolean
): BulkGroup[] {
  const groups = prevGroups.map((g) => ({ ...g }));
  const leftovers: BulkItem[] = [];

  for (const item of newItems) {
    const eligibleIdx: number[] = [];
    const stamps: number[][] = [];
    groups.forEach((g, gi) => {
      if (canPlaceInto(g)) {
        eligibleIdx.push(gi);
        stamps.push(g.itemIds.map(dateOf));
      }
    });
    const rel = nearestGroupWithin(stamps, item.date.getTime(), thresholdMs);
    if (rel < 0) {
      leftovers.push(item);
      continue;
    }
    const gi = eligibleIdx[rel];
    const g = groups[gi];
    if (isAutoLayout(g)) {
      const itemIds = [...g.itemIds, item.id].sort((a, b) => dateOf(a) - dateOf(b));
      groups[gi] = { ...g, itemIds, layout: defaultLayoutCounts(itemIds.length) };
    } else {
      // Preserve the custom layout: tuck into the last row, else start a new one
      const rows = rowsOf(g);
      const last = rows[rows.length - 1];
      if (last && last.length < 3) last.push(item.id);
      else rows.push([item.id]);
      groups[gi] = withRows(g, rows);
    }
  }

  if (leftovers.length) {
    groups.push(...groupByGap(leftovers, thresholdMs).map(makeGroup));
  }
  return groups;
}

/**
 * Live 2D preview while dragging: the active photo is removed from its current
 * spot and shown where it would land. Pure — also used to commit on drop.
 * For a new-group target the photo only rides the DragOverlay (the zone
 * highlights), so it's stripped from its source here.
 */
function computeDisplay(
  groups: BulkGroup[],
  activeId: string | null,
  target: DropTarget | null
): { group: BulkGroup; rows: string[][] }[] {
  const base = groups.map((g) => ({ group: g, rows: rowsOf(g) }));
  if (!activeId || !target) return base;

  const stripped = base
    .map(({ group, rows }) => ({
      group,
      rows: rows.map((r) => r.filter((id) => id !== activeId)).filter((r) => r.length > 0),
    }))
    .filter((x) => x.rows.length > 0);

  if (target.kind === "newGroup") return stripped;

  return stripped.map((x) => {
    if (x.group.id !== target.groupId) return x;
    const rows = x.rows.map((r) => [...r]);
    if (target.isNewRow) {
      const at = Math.max(0, Math.min(target.rowIdx, rows.length));
      rows.splice(at, 0, [activeId]);
    } else if (target.rowIdx >= 0 && target.rowIdx < rows.length && rows[target.rowIdx].length < 3) {
      const ci = Math.min(target.colIdx, rows[target.rowIdx].length);
      rows[target.rowIdx].splice(ci, 0, activeId);
    } else {
      rows.push([activeId]);
    }
    return { group: x.group, rows };
  });
}

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
  const [publishes, setPublishes] = useState<Record<string, GroupPublish>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  /** Min card width — smaller = more posts per row. Auto-fill does the rest. */
  const [cardMin, setCardMin] = useState(ZOOM_DEFAULT);
  const gridRef = useRef<HTMLDivElement>(null);

  const options = useMetadataOptions();

  const sensors = useSensors(
    // 8px activation distance so taps on split/skip buttons stay clicks, not drags
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Invalidates in-flight thumb work on clear/unmount
  const generationRef = useRef(0);

  // Live mirror of items for synchronous reads inside async handlers (the
  // closure snapshot of `items` is stale by the time an await resolves).
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Freshest drop target during a drag (debounced into state for rendering)
  const pendingTargetRef = useRef<DropTarget | null>(null);
  const targetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const cardMinRef = useRef(cardMin);
  cardMinRef.current = cardMin;

  const itemCount = Object.keys(items).length;
  const activeGroupCount = groups.filter((g) => !g.skipped).length;
  const isPublishing = Object.values(publishes).some((p) => p.state === "uploading");
  const publishedCount = Object.values(publishes).filter((p) => p.state === "done").length;
  const pendingGroupCount = groups.filter(
    (g) => !g.skipped && publishes[g.id]?.state !== "done"
  ).length;

  const isGroupLocked = (g: BulkGroup) =>
    g.skipped ||
    publishes[g.id]?.state === "uploading" ||
    publishes[g.id]?.state === "done";

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    const saved = Number(window.localStorage.getItem(ZOOM_KEY));
    if (saved >= ZOOM_MIN && saved <= ZOOM_MAX) setCardMin(saved);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function setZoom(px: number) {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, px));
    setCardMin(clamped);
    try {
      window.localStorage.setItem(ZOOM_KEY, String(clamped));
    } catch {
      /* private mode — zoom just won't persist */
    }
  }

  // Trackpad/ctrl-wheel pinch zoom, scoped to the grid (suppresses browser zoom)
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // ctrlKey set for pinch gestures and Ctrl+wheel
      e.preventDefault();
      setZoom(cardMinRef.current + (e.deltaY > 0 ? ZOOM_STEP : -ZOOM_STEP));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mounted, itemCount]);

  // Unsaved-work guard — warn on refresh/close while there's unpublished work.
  // (No persistence: a confirmed reload still discards the in-memory batch.)
  useEffect(() => {
    if (pendingGroupCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // Chrome/Firefox require returnValue to show the prompt
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [pendingGroupCount]);

  // Revoke thumbs on unmount
  useEffect(() => {
    const gen = generationRef;
    return () => {
      gen.current++;
    };
  }, []);

  function toGroups(grouped: BulkItem[][]): BulkGroup[] {
    return grouped.map(makeGroup);
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
      const capture = await buildCaptureInput(file, false); // bulk import is photos-only
      newItems[i] = {
        id: nextId("i"),
        file,
        date,
        dateSource: source,
        capture,
        thumb: null,
        thumbFailed: false,
        aspect: DEFAULT_ASPECT,
      };
      setReading((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    });
    if (generationRef.current !== gen) return;

    // Build the next items map from the live mirror (not the stale closure),
    // then commit. Grouping is done at the top level — never nest setGroups
    // inside the setItems updater: React can re-invoke an updater (StrictMode /
    // interrupted concurrent render) and a nested append would duplicate ids.
    const merged = { ...itemsRef.current };
    for (const it of newItems) merged[it.id] = it;
    itemsRef.current = merged;
    setItems(merged);

    const thresholdMs = GAP_THRESHOLDS[thresholdIdx].ms;
    const dateOf = (id: string) => merged[id]?.date.getTime() ?? 0;

    if (!edited) {
      setGroups(toGroups(groupByGap(Object.values(merged), thresholdMs)));
    } else {
      const canPlaceInto = (g: BulkGroup) =>
        !g.skipped &&
        publishes[g.id]?.state !== "uploading" &&
        publishes[g.id]?.state !== "done";
      setGroups((prevGroups) =>
        placeIntoGroups(prevGroups, newItems, dateOf, thresholdMs, canPlaceInto)
      );
    }
    setReading(null);

    // Pass 2: thumbnails, progressively
    runPool(newItems, THUMB_CONCURRENCY, async (item) => {
      if (generationRef.current !== gen) return;
      const result = await makeThumb(item.file);
      if (generationRef.current !== gen) {
        if (result) URL.revokeObjectURL(result.url);
        return;
      }
      setItems((prev) =>
        prev[item.id]
          ? {
              ...prev,
              [item.id]: {
                ...prev[item.id],
                thumb: result?.url ?? null,
                thumbFailed: !result,
                aspect: result?.aspect ?? prev[item.id].aspect,
              },
            }
          : prev
      );
    }).then(() =>
      // Pass 3: pre-compress for upload while the admin reviews, so Publish
      // goes straight to the network. Compressed JPEGs are a few hundred KB
      // each; the browser spills large blobs to disk, so memory stays sane.
      runPool(newItems, COMPRESS_CONCURRENCY, async (item) => {
        if (generationRef.current !== gen) return;
        if (itemsRef.current[item.id]?.compressed) return;
        const compressed = await compressImage(item.file);
        if (generationRef.current !== gen) return;
        setItems((prev) =>
          prev[item.id] ? { ...prev, [item.id]: { ...prev[item.id], compressed } } : prev
        );
      })
    );
  }

  // ─── Group operations ──────────────────────────────────────────────────────

  function changeThreshold(idx: number) {
    if (edited) return;
    setThresholdIdx(idx);
    setGroups(toGroups(groupByGap(Object.values(items), GAP_THRESHOLDS[idx].ms)));
  }

  function mergeIntoPrevious(groupId: string) {
    setGroups((prev) => {
      const gi = prev.findIndex((g) => g.id === groupId);
      if (gi <= 0) return prev;
      const next = [...prev];
      const target = next[gi - 1];
      const source = next[gi];
      const mergedIds = [...target.itemIds, ...source.itemIds].sort(
        (a, b) => items[a].date.getTime() - items[b].date.getTime()
      );
      next[gi - 1] = {
        ...target,
        itemIds: mergedIds,
        layout: defaultLayoutCounts(mergedIds.length),
      };
      next.splice(gi, 1);
      return next;
    });
    setEdited(true);
  }

  /** Split a group so the photo at flat index `itemIdx` starts a new group. */
  function splitGroup(groupId: string, itemIdx: number) {
    if (itemIdx === 0) return;
    setGroups((prev) => {
      const gi = prev.findIndex((g) => g.id === groupId);
      if (gi < 0) return prev;
      const next = [...prev];
      const group = next[gi];
      const firstIds = group.itemIds.slice(0, itemIdx);
      const secondIds = group.itemIds.slice(itemIdx);
      const first: BulkGroup = {
        ...group,
        itemIds: firstIds,
        layout: defaultLayoutCounts(firstIds.length),
      };
      const second: BulkGroup = {
        id: nextId("g"),
        itemIds: secondIds,
        layout: defaultLayoutCounts(secondIds.length),
        title: "",
        date: toDatetimeLocal(items[secondIds[0]].date),
        selectedTags: [],
        selectedPeople: [],
        selectedAlbumIds: [],
        skipped: false,
      };
      next.splice(gi, 1, first, second);
      return next;
    });
    setEdited(true);
  }

  function updateGroup(groupId: string, patch: Partial<BulkGroup>) {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, ...patch } : g)));
  }

  function applyToAll(
    field: "selectedTags" | "selectedPeople" | "selectedAlbumIds",
    values: string[]
  ) {
    setGroups((prev) => prev.map((g) => ({ ...g, [field]: values })));
  }

  // ─── Drag & drop (row layout within a group + cross-group + new group) ───────

  function scheduleTarget(t: DropTarget | null) {
    pendingTargetRef.current = t;
    if (targetTimerRef.current) clearTimeout(targetTimerRef.current);
    targetTimerRef.current = setTimeout(() => {
      setDropTarget(t);
      targetTimerRef.current = null;
    }, TARGET_DEBOUNCE);
  }

  // Hit-test the pointer against rendered groups/rows while dragging.
  useEffect(() => {
    if (!activeId) return;

    function hitTest(clientX: number, clientY: number) {
      const dragged = activeIdRef.current;
      const groupEls = Array.from(document.querySelectorAll<HTMLElement>("[data-group]"));
      for (const gEl of groupEls) {
        if (gEl.dataset.locked === "true") continue;
        const gr = gEl.getBoundingClientRect();
        if (clientX < gr.left || clientX > gr.right || clientY < gr.top || clientY > gr.bottom)
          continue;
        const groupId = gEl.dataset.group!;
        const rowEls = Array.from(gEl.querySelectorAll<HTMLElement>("[data-grouprow]"));
        if (rowEls.length === 0) {
          scheduleTarget({ kind: "row", groupId, rowIdx: 0, colIdx: 0, isNewRow: true });
          return;
        }
        const rects = rowEls.map((el) => el.getBoundingClientRect());
        const first = rects[0];
        const last = rects[rects.length - 1];

        // Generous top region — the whole header band above row 0 plus the top
        // ~45% of row 0 → "new top row". Anything above the card belongs to the
        // card above, so a top row is easy to hit without slipping into it.
        const topBand = Math.min(NEW_ROW_ZONE, first.height * 0.45);
        if (clientY <= first.top + topBand) {
          scheduleTarget({ kind: "row", groupId, rowIdx: 0, colIdx: 0, isNewRow: true });
          return;
        }
        // Generous bottom region — bottom ~45% of the last row and everything
        // below it (metadata area) → "new bottom row".
        const botBand = Math.min(NEW_ROW_ZONE, last.height * 0.45);
        if (clientY >= last.bottom - botBand) {
          scheduleTarget({ kind: "row", groupId, rowIdx: rowEls.length, colIdx: 0, isNewRow: true });
          return;
        }

        // Interior: find the row under the pointer (or the gap above it)
        for (let ri = 0; ri < rowEls.length; ri++) {
          const rr = rects[ri];
          // Gap between the previous row and this one → new row here
          if (ri > 0 && clientY < rr.top && clientY > rects[ri - 1].bottom) {
            scheduleTarget({ kind: "row", groupId, rowIdx: ri, colIdx: 0, isNewRow: true });
            return;
          }
          if (clientY < rr.top || clientY > rr.bottom) continue;
          const zone = Math.min(NEW_ROW_ZONE, rr.height * 0.3);
          if (ri > 0 && clientY < rr.top + zone) {
            scheduleTarget({ kind: "row", groupId, rowIdx: ri, colIdx: 0, isNewRow: true });
            return;
          }
          if (ri < rowEls.length - 1 && clientY > rr.bottom - zone) {
            scheduleTarget({ kind: "row", groupId, rowIdx: ri + 1, colIdx: 0, isNewRow: true });
            return;
          }
          const itemEls = Array.from(
            rowEls[ri].querySelectorAll<HTMLElement>("[data-item]")
          ).filter((el) => el.dataset.item !== dragged);
          let colIdx = itemEls.length;
          for (let ci = 0; ci < itemEls.length; ci++) {
            const ir = itemEls[ci].getBoundingClientRect();
            if (clientX < ir.left + ir.width / 2) {
              colIdx = ci;
              break;
            }
          }
          scheduleTarget({ kind: "row", groupId, rowIdx: ri, colIdx, isNewRow: false });
          return;
        }
      }

      // Pointer is not over any card — dragged "out" → new post. Show a green
      // line in the gap nearest the pointer; drop creates a post there.
      const cards = groupEls.map((el) => ({ id: el.dataset.group!, rect: el.getBoundingClientRect() }));
      if (cards.length === 0) {
        scheduleTarget(null);
        return;
      }
      let best = cards[0];
      let bestIdx = 0;
      let bestDist = Infinity;
      cards.forEach((c, i) => {
        const dx = Math.max(c.rect.left - clientX, 0, clientX - c.rect.right);
        const dy = Math.max(c.rect.top - clientY, 0, clientY - c.rect.bottom);
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = c;
          bestIdx = i;
        }
      });
      const after = clientX >= (best.rect.left + best.rect.right) / 2;
      const beforeId = after ? cards[bestIdx + 1]?.id ?? null : best.id;
      const x = after ? best.rect.right + 8 : best.rect.left - 8;
      scheduleTarget({
        kind: "newGroup",
        beforeId,
        line: { x, top: best.rect.top, height: best.rect.height },
      });
    }

    function onPointerMove(e: PointerEvent) {
      hitTest(e.clientX, e.clientY);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (targetTimerRef.current) {
        clearTimeout(targetTimerRef.current);
        targetTimerRef.current = null;
      }
    };
  }, [activeId]);

  function handleDragStart(e: DragStartEvent) {
    pendingTargetRef.current = null;
    setDropTarget(null);
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    if (targetTimerRef.current) {
      clearTimeout(targetTimerRef.current);
      targetTimerRef.current = null;
    }
    const itemId = String(e.active.id);
    const target = pendingTargetRef.current;
    setActiveId(null);
    setDropTarget(null);
    pendingTargetRef.current = null;
    if (!target) return;
    commitDrop(itemId, target);
  }

  function handleDragCancel() {
    if (targetTimerRef.current) {
      clearTimeout(targetTimerRef.current);
      targetTimerRef.current = null;
    }
    setActiveId(null);
    setDropTarget(null);
    pendingTargetRef.current = null;
  }

  function commitDrop(itemId: string, target: DropTarget) {
    setGroups((prev) => {
      const src = prev.find((g) => g.itemIds.includes(itemId));
      if (!src) return prev;

      if (target.kind === "newGroup") {
        if (src.itemIds.length === 1) return prev; // solo photo — keep its group + metadata
        const stripped = prev
          .map((g) =>
            g.id === src.id
              ? withRows(
                  g,
                  rowsOf(g).map((r) => r.filter((id) => id !== itemId))
                )
              : g
          )
          .filter((g) => g.itemIds.length > 0);
        const newGroup: BulkGroup = {
          id: nextId("g"),
          itemIds: [itemId],
          layout: [1],
          title: "",
          date: toDatetimeLocal(items[itemId].date),
          selectedTags: [],
          selectedPeople: [],
          selectedAlbumIds: [],
          skipped: false,
        };
        // Insert at the green-line position (before `beforeId`, or append)
        const at = target.beforeId
          ? stripped.findIndex((g) => g.id === target.beforeId)
          : -1;
        if (at < 0) stripped.push(newGroup);
        else stripped.splice(at, 0, newGroup);
        return stripped;
      }

      // Row target — rebuild every group from the live 2D preview
      const display = computeDisplay(prev, itemId, target);
      const byId = new Map(prev.map((g) => [g.id, g]));
      return display.map(({ group, rows }) => withRows(byId.get(group.id) ?? group, rows));
    });
    setEdited(true);
  }

  // ─── Publish ───────────────────────────────────────────────────────────────

  /**
   * After a successful publish, the card lingers briefly showing "published",
   * then clears itself to free workspace. Only that group's state is touched —
   * every other card (selection, edits, scroll) stays exactly as it was.
   */
  function removePublishedGroup(groupId: string) {
    setGroups((prev) => {
      const g = prev.find((x) => x.id === groupId);
      if (!g) return prev;
      const merged = { ...itemsRef.current };
      for (const id of g.itemIds) {
        const it = merged[id];
        if (it?.thumb) URL.revokeObjectURL(it.thumb);
        delete merged[id];
      }
      itemsRef.current = merged;
      setItems(merged);
      return prev.filter((x) => x.id !== groupId);
    });
  }

  async function publishGroup(group: BulkGroup): Promise<void> {
    setPublishes((prev) => ({ ...prev, [group.id]: { state: "uploading" } }));
    try {
      const groupItems = group.itemIds.map((id) => itemsRef.current[id]).filter(Boolean);

      const uploadedItems = await Promise.all(
        groupItems.map(async (item) => {
          // Usually pre-compressed in the background; compress here only if
          // Publish was clicked before the background pass reached this photo
          const compressed = item.compressed ?? (await compressImage(item.file));
          // Hash the original here (not at ingest) so we don't read every
          // original up front (10.1b).
          const contentHash = (await sha256Hex(item.file)) ?? undefined;
          const presignRes = await fetch("/api/admin/upload/presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contentType: compressed.type }),
          });
          if (!presignRes.ok) {
            const data = await presignRes.json();
            throw new Error(data.error || "Failed to get upload URL");
          }
          const { uploadUrl, r2Key, keyPrefix } = await presignRes.json();
          const uploadRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": compressed.type },
            body: compressed,
          });
          if (!uploadRes.ok) throw new Error("Failed to upload photo");
          return { r2Key, keyPrefix, type: "photo" as const, capture: item.capture, contentHash };
        })
      );

      const completeRes = await fetch("/api/admin/upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: uploadedItems,
          title: group.title.trim() || undefined,
          date: group.date || undefined,
          tags: group.selectedTags,
          people: group.selectedPeople,
          albumIds: group.selectedAlbumIds,
          // Honour the manual row layout the admin built
          photosetLayout: group.itemIds.length > 1 ? group.layout.join("") : undefined,
        }),
      });
      const data = await completeRes.json();
      if (!completeRes.ok) throw new Error(data.error || "Processing failed");

      setPublishes((prev) => ({
        ...prev,
        [group.id]: { state: "done", slug: data.slug },
      }));
      // Show "published ✓" for a beat, then clear the card to free workspace
      setTimeout(() => removePublishedGroup(group.id), 600);
    } catch (err) {
      setPublishes((prev) => ({
        ...prev,
        [group.id]: {
          state: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        },
      }));
    }
  }

  async function publishAll() {
    const toPublish = groups.filter(
      (g) => !g.skipped && publishes[g.id]?.state !== "done"
    );
    await runPool(toPublish, 2, async (group) => publishGroup(group));
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
    setPublishes({});
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const display = useMemo(
    () => computeDisplay(groups, activeId, dropTarget),
    [groups, activeId, dropTarget]
  );

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
    <div className="min-h-screen bg-[#1d1c1c] text-[#d3d3d3]">
      {/* Toolbar */}
      <div className="sticky top-0 z-20 bg-[#1d1c1c]/95 backdrop-blur border-b border-[#2a2929] px-6 py-3 flex items-center gap-4 flex-wrap">
        <h1 className="text-lg font-semibold mr-2">Bulk Import</h1>
        <a
          href="/"
          title="Leave bulk import (you'll be warned if there's unpublished work)"
          className="text-sm text-[#888] hover:text-[#d3d3d3] border border-[#3a3939] hover:border-[#555] rounded-lg px-3 py-1.5 transition-colors"
        >
          Cancel
        </a>

        {itemCount > 0 && (
          <span className="text-sm text-[#888] tabular-nums">
            {activeGroupCount} {activeGroupCount === 1 ? "post" : "posts"} · {itemCount}{" "}
            {itemCount === 1 ? "photo" : "photos"}
            {activeGroupCount < groups.length && (
              <span className="text-[#555]"> · {groups.length - activeGroupCount} skipped</span>
            )}
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
          <div
            className="flex items-center gap-2"
            title={edited ? "Locked — you've edited groups manually" : "Photos further apart than this start a new post"}
          >
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

        {/* Zoom — controls posts per row (auto-fills the screen width) */}
        {itemCount > 0 && (
          <div
            className="flex items-center gap-1.5"
            title="Posts per row — drag to fit more or fewer on screen"
          >
            <button
              onClick={() => setZoom(cardMin + ZOOM_STEP)}
              disabled={cardMin >= ZOOM_MAX}
              className="text-[#888] hover:text-[#d3d3d3] disabled:opacity-30 text-lg leading-none w-5"
              title="Larger posts (fewer per row)"
            >
              −
            </button>
            {/* Slider runs right = smaller cards = more per row, so invert the value */}
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={ZOOM_STEP}
              value={ZOOM_MIN + ZOOM_MAX - cardMin}
              onChange={(e) => setZoom(ZOOM_MIN + ZOOM_MAX - Number(e.target.value))}
              className="w-24 accent-[#427ea3] cursor-pointer"
            />
            <button
              onClick={() => setZoom(cardMin - ZOOM_STEP)}
              disabled={cardMin <= ZOOM_MIN}
              className="text-[#888] hover:text-[#d3d3d3] disabled:opacity-30 text-lg leading-none w-5"
              title="Smaller posts (more per row)"
            >
              +
            </button>
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

        {pendingGroupCount > 0 && (
          <button
            onClick={publishAll}
            disabled={isPublishing}
            className="bg-[#3a8a50] text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#2f7342] transition-colors disabled:opacity-50 disabled:cursor-wait"
          >
            {isPublishing
              // Stable denominator even as published cards clear themselves
              ? `Publishing… (${publishedCount}/${publishedCount + pendingGroupCount})`
              : `Publish ${pendingGroupCount} ${pendingGroupCount === 1 ? "post" : "posts"}`}
          </button>
        )}

        {pendingGroupCount === 0 && publishedCount > 0 && (
          <a
            href="/"
            className="bg-[#2a2929] border border-[#3a8a50]/60 text-[#3a8a50] rounded-lg px-4 py-2 text-sm font-semibold hover:bg-[#3a8a50]/10 transition-colors"
          >
            {publishedCount} published — view feed
          </a>
        )}

        {itemCount > 0 && !isPublishing && (
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
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            ref={gridRef}
            className="p-6 grid gap-4 items-start"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(min(${cardMin}px, 100%), 1fr))`,
            }}
          >
            {display.map(({ group, rows }) => (
              <GroupCard
                key={group.id}
                group={group}
                rows={rows}
                items={items}
                options={options}
                publish={publishes[group.id]}
                locked={isGroupLocked(group)}
                activeId={activeId}
                canMergeUp={groups.findIndex((g) => g.id === group.id) > 0}
                onMergeUp={() => mergeIntoPrevious(group.id)}
                onSplit={(itemIdx) => splitGroup(group.id, itemIdx)}
                onUpdate={(patch) => updateGroup(group.id, patch)}
                onApplyToAll={applyToAll}
                onPublish={() => publishGroup(group)}
              />
            ))}
          </div>

          {/* Green between-cards line — drop here to make a NEW post.
              (Blue lines, inside a card, restructure the post's rows.) */}
          {dropTarget?.kind === "newGroup" && (
            <div
              className="pointer-events-none fixed z-40 w-[3px] -ml-[1.5px] rounded-full bg-[#3a8a50] shadow-[0_0_8px_rgba(58,138,80,0.7)]"
              style={{
                left: dropTarget.line.x,
                top: dropTarget.line.top,
                height: dropTarget.line.height,
              }}
            />
          )}

          <DragOverlay>
            {activeId && items[activeId] ? (
              <div className="rounded-md overflow-hidden bg-[#141313] shadow-2xl ring-2 ring-[#427ea3] w-24 h-24 rotate-3">
                {items[activeId].thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={items[activeId].thumb!}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-[#2a2929]" />
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

// ─── Group Card ──────────────────────────────────────────────────────────────

function GroupCard({
  group,
  rows,
  items,
  options,
  publish,
  locked,
  activeId,
  canMergeUp,
  onMergeUp,
  onSplit,
  onUpdate,
  onApplyToAll,
  onPublish,
}: {
  group: BulkGroup;
  rows: string[][];
  items: Record<string, BulkItem>;
  options: MetadataOptions;
  publish?: GroupPublish;
  locked: boolean;
  activeId: string | null;
  canMergeUp: boolean;
  onMergeUp: () => void;
  onSplit: (itemIdx: number) => void;
  onUpdate: (patch: Partial<BulkGroup>) => void;
  onApplyToAll: (
    field: "selectedTags" | "selectedPeople" | "selectedAlbumIds",
    values: string[]
  ) => void;
  onPublish: () => void;
}) {
  const flatItems = useMemo(
    () => rows.flat().map((id) => items[id]).filter(Boolean),
    [rows, items]
  );
  const first = flatItems[0];
  const last = flatItems[flatItems.length - 1];
  if (!first || !last) return null;

  const sameDay = first.date.toDateString() === last.date.toDateString();

  const hasApplyTargets =
    group.selectedTags.length > 0 ||
    group.selectedPeople.length > 0 ||
    group.selectedAlbumIds.length > 0;

  const isDone = publish?.state === "done";
  const isUploading = publish?.state === "uploading";
  const isError = publish?.state === "error";

  // Running flat index so the split affordance knows each photo's position
  let flatIdx = -1;

  return (
    <div
      data-group={group.id}
      data-locked={locked ? "true" : "false"}
      className={`bg-[#252424] rounded-xl overflow-hidden transition-all ${group.skipped ? "opacity-40" : ""} ${
        isDone ? "ring-1 ring-[#3a8a50]/50" : ""
      }`}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 480px" }}
    >
      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2 text-xs">
        <span className="text-[#d3d3d3] font-medium">{DATE_FMT.format(first.date)}</span>
        <span className="text-[#666]">
          {sameDay ? TIME_FMT.format(first.date) : `– ${DATE_FMT.format(last.date)}`}
        </span>
        {first.dateSource !== "exif" && !isDone && (
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
        {isDone && <span className="text-[#3a8a50] text-[10px] font-medium">published</span>}
        {isUploading && <span className="text-[#427ea3] text-[10px]">uploading…</span>}
        <span className="text-[#666] ml-auto tabular-nums">{flatItems.length}</span>
        {canMergeUp && !locked && (
          <button
            onClick={onMergeUp}
            title="Merge into previous group"
            className="text-[#666] hover:text-[#427ea3] transition-colors px-1"
          >
            ⤴
          </button>
        )}
        {!isDone && !isUploading && (
          <button
            onClick={() => onUpdate({ skipped: !group.skipped })}
            title={group.skipped ? "Include this group" : "Skip this group"}
            className={`px-1.5 py-px rounded text-[10px] border transition-colors ${
              group.skipped
                ? "border-[#d86d6d]/60 text-[#d86d6d] hover:bg-[#d86d6d]/10"
                : "border-[#3a3939] text-[#666] hover:text-[#d86d6d] hover:border-[#d86d6d]/60"
            }`}
          >
            {group.skipped ? "skipped" : "skip"}
          </button>
        )}
      </div>

      {/* Photo grid — rows reflect the post layout; drag photos to rearrange.
          The dragged photo previews as a blue line (horizontal = new row,
          vertical = within a row); the real photo rides the DragOverlay. */}
      <div className="px-1.5 pb-0 space-y-1.5">
        {rows.map((row, ri) => {
          // Dragged photo alone in a row → thin row with a horizontal indicator
          if (activeId && row.length === 1 && row[0] === activeId && items[activeId]) {
            flatIdx++;
            return (
              <div key={ri} data-grouprow={ri} className="flex items-center" style={{ height: 12 }}>
                <DraggablePhoto item={items[activeId]} draggable={!locked} indicator="horizontal" />
              </div>
            );
          }
          return (
            <div key={ri} data-grouprow={ri} className="flex gap-1.5 items-stretch">
              {row.map((id) => {
                flatIdx++;
                const idx = flatIdx;
                const item = items[id];
                if (!item) return null;
                return (
                  <DraggablePhoto
                    key={id}
                    item={item}
                    draggable={!locked}
                    alone={row.length === 1}
                    indicator={activeId === id ? "vertical" : null}
                    canSplit={idx > 0 && !group.skipped}
                    onSplit={() => onSplit(idx)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Metadata fields */}
      <div className="px-3 pt-3 pb-3 space-y-2.5">
        <MetadataFields
          options={options}
          title={group.title}
          onTitleChange={(v) => onUpdate({ title: v })}
          date={group.date}
          onDateChange={(v) => onUpdate({ date: v })}
          dateLabel="Date"
          selectedTags={group.selectedTags}
          onTagsChange={(v) => onUpdate({ selectedTags: v })}
          selectedPeople={group.selectedPeople}
          onPeopleChange={(v) => onUpdate({ selectedPeople: v })}
          selectedAlbumIds={group.selectedAlbumIds}
          onAlbumIdsChange={(v) => onUpdate({ selectedAlbumIds: v })}
          disabled={locked}
        />

        {hasApplyTargets && !locked && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {group.selectedTags.length > 0 && (
              <button
                onClick={() => onApplyToAll("selectedTags", group.selectedTags)}
                className="text-[10px] px-2 py-1 rounded border border-[#3a3939] text-[#666] hover:text-[#427ea3] hover:border-[#427ea3]/50 transition-colors"
              >
                Apply tags to all
              </button>
            )}
            {group.selectedPeople.length > 0 && (
              <button
                onClick={() => onApplyToAll("selectedPeople", group.selectedPeople)}
                className="text-[10px] px-2 py-1 rounded border border-[#3a3939] text-[#666] hover:text-[#427ea3] hover:border-[#427ea3]/50 transition-colors"
              >
                Apply people to all
              </button>
            )}
            {group.selectedAlbumIds.length > 0 && (
              <button
                onClick={() => onApplyToAll("selectedAlbumIds", group.selectedAlbumIds)}
                className="text-[10px] px-2 py-1 rounded border border-[#3a3939] text-[#666] hover:text-[#427ea3] hover:border-[#427ea3]/50 transition-colors"
              >
                Apply albums to all
              </button>
            )}
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-xs text-[#d86d6d] flex-1 truncate" title={publish?.error}>
              {publish?.error || "Upload failed"}
            </span>
            <button
              onClick={onPublish}
              className="text-[10px] px-2 py-1 rounded border border-[#d86d6d]/50 text-[#d86d6d] hover:bg-[#d86d6d]/10 transition-colors shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Per-card publish — post just this group; the card clears on success */}
        {!group.skipped && !isError && (
          <button
            onClick={onPublish}
            disabled={isUploading || isDone}
            className={`w-full rounded-lg py-2 text-sm font-semibold transition-colors ${
              isDone
                ? "bg-[#3a8a50]/20 text-[#3a8a50] cursor-default"
                : isUploading
                  ? "bg-[#2a2929] text-[#427ea3] cursor-wait"
                  : "bg-[#3a8a50] text-white hover:bg-[#2f7342]"
            }`}
          >
            {isDone ? "Published ✓" : isUploading ? "Publishing…" : "Publish"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Draggable photo ──────────────────────────────────────────────────────────

function DraggablePhoto({
  item,
  draggable,
  alone = false,
  indicator = null,
  canSplit = false,
  onSplit,
}: {
  item: BulkItem;
  draggable: boolean;
  alone?: boolean;
  indicator?: "horizontal" | "vertical" | null;
  canSplit?: boolean;
  onSplit?: () => void;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: item.id,
    disabled: !draggable,
  });

  // While dragging, this photo previews as a blue insertion line; the real
  // photo follows the cursor via the DragOverlay (matches the upload page).
  if (indicator === "horizontal") {
    return (
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        className="flex-1 h-0.5 rounded-full bg-[#427ea3]"
      />
    );
  }
  if (indicator === "vertical") {
    return (
      <div
        ref={setNodeRef}
        data-item={item.id}
        {...attributes}
        {...listeners}
        className="flex-shrink-0 w-0.5 self-stretch rounded-full bg-[#427ea3]"
      />
    );
  }

  // A lone photo fills the card width (taller for portraits); photos sharing a
  // row are justified (width ∝ aspect, equal heights). align stretch + aspect
  // makes a single flex item derive width from height, so force full width.
  const style: React.CSSProperties = alone
    ? { flex: "none", width: "100%", aspectRatio: String(item.aspect), touchAction: "none" }
    : {
        flexGrow: item.aspect,
        flexShrink: 1,
        flexBasis: 0,
        aspectRatio: String(item.aspect),
        touchAction: "none",
      };

  return (
    <div
      ref={setNodeRef}
      data-item={item.id}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative min-w-0 rounded-md overflow-hidden bg-[#141313] group/photo ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      {item.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumb}
          alt=""
          loading="lazy"
          draggable={false}
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

      {canSplit && (
        <button
          onClick={onSplit}
          onPointerDown={(e) => e.stopPropagation()}
          title="Split into a new post starting here"
          className="absolute left-0 top-0 bottom-0 w-5 flex items-center justify-center opacity-0 group-hover/photo:opacity-100 focus:opacity-100 transition-opacity bg-gradient-to-r from-black/60 to-transparent"
        >
          <span className="text-[#d3d3d3] text-xs">✂</span>
        </button>
      )}
    </div>
  );
}
