import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** apps/server/.env, found the same way whatever folder the command is run from. */
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));

/** Loads apps/server/.env if it exists. Variables already set in the shell win. */
export function loadEnv(): void {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

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
