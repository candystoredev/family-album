/**
 * Read-only check for Phase 10.1a capture columns. Prints the newest posts with
 * their rollup + per-media capture fields, so we can confirm an upload populated
 * taken_at / local_date / date_source correctly without changing any read path.
 *
 * Usage (point at prod, read-only):
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npx tsx scripts/capture-check.ts [limit]
 */
import { createClient } from "@libsql/client";

async function main() {
  const limit = Number(process.argv[2] || 3);
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const posts = await db.execute({
    sql: `SELECT id, slug, date, taken_at, local_date, date_source, source
          FROM posts ORDER BY created_at DESC, id DESC LIMIT ?`,
    args: [limit],
  });

  for (const p of posts.rows) {
    console.log("\n━━ post", p.slug);
    console.log("   legacy date :", p.date);
    console.log("   rollup      : taken_at=%s local_date=%s date_source=%s source=%s",
      p.taken_at, p.local_date, p.date_source, p.source);
    const media = await db.execute({
      sql: `SELECT id, display_order, type, mime_type, r2_key, taken_at, tz_offset, local_date, date_source, date_confidence,
                   content_hash, phash, dominant_color, aspect, orientation, original_filename,
                   gps_lat, gps_lng, gps_altitude, camera_make, camera_model, lens, iso, aperture, shutter_speed, focal_length
            FROM media WHERE post_id = ? ORDER BY display_order`,
      args: [p.id as string],
    });
    for (const m of media.rows) {
      console.log("   media[%s] %s mime=%s key=%s", m.display_order, m.type, m.mime_type, m.r2_key);
      console.log("        capture : taken_at=%s tz=%s local_date=%s src=%s conf=%s",
        m.taken_at, m.tz_offset, m.local_date, m.date_source, m.date_confidence);
      const ch = m.content_hash ? String(m.content_hash).slice(0, 12) + "…" : null;
      console.log("        identity: content_hash=%s phash=%s color=%s aspect=%s orient=%s file=%s",
        ch, m.phash, m.dominant_color, m.aspect, m.orientation, m.original_filename);
      console.log("        device  : make=%s model=%s lens=%s iso=%s f=%s shutter=%s focal=%s",
        m.camera_make, m.camera_model, m.lens, m.iso, m.aperture, m.shutter_speed, m.focal_length);
      console.log("        gps     : lat=%s lng=%s alt=%s  (NEVER exposed on /m/ pages)",
        m.gps_lat, m.gps_lng, m.gps_altitude);
      const raw = await db.execute({ sql: `SELECT COUNT(*) n, MAX(LENGTH(payload)) sz FROM media_metadata_raw WHERE media_id = ?`, args: [m.id as string] });
      const src = await db.execute({ sql: `SELECT kind, match_method, content_hash FROM media_sources WHERE media_id = ?`, args: [m.id as string] });
      console.log("        raw     : %s row(s), payload bytes=%s", raw.rows[0].n, raw.rows[0].sz);
      console.log("        sources : %s", src.rows.map((s) => `${s.kind}/${s.match_method}`).join(", ") || "(none)");
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
