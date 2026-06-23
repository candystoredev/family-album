import { test } from "node:test";
import assert from "node:assert/strict";
import { getVideoCreationDate, getVideoDate } from "../src/lib/media/exif.ts";

const MP4_EPOCH_OFFSET = 2082844800;

/** Build a 4-byte big-endian uint32. */
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

/** Minimal mvhd atom (version 0) carrying the given creation_time. */
function mvhd(creationTime: number): Buffer {
  const body = Buffer.alloc(100); // version+flags(4) + 96 bytes of fields we ignore
  body.writeUInt8(0, 0); // version 0
  body.writeUInt32BE(creationTime >>> 0, 4); // creation_time
  return Buffer.concat([u32(8 + body.length), Buffer.from("mvhd"), body]);
}

/** Wrap children in a container atom of the given type. */
function atom(type: string, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type), body]);
}

function mov(creationTime: number): Blob {
  const ftyp = atom("ftyp", Buffer.from("isomiso2"));
  // A bulky mdat BEFORE moov — the parser must skip it by size, not scan it.
  const mdat = atom("mdat", Buffer.alloc(4096));
  const moov = atom("moov", mvhd(creationTime));
  return new Blob([ftyp, mdat, moov]);
}

test("reads mvhd creation_time and preserves the exact instant", async () => {
  // 22 Jun 2026, 14:37 UTC — the time-of-day must survive for same-day ordering.
  const instant = Date.UTC(2026, 5, 22, 14, 37, 0);
  const seconds = Math.floor(instant / 1000) + MP4_EPOCH_OFFSET;
  const d = await getVideoCreationDate(mov(seconds));
  assert.ok(d, "expected a date");
  assert.equal(d!.getTime(), instant);
});

test("two clips from the same day keep distinct, ordered times", async () => {
  const morning = Date.UTC(2026, 5, 22, 8, 15, 0);
  const evening = Date.UTC(2026, 5, 22, 20, 45, 0);
  const a = await getVideoCreationDate(mov(Math.floor(morning / 1000) + MP4_EPOCH_OFFSET));
  const b = await getVideoCreationDate(mov(Math.floor(evening / 1000) + MP4_EPOCH_OFFSET));
  assert.equal(a!.getTime(), morning);
  assert.equal(b!.getTime(), evening);
  assert.ok(a!.getTime() < b!.getTime(), "morning should sort before evening");
});

test("skips a large leading mdat to find moov", async () => {
  const instant = Date.UTC(2019, 0, 5, 9, 30, 0);
  const seconds = Math.floor(instant / 1000) + MP4_EPOCH_OFFSET;
  const d = await getVideoCreationDate(mov(seconds));
  assert.equal(d!.getTime(), instant);
});

test("returns null for a non-MP4 blob", async () => {
  const junk = new Blob([Buffer.from("not a video file at all, just text")]);
  assert.equal(await getVideoCreationDate(junk), null);
});

test("getVideoDate falls back to a filename date when no container date", async () => {
  // Valid container but zero creation_time (common on some exports) → use name.
  const blob = mov(0);
  const named = new File([blob], "VID_20240704_101112.mov", { type: "video/quicktime" });
  const d = await getVideoDate(named);
  assert.ok(d, "expected a fallback date");
  assert.equal(d!.getFullYear(), 2024);
  assert.equal(d!.getMonth(), 6); // July
  assert.equal(d!.getDate(), 4);
});
