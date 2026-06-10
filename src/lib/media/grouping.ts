export interface DatedItem {
  date: Date;
}

export const GAP_THRESHOLDS = [
  { label: "1 hr", ms: 60 * 60 * 1000 },
  { label: "6 hrs", ms: 6 * 60 * 60 * 1000 },
  { label: "1 day", ms: 24 * 60 * 60 * 1000 },
] as const;

/**
 * Split items into groups wherever the time gap between consecutive items
 * (sorted ascending by date) exceeds the threshold. Pure — safe to re-run
 * live as the threshold changes.
 */
export function groupByGap<T extends DatedItem>(items: T[], thresholdMs: number): T[][] {
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
  const groups: T[][] = [];
  let current: T[] = [];
  for (const item of sorted) {
    const prev = current[current.length - 1];
    if (prev && item.date.getTime() - prev.date.getTime() > thresholdMs) {
      groups.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
