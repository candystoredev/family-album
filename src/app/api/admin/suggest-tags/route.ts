import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reverseGeocode } from "@/lib/geo/reverse";
import {
  partitionPlaceComponents,
  type VocabTag,
} from "@/lib/enrich/tags";
import { temporalWindowBounds } from "@/lib/enrich/temporal";
import { ORDER_KEY_SQL } from "@/lib/order";

/**
 * Compose-time context tag suggestions (Part 2, Workstream B). Two DB/geocode-
 * backed sources, both suggest-only and closed-vocabulary:
 *
 *  • Temporal — posts whose effective capture instant falls within ±48h of this
 *    photo's, ordered by how many neighbours share each tag (frequency first).
 *  • Place — the photo's GPS reverse-geocoded offline (no cloud), its
 *    [name, admin2, admin1] components matched against the vocabulary; a town
 *    and county with no existing tag come back as explicit new-tag proposals.
 *
 * One signal failing (geocode/DB) must not kill the other: each degrades to
 * empty on error and we only 502 when every attempted signal genuinely failed.
 * Admin-gated by middleware (no in-route auth), same as similar-tags.
 */

export const maxDuration = 15;

const MAX_TEMPORAL_TAGS = 10;

interface SuggestBody {
  takenAt?: unknown;
  gps?: unknown;
  excludePostId?: unknown;
}

export async function POST(request: NextRequest) {
  let body: SuggestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const takenAt = typeof body.takenAt === "string" ? body.takenAt : null;
  const excludePostId =
    typeof body.excludePostId === "string" && body.excludePostId ? body.excludePostId : null;

  let gps: { lat: number; lng: number } | null = null;
  if (body.gps && typeof body.gps === "object") {
    const g = body.gps as { lat?: unknown; lng?: unknown };
    if (
      typeof g.lat === "number" &&
      Number.isFinite(g.lat) &&
      typeof g.lng === "number" &&
      Number.isFinite(g.lng)
    ) {
      gps = { lat: g.lat, lng: g.lng };
    }
  }

  if (!takenAt && !gps) {
    return NextResponse.json({ error: "takenAt or gps required" }, { status: 400 });
  }

  const tags: string[] = [];
  const seenTag = new Set<string>();
  const addTag = (name: string) => {
    const key = name.toLowerCase();
    if (seenTag.has(key)) return;
    seenTag.add(key);
    tags.push(name);
  };
  const newTagProposals: string[] = [];
  const seenProposal = new Set<string>();
  let place: string | null = null;

  let attempted = 0;
  let failed = 0;

  // ── Temporal neighbours ──────────────────────────────────────────────────
  const bounds = takenAt ? temporalWindowBounds(takenAt) : null;
  if (bounds) {
    attempted++;
    try {
      const args: (string | number)[] = [bounds.start, bounds.end];
      let sql = `SELECT t.name AS name, COUNT(*) AS freq
                 FROM posts p
                 INNER JOIN post_tags pt ON pt.post_id = p.id
                 INNER JOIN tags t ON t.id = pt.tag_id
                 WHERE ${ORDER_KEY_SQL} BETWEEN ? AND ?`;
      if (excludePostId) {
        sql += ` AND p.id != ?`;
        args.push(excludePostId);
      }
      sql += ` GROUP BY t.id ORDER BY freq DESC, t.name ASC LIMIT ?`;
      args.push(MAX_TEMPORAL_TAGS);
      const res = await db.execute({ sql, args });
      for (const r of res.rows) addTag(r.name as string);
    } catch (error) {
      failed++;
      console.error("suggest-tags temporal error:", error);
    }
  }

  // ── Place (offline reverse geocode) ──────────────────────────────────────
  if (gps) {
    attempted++;
    try {
      const geo = reverseGeocode(gps.lat, gps.lng);
      if (geo) {
        place = geo.label;
        const vres = await db.execute("SELECT name, slug FROM tags");
        const vocab: VocabTag[] = vres.rows.map((r) => ({
          name: r.name as string,
          slug: r.slug as string,
        }));
        const part = partitionPlaceComponents(
          { name: geo.name, admin2: geo.admin2, admin1: geo.admin1 },
          vocab
        );
        for (const t of part.tags) addTag(t);
        for (const p of part.newTagProposals) {
          const key = p.toLowerCase();
          if (seenTag.has(key) || seenProposal.has(key)) continue;
          seenProposal.add(key);
          newTagProposals.push(p);
        }
      }
    } catch (error) {
      failed++;
      console.error("suggest-tags place error:", error);
    }
  }

  // 502 only when every signal we tried genuinely failed.
  if (attempted > 0 && failed === attempted) {
    return NextResponse.json({ error: "Suggestion lookup failed" }, { status: 502 });
  }

  return NextResponse.json({ tags, newTagProposals, place });
}
