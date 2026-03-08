import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** List all albums for autocomplete */
export async function GET() {
  const result = await db.execute(
    "SELECT id, title, slug FROM albums ORDER BY title"
  );
  return NextResponse.json(
    result.rows.map((r) => ({ id: r.id, title: r.title, slug: r.slug }))
  );
}
