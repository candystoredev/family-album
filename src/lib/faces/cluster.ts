/**
 * Pure face clustering + known-person matching. No I/O, no face-api, no DB —
 * just descriptor math over plain number[]s, so it's unit-tested in isolation
 * (tests/faces.test.ts) and shared by the archive scanner and the compose-time
 * suggestion path alike.
 *
 * Distances are Euclidean over the 128-d face descriptors. face-api's own
 * guidance treats < 0.6 as "same person"; we cluster a little tighter (to avoid
 * merging two similar-looking relatives) and match against a named reference a
 * little tighter still (a wrong name is worse than an extra "who's this?").
 */

import type { FaceCluster, FaceVector, PersonReference } from "./types";

/** Faces closer than this are treated as the same person when clustering. */
export const CLUSTER_THRESHOLD = 0.5;
/** A face this close to a known person's centroid is suggested as that person. */
export const MATCH_THRESHOLD = 0.52;

export function euclidean(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`descriptor length mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Component-wise mean of one or more descriptors. Throws on empty input. */
export function centroid(descriptors: number[][]): number[] {
  if (descriptors.length === 0) throw new Error("centroid of no descriptors");
  const dim = descriptors[0].length;
  const out = new Array<number>(dim).fill(0);
  for (const d of descriptors) {
    for (let i = 0; i < dim; i++) out[i] += d[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= descriptors.length;
  return out;
}

/**
 * Match a single descriptor against known people's reference centroids.
 * Returns the nearest person within {@link MATCH_THRESHOLD}, or null. Ties break
 * toward the closer centroid; equal distances keep the first (stable) reference.
 */
export function matchToKnown(
  descriptor: number[],
  references: PersonReference[],
  threshold = MATCH_THRESHOLD
): { personId: string; name: string; distance: number } | null {
  let best: { personId: string; name: string; distance: number } | null = null;
  for (const ref of references) {
    const distance = euclidean(descriptor, ref.centroid);
    if (distance <= threshold && (best === null || distance < best.distance)) {
      best = { personId: ref.personId, name: ref.name, distance };
    }
  }
  return best;
}

/**
 * Cluster unnamed faces into groups of the same person using single-link
 * connected components: two faces join the same cluster when their descriptors
 * are within `threshold`. Order-independent and deterministic (unlike greedy
 * centroid assignment), which matters because the scanner feeds faces in
 * arbitrary DB order. O(n²) in the face count — fine at family-album scale.
 *
 * When `references` are supplied, each resulting cluster is tagged with its best
 * known-person suggestion (nearest reference to the cluster centroid), enabling
 * the "is this @Grandma?" pre-fill without ever auto-applying it.
 */
export function clusterFaces(
  faces: FaceVector[],
  references: PersonReference[] = [],
  threshold = CLUSTER_THRESHOLD
): FaceCluster[] {
  const n = faces.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path halving
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (euclidean(faces[i].descriptor, faces[j].descriptor) <= threshold) {
        union(i, j);
      }
    }
  }

  // Gather members per root, preserving first-seen order for stable output.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  const clusters: FaceCluster[] = [];
  for (const members of groups.values()) {
    const descriptors = members.map((i) => faces[i].descriptor);
    const c = centroid(descriptors);
    clusters.push({
      faceIds: members.map((i) => faces[i].id),
      centroid: c,
      suggestion: matchToKnown(c, references),
    });
  }

  // Largest clusters first — the most-photographed faces are the ones worth
  // naming, and they lead the review UI.
  clusters.sort((a, b) => b.faceIds.length - a.faceIds.length);
  return clusters;
}
