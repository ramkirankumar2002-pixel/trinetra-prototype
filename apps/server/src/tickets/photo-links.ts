import { inArray } from "drizzle-orm";
import { photos } from "../db/schema";
import type { StorageService } from "../services/storage";
import type { Reader } from "./repo";

export const PHOTO_LINK_SECONDS = 300;

/** Short-lived links for a set of photo ids. */
export async function photoUrls(
  db: Reader,
  storage: StorageService,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const wanted = ids.filter((id): id is string => id !== null);
  if (wanted.length === 0) return new Map();
  const rows = await db.select().from(photos).where(inArray(photos.id, wanted));
  return new Map(
    await Promise.all(
      rows.map(
        async (row) => [row.id, await storage.getUrl(row.storagePath, PHOTO_LINK_SECONDS)] as const,
      ),
    ),
  );
}
