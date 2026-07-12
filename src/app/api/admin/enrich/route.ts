import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { buildEnrichment } from "@/lib/enrich/build";
import type { RawModelEnrichment } from "@/lib/enrich/types";
import type { VocabTag } from "@/lib/enrich/tags";

/**
 * Compose-time vision enrichment (Phase 10.1e, compose-time variant).
 *
 * The upload/edit pages POST one small JPEG rendition per photo while the
 * user is still filling in the form; the response feeds the Suggested-date
 * affordance and the tag-suggestion chips, and is persisted verbatim at
 * publish (see upload/complete + posts/[postId] PUT). Admin-gated by
 * middleware like every /api/admin route.
 *
 * Design constraints:
 *  - Closed tag vocabulary: the model picks from the album's existing tags
 *    (fetched here, server-side) rather than inventing labels; at most two
 *    genuinely-new proposals come back, clearly separated.
 *  - Dates must be literal: the schema forces a quoted_text alongside every
 *    date, and validation drops anything partial or outside a sane range.
 *  - Soft failure: without ANTHROPIC_API_KEY this returns 503 and the client
 *    silently hides the feature. A model/parse error is a 502 the client
 *    treats the same way. Publishing never depends on this route.
 */

export const maxDuration = 30;

const DEFAULT_MODEL = "claude-haiku-4-5";

// ~2 MB of binary image as base64. The client sends a ≤1024px JPEG (~100-300KB),
// so this is purely a backstop against misuse.
const MAX_BASE64_LENGTH = 2_800_000;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caption", "labels", "ocr_text", "dates", "applicable_tags", "new_tags"],
  properties: {
    caption: {
      type: "string",
      description: "One factual sentence describing the photo, for search.",
    },
    labels: {
      type: "array",
      items: { type: "string" },
      description: "3-8 lowercase subject/scene labels (objects, activities, settings).",
    },
    ocr_text: {
      type: "string",
      description: "All legible text visible in the image, verbatim. Empty string if none.",
    },
    dates: {
      type: "array",
      description:
        "Calendar dates readable IN the image (invitations, banners, signs, screens). Only include a date you can quote the exact source text for. Use YYYY-MM-DD; omit dates you cannot resolve to a full day. Never infer dates from the scene itself.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "quoted_text", "kind", "confidence"],
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          quoted_text: {
            type: "string",
            description: "The exact text in the image this date was read from.",
          },
          kind: {
            type: "string",
            enum: ["document", "handwriting", "display", "other"],
            description:
              "document = printed invitation/flyer/ticket/certificate; display = digital screen/watermark.",
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
    applicable_tags: {
      type: "array",
      items: { type: "string" },
      description: "Tags from the provided vocabulary list that clearly apply. Exact spelling.",
    },
    new_tags: {
      type: "array",
      items: { type: "string" },
      description:
        "At most 2 short new tags for a clearly significant theme NOT covered by the vocabulary. Usually empty.",
    },
  },
} as const;

const SYSTEM_PROMPT = `You analyze one photo from a private family photo album so it can be dated, tagged, and searched. Be factual and conservative: describe only what is visible, never guess names or places, and only report a date when you can read it in the image and quote the text it came from. Yearless dates (like "July 4") are not full dates — omit them. Historic or decorative years (e.g. "1776" on patriotic artwork) are not capture dates — omit them unless the full date plainly refers to the photographed event.`;

export async function POST(request: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Enrichment not configured" }, { status: 503 });
  }

  let body: { imageBase64?: string; mediaType?: string; contentHash?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { imageBase64, contentHash } = body;
  const mediaType = body.mediaType === "image/png" ? "image/png" : "image/jpeg";
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json({ error: "imageBase64 required" }, { status: 400 });
  }
  if (imageBase64.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 });
  }

  // Re-upload of a photo we've already analyzed (dedup by original-bytes
  // hash) — return the stored payload instead of paying for a second pass.
  if (contentHash && /^[a-f0-9]{64}$/.test(contentHash)) {
    try {
      const cached = await db.execute({
        sql: `SELECT r.payload FROM media_metadata_raw r
              INNER JOIN media m ON m.id = r.media_id
              WHERE m.content_hash = ? AND r.source = 'vision'
              ORDER BY r.created_at DESC LIMIT 1`,
        args: [contentHash],
      });
      if (cached.rows.length > 0) {
        return NextResponse.json({
          enrichment: JSON.parse(cached.rows[0].payload as string),
          cached: true,
        });
      }
    } catch {
      // Cache lookup is best-effort; fall through to a fresh pass.
    }
  }

  try {
    const vocabResult = await db.execute("SELECT name, slug FROM tags ORDER BY name");
    const vocab: VocabTag[] = vocabResult.rows.map((r) => ({
      name: r.name as string,
      slug: r.slug as string,
    }));

    const model = process.env.ENRICH_MODEL || DEFAULT_MODEL;
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            {
              type: "text",
              text:
                vocab.length > 0
                  ? `Existing album tags (choose applicable_tags ONLY from this list, exact spelling):\n${vocab
                      .map((t) => t.name)
                      .join(", ")}`
                  : "The album has no tags yet — applicable_tags must be empty; you may propose up to 2 new_tags.",
            },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) {
      return NextResponse.json({ error: "Empty model response" }, { status: 502 });
    }
    const raw = JSON.parse(text) as RawModelEnrichment;
    const enrichment = buildEnrichment(raw, vocab, model, new Date().getUTCFullYear());
    return NextResponse.json({ enrichment, cached: false });
  } catch (error) {
    console.error("Enrich error:", error);
    return NextResponse.json({ error: "Enrichment failed" }, { status: 502 });
  }
}
