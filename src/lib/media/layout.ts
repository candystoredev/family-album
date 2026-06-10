/**
 * Single source of truth for photoset row layouts.
 *
 * Rules: 1-3 photos → one row; 4 → 2+2; 5+ → rows of 3 with the tail
 * collapsing to 2+2 (never a row of 4) or a final short row.
 */
export function defaultLayoutCounts(count: number): number[] {
  if (count <= 0) return [];
  if (count <= 3) return [count];
  if (count === 4) return [2, 2];
  const rows: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    if (remaining <= 3) { rows.push(remaining); break; }
    if (remaining === 4) { rows.push(2, 2); break; }
    rows.push(3);
    remaining -= 3;
  }
  return rows;
}

/** Convert a flat array into the default 2D row layout. */
export function defaultLayout<T>(items: T[]): T[][] {
  const counts = defaultLayoutCounts(items.length);
  const rows: T[][] = [];
  let i = 0;
  for (const c of counts) {
    rows.push(items.slice(i, i + c));
    i += c;
  }
  return rows;
}

/** Layout string for the posts table, e.g. 5 photos → "32". */
export function generatePhotosetLayout(count: number): string {
  return defaultLayoutCounts(count).join("");
}
