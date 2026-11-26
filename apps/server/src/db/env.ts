// Small helpers for the database command-line scripts, which need only a database address.
import { loadEnvFile as loadEnv } from "../config/paths";

export { loadEnv };

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to apps/server/.env (see .env.example).`);
  }
  return value;
}

/** "localhost:5433/trinetra": safe to print because it leaves out the user and password. */
export function describeDatabase(url: string): string {
  const { host, pathname } = new URL(url);
  return `${host}${pathname}`;
}
