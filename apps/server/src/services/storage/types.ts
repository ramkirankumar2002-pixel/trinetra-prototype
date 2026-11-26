export interface SavedFile {
  path: string;
  /** SHA-256 of the saved bytes, as hex. Proves later that a photo was not changed. */
  sha256: string;
}

/** Where photos and invoices are kept. Saved files are never overwritten. */
export interface StorageService {
  save(buffer: Buffer, path: string, contentType: string): Promise<SavedFile>;
  /** A link that works without a login, only until it expires. */
  getUrl(path: string, expiresInSeconds: number): Promise<string>;
}
