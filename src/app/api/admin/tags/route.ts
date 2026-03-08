import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** List all tags for autocomplete */
export async function GET() {
  const result = await db.execute(
    "SELECT id, name, slug FROM tags ORDER BY name"
  );
  return NextResponse.json(
    result.rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug }))
  );
}
