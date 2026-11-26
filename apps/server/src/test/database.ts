import { createDb } from "../db/client";
import { migrateDatabase } from "../db/migrate";

/**
 * Deletes everything in the test database and applies the real migrations.
 * Test files share this database, so they run one at a time (vitest.config.ts).
 */
export async function resetTestDatabase(url: string): Promise<void> {
  // Everything below deletes data, so refuse anything that is not clearly a test database.
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`TEST_DATABASE_URL must name a database ending in "_test", not "${name}".`);
  }
  const { sql, close } = createDb(url, { max: 1 });
  try {
    await sql.unsafe(
      "drop schema if exists drizzle cascade; drop schema public cascade; create schema public;",
    );
  } finally {
    await close();
  }
  await migrateDatabase(url);
}
