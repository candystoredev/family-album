import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { uploadToR2, PUBLIC_URL } from "@/lib/r2";
import { nanoid } from "nanoid";
import sharp from "sharp";

export const maxDuration = 60;

/** Generate a simple colored JPEG with text overlay via sharp */
async function generateTestImage(
  label: string,
  color: { r: number; g: number; b: number },
  width = 1200,
  height = 800
): Promise<{ original: Buffer; thumbnail: Buffer }> {
  // Create a gradient-like image with SVG overlay
  const svg = `<svg width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="rgb(${color.r},${color.g},${color.b})" />
    <rect width="100%" height="100%" fill="url(#grad)" />
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:rgba(255,255,255,0.15)" />
        <stop offset="100%" style="stop-color:rgba(0,0,0,0.3)" />
      </linearGradient>
    </defs>
    <text x="50%" y="45%" text-anchor="middle" font-family="sans-serif"
          font-size="48" fill="white" font-weight="bold">${label}</text>
    <text x="50%" y="58%" text-anchor="middle" font-family="sans-serif"
          font-size="24" fill="rgba(255,255,255,0.7)">The Hoecks — Test Image</text>
  </svg>`;

  const original = await sharp(Buffer.from(svg))
    .resize(width, height)
    .jpeg({ quality: 85 })
    .toBuffer();

  const thumbnail = await sharp(original)
    .resize(600, 400, { fit: "cover" })
    .jpeg({ quality: 75 })
    .toBuffer();

  return { original, thumbnail };
}

export async function POST(request: Request) {
  // Accept bearer token OR admin session cookie
  const auth = request.headers.get("authorization");
  const hasBearerToken = auth === `Bearer ${process.env.ADMIN_API_TOKEN}`;
  const session = await getSession();
  const isAdmin = session?.role === "admin";

  if (!hasBearerToken && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 25 test posts spanning 2023-2025, mix of single photos, photosets, and text
    const testPosts = [
      {
        title: "New Year's Day Hike",
        slug: "new-years-day-hike",
        body: "Starting the year off right with a hike up the mountain.",
        date: "2025-01-01T10:00:00Z",
        type: "photo" as const,
        color: { r: 80, g: 120, b: 80 },
        mediaCount: 1,
      },
      {
        title: "Christmas Morning",
        slug: "christmas-morning-2024",
        body: "The kids were up at 5am. Worth it.",
        date: "2024-12-25T08:15:00Z",
        type: "photo" as const,
        color: { r: 180, g: 40, b: 40 },
        mediaCount: 4,
        photosetLayout: "22",
      },
      {
        title: "Happy Steaksgiving",
        slug: "happy-steaksgiving",
        body: "We'll do the real one Saturday",
        date: "2024-11-23T18:00:00Z",
        type: "photo" as const,
        color: { r: 160, g: 80, b: 40 },
        mediaCount: 3,
        photosetLayout: "21",
      },
      {
        title: "Fall Colors",
        slug: "fall-colors",
        body: "The backyard is putting on a show this year.",
        date: "2024-10-19T16:00:00Z",
        type: "photo" as const,
        color: { r: 190, g: 120, b: 30 },
        mediaCount: 2,
        photosetLayout: "2",
      },
      {
        title: "Halloween Costumes",
        slug: "halloween-2024",
        body: null,
        date: "2024-10-31T19:30:00Z",
        type: "photo" as const,
        color: { r: 140, g: 80, b: 160 },
        mediaCount: 3,
        photosetLayout: "12",
      },
      {
        title: "First Day of School",
        slug: "first-day-of-school-2024",
        body: null,
        date: "2024-08-19T07:45:00Z",
        type: "photo" as const,
        color: { r: 60, g: 140, b: 60 },
        mediaCount: 1,
      },
      {
        title: "Summer Vacation",
        slug: "summer-vacation-2024",
        body: "Two weeks at the lake. The kids didn't want to leave.",
        date: "2024-07-28T12:00:00Z",
        type: "photo" as const,
        color: { r: 30, g: 150, b: 200 },
        mediaCount: 5,
        photosetLayout: "212",
      },
      {
        title: "Beach Day",
        slug: "beach-day",
        body: "Perfect weather for the beach today!",
        date: "2024-07-15T14:30:00Z",
        type: "photo" as const,
        color: { r: 30, g: 130, b: 180 },
        mediaCount: 1,
      },
      {
        title: "Fourth of July",
        slug: "fourth-of-july-2024",
        body: "Fireworks from the rooftop. Best seats in town.",
        date: "2024-07-04T21:00:00Z",
        type: "photo" as const,
        color: { r: 20, g: 30, b: 100 },
        mediaCount: 2,
        photosetLayout: "11",
      },
      {
        title: "Father's Day Breakfast",
        slug: "fathers-day-2024",
        body: "They made pancakes shaped like hearts. Close enough.",
        date: "2024-06-16T09:00:00Z",
        type: "photo" as const,
        color: { r: 180, g: 160, b: 100 },
        mediaCount: 1,
      },
      {
        title: "End of the School Year",
        slug: "end-of-school-2024",
        body: "Made it through another one. Summer time.",
        date: "2024-06-07T15:30:00Z",
        type: "photo" as const,
        color: { r: 255, g: 200, b: 50 },
        mediaCount: 1,
      },
      {
        title: "Mother's Day",
        slug: "mothers-day-2024",
        body: "She deserves the world.",
        date: "2024-05-12T11:00:00Z",
        type: "photo" as const,
        color: { r: 200, g: 100, b: 150 },
        mediaCount: 2,
        photosetLayout: "11",
      },
      {
        title: "Spring Garden",
        slug: "spring-garden-2024",
        body: "Everything is blooming. The tulips came in strong this year.",
        date: "2024-04-20T10:00:00Z",
        type: "photo" as const,
        color: { r: 100, g: 180, b: 80 },
        mediaCount: 3,
        photosetLayout: "21",
      },
      {
        title: "Easter Egg Hunt",
        slug: "easter-2024",
        body: null,
        date: "2024-03-31T11:00:00Z",
        type: "photo" as const,
        color: { r: 180, g: 220, b: 130 },
        mediaCount: 4,
        photosetLayout: "22",
      },
      {
        title: "Snow Day",
        slug: "snow-day-2024",
        body: "School's canceled. Snowman building competition in full swing.",
        date: "2024-02-10T09:00:00Z",
        type: "photo" as const,
        color: { r: 180, g: 200, b: 220 },
        mediaCount: 1,
      },
      {
        title: "Valentine's Day Dinner",
        slug: "valentines-2024",
        body: "Cooked at home this year. Way better than a restaurant.",
        date: "2024-02-14T19:30:00Z",
        type: "photo" as const,
        color: { r: 180, g: 50, b: 80 },
        mediaCount: 1,
      },
      {
        title: "Super Bowl Sunday",
        slug: "super-bowl-2024",
        body: "We don't care who wins, we're here for the food.",
        date: "2024-02-11T17:00:00Z",
        type: "photo" as const,
        color: { r: 50, g: 80, b: 50 },
        mediaCount: 2,
        photosetLayout: "2",
      },
      {
        title: "New Year's Eve",
        slug: "new-years-eve-2023",
        body: "Made it to midnight. Barely.",
        date: "2023-12-31T23:59:00Z",
        type: "photo" as const,
        color: { r: 30, g: 30, b: 60 },
        mediaCount: 1,
      },
      {
        title: "Christmas Cookie Decorating",
        slug: "christmas-cookies-2023",
        body: "The kids went wild with the sprinkles.",
        date: "2023-12-23T14:00:00Z",
        type: "photo" as const,
        color: { r: 60, g: 120, b: 60 },
        mediaCount: 3,
        photosetLayout: "12",
      },
      {
        title: "Thanksgiving Table",
        slug: "thanksgiving-2023",
        body: "Full house this year. Grateful for all of it.",
        date: "2023-11-23T16:00:00Z",
        type: "photo" as const,
        color: { r: 140, g: 100, b: 50 },
        mediaCount: 1,
      },
      {
        title: "Pumpkin Patch",
        slug: "pumpkin-patch-2023",
        body: null,
        date: "2023-10-14T11:00:00Z",
        type: "photo" as const,
        color: { r: 200, g: 120, b: 30 },
        mediaCount: 4,
        photosetLayout: "211",
      },
      {
        title: "Back to School 2023",
        slug: "back-to-school-2023",
        body: "New backpacks, new shoes, new year.",
        date: "2023-08-21T07:30:00Z",
        type: "photo" as const,
        color: { r: 70, g: 130, b: 180 },
        mediaCount: 2,
        photosetLayout: "11",
      },
      {
        title: "Summer BBQ",
        slug: "summer-bbq-2023",
        body: "Neighbors came over. Burgers, hot dogs, the works.",
        date: "2023-07-22T17:00:00Z",
        type: "photo" as const,
        color: { r: 180, g: 80, b: 30 },
        mediaCount: 1,
      },
      {
        title: "Family Road Trip",
        slug: "road-trip-2023",
        body: "12 hours in the car. 400 rounds of I Spy. No regrets.",
        date: "2023-06-15T08:00:00Z",
        type: "photo" as const,
        color: { r: 100, g: 140, b: 180 },
        mediaCount: 5,
        photosetLayout: "221",
      },
      {
        title: "Birthday Party",
        slug: "birthday-2023",
        body: "Another trip around the sun.",
        date: "2023-05-10T14:00:00Z",
        type: "photo" as const,
        color: { r: 200, g: 150, b: 50 },
        mediaCount: 3,
        photosetLayout: "21",
      },
    ];

    const results = [];
    let skipped = 0;

    for (const post of testPosts) {
      // Skip if a post with this title already exists
      const existing = await db.execute({
        sql: `SELECT id FROM posts WHERE title = ? LIMIT 1`,
        args: [post.title],
      });
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      const postId = nanoid();
      const slug = `${post.slug}-${nanoid(6)}`;

      // Insert post
      await db.execute({
        sql: `INSERT INTO posts (id, slug, title, body, date, type, photoset_layout)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          postId,
          slug,
          post.title,
          post.body,
          post.date,
          post.type,
          post.photosetLayout ?? null,
        ],
      });

      // Generate and upload media
      const mediaIds = [];
      for (let i = 0; i < post.mediaCount; i++) {
        const mediaId = nanoid();
        const label =
          post.mediaCount > 1
            ? `${post.title} (${i + 1}/${post.mediaCount})`
            : post.title;

        // Vary color slightly for multi-photo posts
        const color = {
          r: Math.min(255, post.color.r + i * 20),
          g: Math.min(255, post.color.g + i * 15),
          b: Math.min(255, post.color.b + i * 10),
        };

        const { original, thumbnail } = await generateTestImage(label, color);

        const r2Key = `media/${mediaId}/original.jpg`;
        const thumbKey = `media/${mediaId}/thumb.jpg`;

        await uploadToR2(r2Key, original, "image/jpeg");
        await uploadToR2(thumbKey, thumbnail, "image/jpeg");

        await db.execute({
          sql: `INSERT INTO media (id, post_id, r2_key, thumbnail_r2_key, type, width, height, file_size, display_order, mime_type)
                VALUES (?, ?, ?, ?, 'photo', 1200, 800, ?, ?, 'image/jpeg')`,
          args: [mediaId, postId, r2Key, thumbKey, original.length, i],
        });

        mediaIds.push(mediaId);
      }

      results.push({
        postId,
        slug,
        title: post.title,
        mediaCount: mediaIds.length,
        thumbnailUrl: `${PUBLIC_URL()}/media/${mediaIds[0]}/thumb.jpg`,
      });
    }

    return NextResponse.json({
      ok: true,
      message: `Seeded ${results.length} test posts with media in R2${skipped > 0 ? ` (skipped ${skipped} existing)` : ""}`,
      posts: results,
    });
  } catch (error) {
    console.error("Seed error:", error);
    return NextResponse.json(
      { error: "Seed failed", details: String(error) },
      { status: 500 }
    );
  }
}

/** DELETE /api/seed — Remove duplicate posts (keeps newest per title, deletes older dupes) */
export async function DELETE(request: Request) {
  const auth = request.headers.get("authorization");
  const hasBearerToken = auth === `Bearer ${process.env.ADMIN_API_TOKEN}`;
  const session = await getSession();
  const isAdmin = session?.role === "admin";

  if (!hasBearerToken && !isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find titles that appear more than once
    const dupes = await db.execute(
      `SELECT title, COUNT(*) as cnt FROM posts WHERE title IS NOT NULL GROUP BY title HAVING cnt > 1`
    );

    let deleted = 0;
    for (const row of dupes.rows) {
      const title = row.title as string;
      // Keep the post with the latest created_at (or highest rowid), delete the rest
      const posts = await db.execute({
        sql: `SELECT id FROM posts WHERE title = ? ORDER BY created_at DESC, id DESC`,
        args: [title],
      });
      // Skip the first (newest), delete the rest
      const idsToDelete = posts.rows.slice(1).map((r) => r.id as string);
      for (const id of idsToDelete) {
        // Media cascade-deletes via FK, but R2 media remains (cleanup separately if needed)
        await db.execute({ sql: `DELETE FROM posts WHERE id = ?`, args: [id] });
        deleted++;
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Removed ${deleted} duplicate posts`,
      duplicateTitles: dupes.rows.map((r) => r.title),
    });
  } catch (error) {
    console.error("Dedup error:", error);
    return NextResponse.json(
      { error: "Dedup failed", details: String(error) },
      { status: 500 }
    );
  }
}
