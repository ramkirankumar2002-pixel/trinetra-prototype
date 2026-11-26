// Creates the databases named in DATABASE_URL and TEST_DATABASE_URL if they are missing.
import postgres from "postgres";
import { describeDatabase, loadEnv, requireEnv } from "./env";

loadEnv();

const urls = [requireEnv("DATABASE_URL"), process.env.TEST_DATABASE_URL].filter(
  (url): url is string => Boolean(url),
);

for (const url of urls) {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));

  // CREATE DATABASE has to run from another database; "postgres" always exists.
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const sql = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });

  try {
    const found = await sql`select 1 from pg_database where datname = ${name}`;
    if (found.length > 0) {
      console.log(`Already exists: ${describeDatabase(url)}`);
    } else {
      await sql`create database ${sql(name)}`;
      console.log(`Created: ${describeDatabase(url)}`);
    }
  } finally {
    await sql.end();
  }
}
