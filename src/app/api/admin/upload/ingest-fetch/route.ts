import { NextRequest, NextResponse } from "next/server";
import { downloadFromR2 } from "@/lib/r2";

/**
 * Same-origin proxy that streams a staged original back from R2 so the upload
 * page can pull it into its queue without R2 CORS (share-to-upload flow).
 *
 * The iOS Shortcut presigns + PUTs originals to R2, then opens
 * /admin/upload?ingest=…; the page fetches each one through here. Admin-gated by
 * middleware (cookie when the page calls it, or Bearer ADMIN_API_TOKEN).
 *
 * GET /api/admin/upload/ingest-fetch?key=media/…&type=image/jpeg
 */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("key");
  // Only allow keys under the media/ prefix (where presign writes) — never an
  // arbitrary R2 path.
  if (!key || !key.startsWith("media/") || key.includes("..")) {
    return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  }
  const type = request.nextUrl.searchParams.get("type") || "application/octet-stream";
  try {
    const buf = await downloadFromR2(key);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": type,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
