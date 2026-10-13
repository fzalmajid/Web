export const FILE_BUCKETS = ["study-files", "recordings", "profile-avatars"] as const;
export type FileBucket = typeof FILE_BUCKETS[number];
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
export type StorageResult<T> = { data: T | null; error: { message: string } | null };
export type StorageUploadOptions = { contentType?: string; upsert?: boolean; cacheControl?: string };

export class FileAccessError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function fileBucket(value: unknown): FileBucket {
  if (typeof value !== "string" || !FILE_BUCKETS.includes(value as FileBucket)) {
    throw new FileAccessError("Tempat penyimpanan file tidak valid.");
  }
  return value as FileBucket;
}

/** Object paths are literal names, never URLs or encoded/relative paths. */
export function filePath(value: unknown): { path: string; ownerId: string } {
  if (typeof value !== "string" || !value || value.length > 900 || value !== value.trim() ||
      /[\\%?#*\u0000-\u001f\u007f]/.test(value)) {
    throw new FileAccessError("Alamat file tidak valid.");
  }
  const parts = value.split("/");
  if (parts.length < 2 || parts.some(part => !part || part === "." || part === "..") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[0])) {
    throw new FileAccessError("Alamat file tidak valid.");
  }
  return { path: value, ownerId: parts[0].toLowerCase() };
}

export function blobPath(bucket: FileBucket, path: string) { return bucket + "/" + filePath(path).path; }

export function signedUrlLifetime(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new FileAccessError("Masa berlaku link tidak valid.");
  }
  return Math.max(1, Math.min(3600, Math.floor(value)));
}

export function storageFailure(error: unknown): { message: string } {
  return { message: error instanceof FileAccessError ? error.message : "File belum dapat diproses. Coba lagi sebentar." };
}

export async function storageResult<T>(action: () => Promise<T>): Promise<StorageResult<T>> {
  try { return { data: await action(), error: null }; }
  catch (error) { return { data: null, error: storageFailure(error) }; }
}

export function fileReadUrl(bucket: string, path: string, download?: string | boolean): string {
  const params = new URLSearchParams({ bucket: fileBucket(bucket), path: filePath(path).path });
  if (download) params.set("download", typeof download === "string" ? download : "1");
  return "/api/files/read?" + params.toString();
}
