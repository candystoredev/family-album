import { db } from "./db";

/** Read a single site_settings value, or null if unset. */
export async function getSetting(key: string): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT value FROM site_settings WHERE key = ?",
    args: [key],
  });
  if (result.rows.length === 0) return null;
  return result.rows[0].value as string;
}

/** Read several settings at once into a plain object. */
export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const placeholders = keys.map(() => "?").join(",");
  const result = await db.execute({
    sql: `SELECT key, value FROM site_settings WHERE key IN (${placeholders})`,
    args: keys,
  });
  const out: Record<string, string> = {};
  for (const row of result.rows) {
    out[row.key as string] = row.value as string;
  }
  return out;
}

/** Upsert a single site_settings value. */
export async function setSetting(key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO site_settings (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    args: [key, value],
  });
}
