import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * apps/server, found by walking up to its package.json. This works both from src/
 * and from the single bundled file in dist/.
 */
function findServerRoot(): string {
  let folder = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(folder, "package.json"))) {
    const parent = dirname(folder);
    if (parent === folder) throw new Error("Could not find the server's package.json.");
    folder = parent;
  }
  return folder;
}

export const serverRoot = findServerRoot();

/** Loads apps/server/.env if it exists. Variables already set in the shell win. */
export function loadEnvFile(): void {
  const file = join(serverRoot, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
