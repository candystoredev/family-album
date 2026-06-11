import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** List all people, most-used first, for the quick-select picker. */
export async function GET() {
  const result = await db.execute(`
    SELECT p.id, p.name, p.slug, COUNT(pp.post_id) AS count
    FROM people p
    LEFT JOIN post_people pp ON pp.person_id = p.id
    GROUP BY p.id, p.name, p.slug
    ORDER BY count DESC, p.name
  `);
  return NextResponse.json(
    result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      count: Number(r.count) || 0,
    }))
  );
}
