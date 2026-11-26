// Not yet tested against a real Supabase project: that happens in Phase 16.
import { createClient } from "@supabase/supabase-js";
import { assertExpiry, assertMatchingType, contentTypeOf, sha256Of } from "./rules";
import type { SavedFile, StorageService } from "./types";

/** Keeps files in a private Supabase Storage bucket. Only the backend has the service key. */
export class SupabaseStorage implements StorageService {
  private readonly bucket;

  constructor(url: string, serviceKey: string, bucket: string) {
    const client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = client.storage.from(bucket);
  }

  async save(buffer: Buffer, path: string, contentType: string): Promise<SavedFile> {
    assertMatchingType(path, contentType);
    const { error } = await this.bucket.upload(path, buffer, { contentType, upsert: false });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
    return { path, sha256: sha256Of(buffer) };
  }

  async read(path: string): Promise<Buffer> {
    contentTypeOf(path);
    const { data, error } = await this.bucket.download(path);
    if (error) throw new Error(`Supabase download failed: ${error.message}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async getUrl(path: string, expiresInSeconds: number): Promise<string> {
    contentTypeOf(path);
    assertExpiry(expiresInSeconds);
    const { data, error } = await this.bucket.createSignedUrl(path, expiresInSeconds);
    if (error) throw new Error(`Supabase link failed: ${error.message}`);
    return data.signedUrl;
  }
}
