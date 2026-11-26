import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "../../errors/app-error";
import { assertExpiry, assertMatchingType, contentTypeOf, sha256Of } from "./rules";
import type { SavedFile, StorageService } from "./types";

export const LOCAL_FILES_PREFIX = "/api/files/";

const invalidLink = () => new AppError(403, "INVALID_LINK", "This file link is not valid.");

const hasErrorCode = (error: unknown, code: string) =>
  (error as NodeJS.ErrnoException | undefined)?.code === code;

/** Keeps files in a folder. Links are signed here and served by routes/files.ts. */
export class LocalStorage implements StorageService {
  private readonly signingKey: Buffer;

  constructor(
    private readonly folder: string,
    secret: string,
    private readonly now: () => number = Date.now,
  ) {
    // A separate key made from the secret, so a link signature can never act as a login token.
    this.signingKey = createHmac("sha256", secret).update("trinetra-file-links").digest();
  }

  async save(buffer: Buffer, path: string, contentType: string): Promise<SavedFile> {
    assertMatchingType(path, contentType);
    const file = join(this.folder, path);
    await mkdir(dirname(file), { recursive: true });
    try {
      // "wx" fails if the file exists: evidence photos are never replaced.
      await writeFile(file, buffer, { flag: "wx" });
    } catch (error) {
      if (hasErrorCode(error, "EEXIST")) {
        throw new AppError(409, "FILE_EXISTS", "A file with this name is already saved.");
      }
      throw error;
    }
    return { path, sha256: sha256Of(buffer) };
  }

  async read(path: string): Promise<Buffer> {
    contentTypeOf(path);
    return readFile(join(this.folder, path));
  }

  /** Returns an address on this server, such as /api/files/a/b.jpg?expires=...&sig=... */
  async getUrl(path: string, expiresInSeconds: number): Promise<string> {
    contentTypeOf(path);
    assertExpiry(expiresInSeconds);
    const expires = Math.floor(this.now() / 1000) + expiresInSeconds;
    return `${LOCAL_FILES_PREFIX}${path}?expires=${expires}&sig=${this.sign(path, expires)}`;
  }

  /** Checks a signed link, then reads the file. */
  async readSigned(
    path: string,
    expires: number,
    signature: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    const expected = Buffer.from(this.sign(path, expires));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalidLink();
    if (this.now() / 1000 >= expires) {
      throw new AppError(403, "LINK_EXPIRED", "This file link has expired.");
    }

    const contentType = contentTypeOf(path);
    try {
      return { data: await readFile(join(this.folder, path)), contentType };
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        throw new AppError(404, "NOT_FOUND", "The file does not exist.");
      }
      throw error;
    }
  }

  private sign(path: string, expires: number): string {
    return createHmac("sha256", this.signingKey).update(`${path}\n${expires}`).digest("base64url");
  }
}
