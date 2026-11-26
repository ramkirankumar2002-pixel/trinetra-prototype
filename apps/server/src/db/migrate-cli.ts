import { describeDatabase, loadEnv, requireEnv } from "./env";
import { migrateDatabase } from "./migrate";

loadEnv();
const url = requireEnv("DATABASE_URL");

await migrateDatabase(url);
console.log(`Migrations applied to ${describeDatabase(url)}`);
