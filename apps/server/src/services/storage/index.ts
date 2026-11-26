import { join } from "node:path";
import type { Env } from "../../config/env";
import { serverRoot } from "../../config/paths";
import { LocalStorage } from "./local";
import { SupabaseStorage } from "./supabase";
import type { StorageService } from "./types";

export { LocalStorage } from "./local";
export { SupabaseStorage } from "./supabase";
export type { SavedFile, StorageService } from "./types";

/** Picks the driver named by STORAGE_DRIVER. */
export function createStorage(env: Env): StorageService {
  if (env.STORAGE_DRIVER === "local") {
    return new LocalStorage(join(serverRoot, "uploads"), env.JWT_SECRET);
  }
  // parseEnv() has already checked that all three are set.
  return new SupabaseStorage(env.SUPABASE_URL!, env.SUPABASE_SERVICE_KEY!, env.STORAGE_BUCKET!);
}
