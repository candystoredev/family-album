import { createClient, type Client } from "@libsql/client";

let _db: Client | null = null;

export function getDb(): Client {
  if (!_db) {
    _db = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _db;
}

// Convenience alias — lazy so it doesn't crash at import time during build
export const db = new Proxy({} as Client, {
  get(_, prop) {
    const target = getDb();
    const value = (target as unknown as Record<string | symbol, unknown>)[prop];
    // Bind methods so they retain the correct `this` (needed for private fields)
    if (typeof value === "function") {
      return value.bind(target);
    }
    return value;
  },
});
