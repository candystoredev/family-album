import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getPresignedUploadUrl } from "@/lib/r2";

/**
 * Generate a presigned PUT URL for direct client-to-R2 upload.
 * Client sends: { contentType: "image/jpeg" }
 * Returns: { uploadUrl, r2Key, keyPrefix }
 */
export async function POST(request: NextRequest) {
  try {
    const { contentType } = await request.json();

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "video/mp4",
      "video/quicktime",
      "video/webm",
    ];
    if (!contentType || !allowedTypes.includes(contentType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${contentType}` },
        { status: 400 }
      );
    }

    // Use current time for the key prefix (will be updated with EXIF date later if available)
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, "0");
    const d = String(now.getUTCDate()).padStart(2, "0");
    const h = String(now.getUTCHours()).padStart(2, "0");
    const min = String(now.getUTCMinutes()).padStart(2, "0");
    const suffix = nanoid(4);
    const keyPrefix = `media/${y}${m}${d}-${h}${min}UTC-${suffix}`;

    // Extension from content type
    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/heic": "heic",
      "image/heif": "heif",
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
    };
    const ext = extMap[contentType] || "jpg";
    const r2Key = `${keyPrefix}/original.${ext}`;

    const uploadUrl = await getPresignedUploadUrl(r2Key, contentType);

    return NextResponse.json({ uploadUrl, r2Key, keyPrefix });
  } catch (error) {
    console.error("Presign error:", error);
    return NextResponse.json(
      { error: "Failed to generate upload URL" },
      { status: 500 }
    );
  }
}
