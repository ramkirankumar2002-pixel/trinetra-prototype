import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/** Opens a connection pool. Call close() when finished, or the process keeps running. */
export function createDb(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}

export type Database = ReturnType<typeof createDb>["db"];
