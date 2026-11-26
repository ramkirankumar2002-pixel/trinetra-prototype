import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Applies every migration in apps/server/drizzle that the database does not have yet. */
export async function migrateDatabase(url: string): Promise<void> {
  const { db, close } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
