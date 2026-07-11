import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Phase 12d — unit coverage for the pure core of the shared feed enrichment
 * pipeline (src/lib/postAssembly.ts): media-object/URL construction (incl. the
 * two video-thumbnail fallback modes and the always-on display_order) and the
 * map → enriched-post assembly. The DB fetch itself is exercised end-to-end by
 * the feed/cursor tests; here we guard the byte-for-byte output shape.
 *
 * Run: npx tsx --test tests/post-assembly.test.ts
 */

import {
  buildMedia,
  assemblePosts,
  type PostRelations,
} from "../src/lib/postAssembly";

const R2 = "https://cdn.example.com";

function mediaRow(over: Partial<Parameters<typeof buildMedia>[0]> = {}) {
  return {
    id: "m1",
    post_id: "p1",
    r2_key: "orig/photo.jpg",
    thumbnail_r2_key: "thumb/photo.jpg",
    type: "photo",
    width: 800,
    height: 600,
    display_order: 0,
    ...over,
  };
}

describe("buildMedia — URL construction", () => {
  it("builds url + thumbnailUrl from the r2 keys and carries display_order", () => {
    const m = buildMedia(mediaRow({ display_order: 3 }), R2);
    assert.deepEqual(m, {
      id: "m1",
      type: "photo",
      url: `${R2}/orig/photo.jpg`,
      thumbnailUrl: `${R2}/thumb/photo.jpg`,
      width: 800,
      height: 600,
      display_order: 3,
    });
  });

  it("falls back to the media url when a photo has no thumbnail", () => {
    const m = buildMedia(mediaRow({ thumbnail_r2_key: null }), R2);
    assert.equal(m.thumbnailUrl, `${R2}/orig/photo.jpg`);
  });

  it('video with no thumbnail → "" under the "empty" fallback (feed paths)', () => {
    const m = buildMedia(
      mediaRow({ type: "video", thumbnail_r2_key: null }),
      R2,
      "empty"
    );
    assert.equal(m.thumbnailUrl, "");
  });

  it('video with no thumbnail → media url under the "self" fallback (search/on-this-day)', () => {
    const m = buildMedia(
      mediaRow({ type: "video", thumbnail_r2_key: null, r2_key: "v/clip.mp4" }),
      R2,
      "self"
    );
    assert.equal(m.thumbnailUrl, `${R2}/v/clip.mp4`);
  });

  it("video WITH a thumbnail uses the thumbnail regardless of fallback mode", () => {
    for (const mode of ["empty", "self"] as const) {
      const m = buildMedia(mediaRow({ type: "video" }), R2, mode);
      assert.equal(m.thumbnailUrl, `${R2}/thumb/photo.jpg`);
    }
  });

  it("defaults to the \"empty\" fallback when mode is omitted", () => {
    const m = buildMedia(mediaRow({ type: "video", thumbnail_r2_key: null }), R2);
    assert.equal(m.thumbnailUrl, "");
  });

  it("preserves null width/height", () => {
    const m = buildMedia(mediaRow({ width: null, height: null }), R2);
    assert.equal(m.width, null);
    assert.equal(m.height, null);
  });
});

describe("assemblePosts — attach + preserve order/columns", () => {
  const media1 = buildMedia(mediaRow({ id: "m1", post_id: "p1", display_order: 0 }), R2);
  const media2 = buildMedia(mediaRow({ id: "m2", post_id: "p1", display_order: 1 }), R2);

  const relations: PostRelations = {
    mediaByPost: new Map([["p1", [media1, media2]]]),
    tagsByPost: new Map([["p1", [{ name: "Beach", slug: "beach" }]]]),
    peopleByPost: new Map([["p2", [{ name: "Ada", slug: "ada" }]]]),
  };

  const posts = [
    { id: "p1", slug: "a", title: "A" },
    { id: "p2", slug: "b", title: "B" },
  ];

  it("attaches media/tags/people and spreads the post's own columns verbatim", () => {
    const out = assemblePosts(posts, relations);
    assert.deepEqual(out[0], {
      id: "p1",
      slug: "a",
      title: "A",
      media: [media1, media2],
      tags: [{ name: "Beach", slug: "beach" }],
      people: [],
    });
    assert.deepEqual(out[1], {
      id: "p2",
      slug: "b",
      title: "B",
      media: [],
      tags: [],
      people: [{ name: "Ada", slug: "ada" }],
    });
  });

  it("preserves the input post order (does not reorder by the maps)", () => {
    const reversed = [posts[1], posts[0]];
    const out = assemblePosts(reversed, relations);
    assert.deepEqual(out.map((p) => p.id), ["p2", "p1"]);
  });

  it("uses fresh empty arrays for posts with no relations", () => {
    const out = assemblePosts([{ id: "none", slug: "n" }], relations);
    assert.deepEqual(out[0].media, []);
    assert.deepEqual(out[0].tags, []);
    assert.deepEqual(out[0].people, []);
  });
});
