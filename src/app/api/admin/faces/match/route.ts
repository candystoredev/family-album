import { NextRequest, NextResponse } from "next/server";
import { ensureFacesSchema } from "@/lib/schema";
import { loadPersonReferences } from "@/lib/faces/server";
import { matchToKnown } from "@/lib/faces/cluster";
import { DESCRIPTOR_LENGTH } from "@/lib/faces/descriptor";

/**
 * Compose-time face → person matching. The client detects faces in the photo(s)
 * it's about to publish (in-browser, nothing leaves the device except these
 * abstract descriptors) and posts the descriptors here; we compare each against
 * the confirmed-people reference centroids and return the distinct people who
 * appear to be present. Those become tap-to-add People suggestions on the form —
 * suggest-never-auto-apply, closed-vocabulary (only EXISTING named people).
 *
 * Admin-gated by middleware.
 */

const MAX_DESCRIPTORS = 64;

export async function POST(request: NextRequest) {
  let body: { descriptors?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const descriptors = body.descriptors;
  if (!Array.isArray(descriptors)) {
    return NextResponse.json({ error: "descriptors[] required" }, { status: 400 });
  }
  if (descriptors.length > MAX_DESCRIPTORS) {
    return NextResponse.json({ error: "Too many descriptors" }, { status: 413 });
  }
  // Number.isFinite (not typeof) — NaN would make every distance NaN.
  const valid = descriptors.filter(
    (d): d is number[] =>
      Array.isArray(d) && d.length === DESCRIPTOR_LENGTH && d.every((n) => Number.isFinite(n))
  );
  if (valid.length === 0) return NextResponse.json({ people: [] });

  await ensureFacesSchema();
  const references = await loadPersonReferences();
  if (references.length === 0) return NextResponse.json({ people: [] });

  // Distinct matched people, keeping the closest distance seen for each.
  const matched = new Map<string, { personId: string; name: string; distance: number }>();
  for (const descriptor of valid) {
    const m = matchToKnown(descriptor, references);
    if (!m) continue;
    const prev = matched.get(m.personId);
    if (!prev || m.distance < prev.distance) matched.set(m.personId, m);
  }

  return NextResponse.json({
    people: [...matched.values()].sort((a, b) => a.distance - b.distance),
  });
}
