"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { detectFaces, imageFromUrl, faceDetectionFailed } from "@/lib/faces/detect";

/**
 * Faces → People review page (admin). Two jobs on one screen:
 *  1. Scan the archive: page through not-yet-scanned photos, run in-browser face
 *     detection on each (nothing leaves the device — the thumbnails are proxied
 *     same-origin and only abstract descriptors are stored), and bank the faces.
 *  2. Name the clusters: the server groups unnamed faces by similarity and
 *     pre-fills a "looks like <known person>" suggestion; the human names each
 *     cluster once (matched against the existing people list first), which turns
 *     those faces into references and tags the person on the affected posts.
 *
 * Suggest-never-auto-apply throughout: nothing is named until you confirm it.
 * Naming tags every post the cluster touches, so the UI shows EVERY face in a
 * cluster — never a sample — before you can put a name on it.
 */

interface FaceView {
  id: string;
  mediaId: string;
  postId: string;
  box: { x: number; y: number; w: number; h: number };
  imageUrl: string;
}
interface ClusterView {
  suggestion: { personId: string; name: string; distance: number } | null;
  faces: FaceView[];
}
interface Status {
  referenceCount: number;
  namedFaceCount: number;
  unnamedFaceCount: number;
  scannedCount: number;
  unscannedCount: number;
}
interface Person {
  id: string;
  name: string;
}

const SCAN_BATCH = 8;

/** Background styles that crop a normalized face box to fill a square tile,
 *  with a little margin so there's hair/context around the face. */
function faceTileStyle(imageUrl: string, box: FaceView["box"], size: number): React.CSSProperties {
  const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
  const m = 0.35; // expand each side by 35% of the box dimension
  const ex = clamp01(box.x - box.w * m);
  const ey = clamp01(box.y - box.h * m);
  const ew = Math.min(1 - ex, box.w * (1 + 2 * m));
  const eh = Math.min(1 - ey, box.h * (1 + 2 * m));
  // Guard against degenerate boxes.
  const w = ew > 0.001 ? ew : 1;
  const h = eh > 0.001 ? eh : 1;
  return {
    width: size,
    height: size,
    backgroundImage: `url(${imageUrl})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${size / w}px ${size / h}px`,
    backgroundPosition: `${-(ex * size) / w}px ${-(ey * size) / h}px`,
  };
}

export default function FacesReviewPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [clusters, setClusters] = useState<ClusterView[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const refreshStatus = useCallback(async () => {
    const r = await fetch("/api/admin/faces/status");
    if (r.ok) setStatus(await r.json());
  }, []);

  const refreshPeople = useCallback(async () => {
    const r = await fetch("/api/admin/people");
    if (r.ok) setPeople(await r.json());
  }, []);

  const loadClusters = useCallback(async () => {
    setClusters(null);
    const r = await fetch("/api/admin/faces/clusters");
    if (r.ok) {
      const d = await r.json();
      setClusters(d.clusters ?? []);
      setTruncated(!!d.truncated);
    } else {
      setClusters([]);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshPeople();
    loadClusters();
  }, [refreshStatus, refreshPeople, loadClusters]);

  async function runScan() {
    if (scanning) return;
    setScanning(true);
    setError(null);
    let processed = 0;
    let skipped = 0;
    try {
      while (true) {
        const queue = await fetch(`/api/admin/faces/scan?limit=${SCAN_BATCH}`).then((r) => r.json());
        const items: { mediaId: string; imageUrl: string }[] = queue.items ?? [];
        if (items.length === 0) break;

        const results: { mediaId: string; faces: unknown[] }[] = [];
        for (const item of items) {
          try {
            const img = await imageFromUrl(item.imageUrl);
            const faces = await detectFaces(img);
            results.push({ mediaId: item.mediaId, faces });
          } catch {
            // Couldn't load/decode this thumbnail. Leave it OUT of the results
            // so it stays in the queue — submitting it as an empty result would
            // stamp it scanned and hide its faces permanently.
            skipped++;
          }
        }

        // If the model itself failed to load, don't mark anything scanned —
        // bail so the scan is resumable once the environment supports it.
        if (faceDetectionFailed()) {
          setError("Face model couldn't run in this browser (WebGL may be unavailable). Nothing was marked scanned.");
          break;
        }

        // Every photo in this batch failed to load — the next fetch would return
        // the same ones, so stop instead of looping forever.
        if (results.length === 0) {
          setError("Couldn't read any photos in this batch — stopping. Nothing was marked scanned.");
          break;
        }

        const saved = await fetch("/api/admin/faces/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ results }),
        });
        if (!saved.ok) {
          // Nothing was stamped, so re-fetching would hand back the same batch.
          setError("Couldn't save scan results — stopping. Nothing was marked scanned.");
          break;
        }

        processed += results.length;
        setScanMsg(`Scanned ${processed} photo${processed === 1 ? "" : "s"}…`);
        await refreshStatus();
        if (queue.remaining - results.length <= 0) break;
      }
      setScanMsg(
        `Scan complete — ${processed} photo${processed === 1 ? "" : "s"} this run` +
          (skipped > 0 ? `, ${skipped} skipped (left in the queue to retry).` : ".")
      );
      await loadClusters();
    } finally {
      setScanning(false);
    }
  }

  /** Prefer an existing person id over a free-text name, so two distinct people
   *  whose names slugify the same can't be silently merged into one. */
  function resolvePerson(cluster: ClusterView, typed: string): { personId: string } | { personName: string } {
    const lower = typed.trim().toLowerCase();
    const known = people.find((p) => p.name.toLowerCase() === lower);
    if (known) return { personId: known.id };
    if (cluster.suggestion && cluster.suggestion.name.toLowerCase() === lower) {
      return { personId: cluster.suggestion.personId };
    }
    return { personName: typed.trim() };
  }

  async function nameCluster(cluster: ClusterView) {
    const key = keyFor(cluster);
    const typed = (drafts[key] ?? cluster.suggestion?.name ?? "").trim();
    if (!typed || busyKey) return;
    setBusyKey(key);
    setError(null);
    try {
      const r = await fetch("/api/admin/faces/name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          faceIds: cluster.faces.map((f) => f.id),
          ...resolvePerson(cluster, typed),
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setError(d?.error ?? "Naming failed.");
        return;
      }
      const d = await r.json();
      if (d.namedFaces === 0) {
        // Someone else already named these — reload rather than pretend it worked.
        setError("Those faces were already named elsewhere. Refreshed the groups.");
        await Promise.all([refreshStatus(), refreshPeople(), loadClusters()]);
        return;
      }
      setClusters((cs) => (cs ? cs.filter((c) => keyFor(c) !== key) : cs));
      await Promise.all([refreshStatus(), refreshPeople()]);
    } finally {
      setBusyKey(null);
    }
  }

  async function ignoreCluster(cluster: ClusterView) {
    const key = keyFor(cluster);
    if (busyKey) return;
    setBusyKey(key);
    try {
      const r = await fetch("/api/admin/faces/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ faceIds: cluster.faces.map((f) => f.id) }),
      });
      if (r.ok) {
        setClusters((cs) => (cs ? cs.filter((c) => keyFor(c) !== key) : cs));
        await refreshStatus();
      } else {
        setError("Couldn't dismiss those faces.");
      }
    } finally {
      setBusyKey(null);
    }
  }

  const peopleNames = useMemo(() => people.map((p) => p.name), [people]);

  return (
    <div className="min-h-screen bg-[#1a1918] text-[#d3d3d3] px-4 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-[#e8e4dc]">Faces → People</h1>
        <Link href="/" className="text-sm text-[#888] hover:text-[#c2a467]">← Home</Link>
      </div>
      <p className="text-sm text-[#888] mb-5">
        Find faces across your photos, then name each group once. Everything runs on this
        device — only anonymous face fingerprints are stored, never sent to any outside service.
      </p>

      {/* Status + scan */}
      <div className="bg-[#232221] rounded-xl p-4 mb-6">
        {status && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-center">
            <Stat label="Named" value={status.namedFaceCount} />
            <Stat label="To name" value={status.unnamedFaceCount} />
            <Stat label="People" value={status.referenceCount} />
            <Stat label="Not scanned" value={status.unscannedCount} />
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={runScan}
            disabled={scanning || (status?.unscannedCount ?? 0) === 0}
            className="px-4 py-2 rounded-lg bg-[#427ea3] text-white text-sm font-medium hover:bg-[#4a8bb3] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {scanning ? "Scanning…" : status?.unscannedCount ? `Scan ${status.unscannedCount} photo${status.unscannedCount === 1 ? "" : "s"}` : "All photos scanned"}
          </button>
          <button
            onClick={loadClusters}
            disabled={scanning}
            className="px-3 py-2 rounded-lg bg-[#2a2929] text-[#a0a0a0] text-sm hover:bg-[#333] disabled:opacity-40"
          >
            Refresh groups
          </button>
          {scanMsg && <span className="text-xs text-[#888]">{scanMsg}</span>}
        </div>
        {error && <p className="text-sm text-[#d86d6d] mt-3">{error}</p>}
      </div>

      {/* Clusters */}
      {clusters === null ? (
        <p className="text-sm text-[#888]">Loading groups…</p>
      ) : clusters.length === 0 ? (
        <p className="text-sm text-[#888]">
          {status?.unscannedCount ? "Scan your photos to find faces to name." : "No unnamed faces — everyone's been named. 🎉"}
        </p>
      ) : (
        <>
          {truncated && (
            <p className="text-xs text-[#c2a467] mb-3">
              Showing the newest faces. Name a batch and refresh to see more.
            </p>
          )}
          <div className="space-y-4">
            {clusters.map((cluster) => {
              const key = keyFor(cluster);
              const draft = drafts[key] ?? cluster.suggestion?.name ?? "";
              const busy = busyKey === key;
              return (
                <div key={key} className="bg-[#232221] rounded-xl p-4">
                  <div className="text-xs text-[#888] mb-2">
                    {cluster.faces.length} face{cluster.faces.length === 1 ? "" : "s"}
                    {cluster.suggestion && (
                      <span className="text-[#c2a467]"> · looks like @{cluster.suggestion.name}</span>
                    )}
                    <span className="text-[#666]"> · naming tags this person on every post shown here</span>
                  </div>

                  {/* Every face in the cluster — naming acts on all of them, so
                      all of them are shown (scrolls for large groups). */}
                  <div className="flex flex-wrap gap-1.5 mb-3 max-h-[172px] overflow-y-auto">
                    {cluster.faces.map((f) => (
                      <div
                        key={f.id}
                        className="rounded border border-[#3a3939] bg-[#111] shrink-0"
                        style={faceTileStyle(f.imageUrl, f.box, 52)}
                        title="Detected face"
                      />
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      list="known-people"
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") nameCluster(cluster);
                      }}
                      placeholder="Name this person…"
                      disabled={busy}
                      className="flex-1 min-w-[10rem] bg-[#2a2929] rounded-lg px-3 py-2 text-sm text-[#d3d3d3] placeholder-[#666] outline-none focus:ring-1 focus:ring-[#427ea3]"
                    />
                    <button
                      onClick={() => nameCluster(cluster)}
                      disabled={busy || !draft.trim()}
                      className="px-3 py-2 rounded-lg bg-[#c2a467] text-[#1a1918] text-sm font-medium hover:bg-[#d0b57a] disabled:opacity-40"
                    >
                      {busy ? "Saving…" : "Name"}
                    </button>
                    <button
                      onClick={() => ignoreCluster(cluster)}
                      disabled={busy}
                      className="px-3 py-2 rounded-lg bg-transparent text-[#777] text-sm hover:text-[#d86d6d] disabled:opacity-40"
                      title="Not a person / skip these"
                    >
                      Ignore
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <datalist id="known-people">
        {peopleNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </div>
  );
}

/** Stable key for a cluster (first face id) — used for React keys + row removal. */
function keyFor(c: ClusterView): string {
  return c.faces[0]?.id ?? "empty";
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[#1a1918] rounded-lg py-2">
      <div className="text-lg font-semibold text-[#e8e4dc]">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-[#777]">{label}</div>
    </div>
  );
}
