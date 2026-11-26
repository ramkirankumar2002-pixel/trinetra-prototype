// pnpm db:seed            load or update the default data
// pnpm db:seed --reset    empty every table first (deletes all tickets), then load
import { SEED_USERS } from "@trinetra/shared/seed";
import { createDb } from "./client";
import { describeDatabase, loadEnv, requireEnv } from "./env";
import { seedDatabase } from "./seed";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const unknown = args.filter((arg) => arg !== "--reset");
if (unknown.length > 0) {
  // A typo must not quietly run a different command than the one meant.
  console.error(`Unknown option: ${unknown.join(" ")}. The only option is --reset.`);
  process.exit(1);
}
const reset = args.includes("--reset");

loadEnv();
const url = requireEnv("DATABASE_URL");
const { db, close } = createDb(url, { max: 1 });

try {
  if (reset) console.log(`Resetting ${describeDatabase(url)}: all data will be deleted.`);
  await seedDatabase(db, { reset });
  console.log(`Seed complete: ${describeDatabase(url)}`);
} finally {
  await close();
}

console.log("\nDemo PINs (local demo only):");
console.table(SEED_USERS.map(({ username, name, role, pin }) => ({ username, name, role, pin })));
