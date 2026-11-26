import { defineConfig } from "drizzle-kit";
import { loadEnv } from "./src/db/env";

loadEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Only "db:studio" connects to the database; "db:generate" just reads the schema files.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
});
