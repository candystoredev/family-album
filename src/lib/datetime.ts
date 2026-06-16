/** Current date parts in a given IANA timezone. */
export function zonedNow(timeZone: string): {
  date: string; // YYYY-MM-DD
  hour: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    date: `${year}-${month}-${day}`,
    hour: Number(get("hour")),
    month: Number(month),
    day: Number(day),
  };
}
