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
const ascii = (s: string) => Buffer.from(s, "ascii");
const rawBox = (type: string, body: Buffer) =>
  Buffer.concat([u32(8 + body.length), ascii(type), body]);

/** Minimal mvhd atom (version 0) carrying the given creation_time. */
function mvhd(creationTime: number): Buffer {
  const body = Buffer.alloc(100); // version+flags(4) + fields we ignore
  body.writeUInt8(0, 0); // version 0
  body.writeUInt32BE(creationTime >>> 0, 4); // creation_time
  return rawBox("mvhd", body);
}

/** Apple metadata: keys (names) + ilst (values), here one creationdate string. */
function metaWithCreationDate(value: string): Buffer {
  const keyName = "com.apple.quicktime.creationdate";
  const keyEntry = Buffer.concat([u32(8 + keyName.length), ascii("mdta"), ascii(keyName)]);
  const keys = rawBox("keys", Buffer.concat([u32(0), u32(1), keyEntry]));
  const data = rawBox("data", Buffer.concat([u32(1), u32(0), ascii(value)]));
  const item = Buffer.concat([u32(8 + data.length), u32(1), data]); // type field = key index 1
  const ilst = rawBox("ilst", item);
  return rawBox("meta", Buffer.concat([keys, ilst]));
}

/** A video with just an mvhd time. */
function movMvhd(creationTime: number): Blob {
  const ftyp = rawBox("ftyp", ascii("isomiso2"));
  const mdat = rawBox("mdat", Buffer.alloc(4096)); // bulky, must be skipped
  const moov = rawBox("moov", mvhd(creationTime));
  return new Blob([ftyp, mdat, moov]);
}

/** A video with Apple creationdate metadata and a (different) mvhd time. */
function movWithCreationDate(creationDate: string, mvhdSeconds: number): Blob {
  const ftyp = rawBox("ftyp", ascii("isomiso2"));
  const mdat = rawBox("mdat", Buffer.alloc(4096));
  const moov = rawBox("moov", Buffer.concat([mvhd(mvhdSeconds), metaWithCreationDate(creationDate)]));
  return new Blob([ftyp, mdat, moov]);
}

test("prefers Apple creationdate and applies its UTC offset", async () => {
  // 6:03pm local at +0100 == 17:03 UTC. mvhd is set to a wrong time on purpose.
  const wrongMvhd = Math.floor(Date.UTC(2020, 0, 1) / 1000) + MP4_EPOCH_OFFSET;
  const d = await getVideoCreationDate(movWithCreationDate("2026-06-22T18:03:00+0100", wrongMvhd));
  assert.ok(d, "expected a date");
  assert.equal(d!.getTime(), Date.UTC(2026, 5, 22, 17, 3, 0));
});

test("handles a colon in the offset too", async () => {
  const d = await getVideoCreationDate(movWithCreationDate("2026-06-22T18:03:00+01:00", 0));
  assert.equal(d!.getTime(), Date.UTC(2026, 5, 22, 17, 3, 0));
});

test("falls back to mvhd when no creationdate, preserving the instant", async () => {
  const instant = Date.UTC(2019, 0, 5, 9, 30, 0);
  const d = await getVideoCreationDate(movMvhd(Math.floor(instant / 1000) + MP4_EPOCH_OFFSET));
  assert.equal(d!.getTime(), instant);
});

test("two clips from the same day keep distinct, ordered times", async () => {
  const morning = "2026-06-22T08:15:00+0100";
  const evening = "2026-06-22T20:45:00+0100";
  const a = await getVideoCreationDate(movWithCreationDate(morning, 0));
  const b = await getVideoCreationDate(movWithCreationDate(evening, 0));
  assert.ok(a!.getTime() < b!.getTime(), "morning should sort before evening");
});

test("returns null for a non-MP4 blob", async () => {
  const junk = new Blob([Buffer.from("not a video file at all, just text")]);
  assert.equal(await getVideoCreationDate(junk), null);
});

test("getVideoDate falls back to a filename date when no container date", async () => {
  const blob = movMvhd(0); // mvhd creation_time 0 → no usable container date
  const named = new File([blob], "VID_20240704_101112.mov", { type: "video/quicktime" });
  const d = await getVideoDate(named);
  assert.ok(d, "expected a fallback date");
  assert.equal(d!.getFullYear(), 2024);
  assert.equal(d!.getMonth(), 6); // July
  assert.equal(d!.getDate(), 4);
});
