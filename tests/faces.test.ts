import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  euclidean,
  centroid,
  matchToKnown,
  clusterFaces,
  CLUSTER_THRESHOLD,
  MATCH_THRESHOLD,
} from "../src/lib/faces/cluster";
import { descriptorToBytes, bytesToDescriptor, DESCRIPTOR_LENGTH } from "../src/lib/faces/descriptor";
import type { FaceVector, PersonReference } from "../src/lib/faces/types";

/**
 * Faces → People pure logic (clustering, known-person matching, descriptor
 * serialization). No face-api, no DB — just the math the review page and the
 * compose-time matcher depend on.
 * Run: npx tsx --test tests/faces.test.ts
 */

// A tiny helper: a descriptor is just N floats. We work in a low dimension for
// legibility except where the real 128-d BLOB round-trip is under test.
function vec(...nums: number[]): number[] {
  return nums;
}

// Three well-separated "people" in 3-space, plus near-duplicates of each that
// sit comfortably inside CLUSTER_THRESHOLD.
const ALICE = vec(0, 0, 0);
const ALICE2 = vec(0.05, -0.05, 0.05); // ~0.087 away
const BOB = vec(3, 0, 0);
const BOB2 = vec(3.05, 0.05, 0); // ~0.07 away
const CAROL = vec(0, 3, 0);

describe("euclidean + centroid", () => {
  it("computes straight-line distance", () => {
    assert.equal(euclidean(vec(0, 0, 0), vec(3, 4, 0)), 5);
  });
  it("throws on dimension mismatch", () => {
    assert.throws(() => euclidean(vec(1, 2), vec(1, 2, 3)));
  });
  it("averages component-wise", () => {
    assert.deepEqual(centroid([vec(0, 0), vec(2, 4)]), vec(1, 2));
  });
  it("throws on empty centroid input", () => {
    assert.throws(() => centroid([]));
  });
});

describe("clusterFaces", () => {
  it("groups near-duplicates and separates distinct people", () => {
    const faces: FaceVector[] = [
      { id: "a1", descriptor: ALICE },
      { id: "b1", descriptor: BOB },
      { id: "a2", descriptor: ALICE2 },
      { id: "b2", descriptor: BOB2 },
      { id: "c1", descriptor: CAROL },
    ];
    const clusters = clusterFaces(faces);
    assert.equal(clusters.length, 3);
    // Membership by set, since only size ordering is guaranteed.
    const sets = clusters.map((c) => new Set(c.faceIds));
    assert.ok(sets.some((s) => s.has("a1") && s.has("a2") && s.size === 2));
    assert.ok(sets.some((s) => s.has("b1") && s.has("b2") && s.size === 2));
    assert.ok(sets.some((s) => s.has("c1") && s.size === 1));
  });

  it("is order-independent (connected components, not greedy)", () => {
    const forward: FaceVector[] = [
      { id: "a1", descriptor: ALICE },
      { id: "a2", descriptor: ALICE2 },
      { id: "b1", descriptor: BOB },
    ];
    const reversed = [...forward].reverse();
    const norm = (fs: FaceVector[]) =>
      clusterFaces(fs)
        .map((c) => [...c.faceIds].sort().join(","))
        .sort();
    assert.deepEqual(norm(forward), norm(reversed));
  });

  it("sorts largest clusters first", () => {
    const faces: FaceVector[] = [
      { id: "c1", descriptor: CAROL },
      { id: "a1", descriptor: ALICE },
      { id: "a2", descriptor: ALICE2 },
      { id: "a3", descriptor: vec(-0.05, 0.05, 0) },
    ];
    const clusters = clusterFaces(faces);
    assert.equal(clusters[0].faceIds.length, 3);
  });

  it("transitively links a chain within threshold (single-link)", () => {
    // Each hop < threshold but the endpoints are > threshold apart: single-link
    // still merges them into one cluster.
    const step = CLUSTER_THRESHOLD * 0.9;
    const faces: FaceVector[] = [
      { id: "x0", descriptor: vec(0, 0, 0) },
      { id: "x1", descriptor: vec(step, 0, 0) },
      { id: "x2", descriptor: vec(2 * step, 0, 0) },
    ];
    assert.ok(euclidean(faces[0].descriptor, faces[2].descriptor) > CLUSTER_THRESHOLD);
    const clusters = clusterFaces(faces);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].faceIds.length, 3);
  });

  it("tags clusters with the nearest known-person suggestion", () => {
    const refs: PersonReference[] = [
      { personId: "p-alice", name: "Alice", centroid: ALICE, count: 4 },
      { personId: "p-bob", name: "Bob", centroid: BOB, count: 4 },
    ];
    const faces: FaceVector[] = [
      { id: "a1", descriptor: ALICE2 },
      { id: "c1", descriptor: CAROL }, // no known person near Carol
    ];
    const clusters = clusterFaces(faces, refs);
    const aliceCluster = clusters.find((c) => c.faceIds.includes("a1"))!;
    const carolCluster = clusters.find((c) => c.faceIds.includes("c1"))!;
    assert.equal(aliceCluster.suggestion?.personId, "p-alice");
    assert.equal(carolCluster.suggestion, null);
  });
});

describe("matchToKnown", () => {
  const refs: PersonReference[] = [
    { personId: "p-alice", name: "Alice", centroid: ALICE, count: 3 },
    { personId: "p-bob", name: "Bob", centroid: BOB, count: 3 },
  ];

  it("returns the nearest person within the threshold", () => {
    const m = matchToKnown(ALICE2, refs);
    assert.equal(m?.personId, "p-alice");
    assert.ok(m!.distance < MATCH_THRESHOLD);
  });

  it("returns null when nothing is close enough", () => {
    assert.equal(matchToKnown(CAROL, refs), null);
  });

  it("returns null with no references", () => {
    assert.equal(matchToKnown(ALICE, []), null);
  });

  it("picks the closer of two in-threshold references", () => {
    const close: PersonReference[] = [
      { personId: "near", name: "Near", centroid: vec(0.1, 0, 0), count: 1 },
      { personId: "far", name: "Far", centroid: vec(0.4, 0, 0), count: 1 },
    ];
    assert.equal(matchToKnown(vec(0, 0, 0), close)?.personId, "near");
  });
});

describe("descriptor BLOB round-trip", () => {
  it("preserves a full 128-d descriptor through bytes and back", () => {
    const original = Array.from({ length: DESCRIPTOR_LENGTH }, (_, i) => Math.sin(i) * 0.5);
    const bytes = descriptorToBytes(original);
    assert.equal(bytes.byteLength, DESCRIPTOR_LENGTH * 4); // Float32
    const restored = bytesToDescriptor(bytes);
    assert.equal(restored.length, DESCRIPTOR_LENGTH);
    for (let i = 0; i < DESCRIPTOR_LENGTH; i++) {
      // Float32 rounding — compare within tolerance.
      assert.ok(Math.abs(restored[i] - original[i]) < 1e-6);
    }
  });

  it("survives a non-zero byteOffset view (as libSQL may hand back)", () => {
    const original = Array.from({ length: DESCRIPTOR_LENGTH }, (_, i) => i / 100);
    const bytes = descriptorToBytes(original);
    // Embed in a larger buffer at an offset to force the alignment path.
    const backing = new Uint8Array(bytes.byteLength + 8);
    backing.set(bytes, 3);
    const view = backing.subarray(3, 3 + bytes.byteLength);
    const restored = bytesToDescriptor(view);
    for (let i = 0; i < DESCRIPTOR_LENGTH; i++) {
      assert.ok(Math.abs(restored[i] - original[i]) < 1e-6);
    }
  });
});
