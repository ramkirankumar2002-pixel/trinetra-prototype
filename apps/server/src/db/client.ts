import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Opens a connection pool. Call close() when finished, or the process keeps running. */
export function createDb(url: string, options: { max?: number } = {}) {
  // Give up on an unreachable server after 5 seconds, not the driver's 30.
  const sql = postgres(url, { max: options.max ?? 10, connect_timeout: 5, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}

export type Database = ReturnType<typeof createDb>["db"];
