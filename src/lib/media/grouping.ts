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

/**
 * Pick the candidate group closest in time to `dateMs` and within thresholdMs.
 * Each candidate is the list of its members' timestamps (ms). Returns the
 * winning candidate's index, or -1 if none has a member within the threshold.
 * Used to slot a newly-added photo into the right existing group. Pure.
 */
export function nearestGroupWithin(
  candidates: number[][],
  dateMs: number,
  thresholdMs: number
): number {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let gi = 0; gi < candidates.length; gi++) {
    for (const t of candidates[gi]) {
      const dist = Math.abs(t - dateMs);
      if (dist <= thresholdMs && dist < bestDist) {
        bestDist = dist;
        bestIdx = gi;
      }
    }
  }
  return bestIdx;
}
