import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { uploadToR2, PUBLIC_URL } from "@/lib/r2";
import { nanoid } from "nanoid";
import sharp from "sharp";

export const maxDuration = 30;

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
    // Define 3 test posts
    const testPosts = [
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
        title: "Happy Steaksgiving",
        slug: "happy-steaksgiving",
        body: "We'll do the real one Saturday",
        date: "2024-11-23T18:00:00Z",
        type: "photo" as const,
        color: { r: 160, g: 80, b: 40 },
        mediaCount: 3,
        photosetLayout: "21", // 2 on top row, 1 on bottom
      },
      {
        title: "First Day of School",
        slug: "first-day-of-school",
        body: null,
        date: "2024-08-19T07:45:00Z",
        type: "photo" as const,
        color: { r: 60, g: 140, b: 60 },
        mediaCount: 1,
      },
    ];

    const results = [];

    for (const post of testPosts) {
      const postId = nanoid();

      // Insert post
      await db.execute({
        sql: `INSERT OR REPLACE INTO posts (id, slug, title, body, date, type, photoset_layout)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          postId,
          post.slug,
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
        slug: post.slug,
        title: post.title,
        mediaCount: mediaIds.length,
        thumbnailUrl: `${PUBLIC_URL()}/media/${mediaIds[0]}/thumb.jpg`,
      });
    }

    return NextResponse.json({
      ok: true,
      message: `Seeded ${results.length} test posts with media in R2`,
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
