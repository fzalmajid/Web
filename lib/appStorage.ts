import { upload as uploadBlob } from "@vercel/blob/client";
import {
  AVATAR_CONTENT_TYPES, MAX_AVATAR_BYTES, MAX_FILE_BYTES, FileAccessError, blobPath, fileBucket,
  filePath, fileReadUrl, storageResult, type StorageUploadOptions,
} from "./appStorageShared";

type BrowserFileBody = Blob | ArrayBuffer | string;

export function createAppStorage(getAccessToken: () => Promise<string>) {
  async function headers() {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error();
      return { Authorization: "Bearer " + token };
    } catch { throw new FileAccessError("Login diperlukan untuk membuka file.", 401); }
  }
  async function operation<T>(bucket: string, action: string, values: Record<string, unknown>): Promise<T> {
    const response = await fetch("/api/files/operations", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { ...await headers(), "Content-Type": "application/json" }, body: JSON.stringify({ bucket: fileBucket(bucket), action, ...values }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new FileAccessError(typeof body?.error === "string" ? body.error : "File belum dapat diproses. Coba lagi sebentar.", response.status);
    return body.data as T;
  }
  return { from(bucket: string) {
    async function upload(path: string, body: BrowserFileBody, options: StorageUploadOptions = {}) {
      const name = fileBucket(bucket);
      const target = filePath(path).path;
      const size = body instanceof Blob ? body.size : typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength;
      const maximum = name === "profile-avatars" ? MAX_AVATAR_BYTES : MAX_FILE_BYTES;
      if (size > maximum) throw new FileAccessError("File melebihi batas ukuran penyimpanan.", 413);
      if (name === "profile-avatars" && !AVATAR_CONTENT_TYPES.includes(options.contentType || "")) throw new FileAccessError("Foto profil harus berformat JPG, PNG, atau WebP.");
      // The token route independently verifies ownership; the browser never has a store credential.
      await uploadBlob(blobPath(name, target), body, { access: "private", multipart: true, handleUploadUrl: "/api/files/upload", headers: await headers(), contentType: options.contentType, clientPayload: JSON.stringify({ bucket: name, path: target, upsert: options.upsert === true, contentType: options.contentType }) });
      return { path: target, fullPath: blobPath(name, target), id: blobPath(name, target) };
    }
    return {
      upload(path: string, body: BrowserFileBody, options?: StorageUploadOptions) { return storageResult(() => upload(path, body, options)); },
      update(path: string, body: BrowserFileBody, options?: StorageUploadOptions) { return storageResult(() => upload(path, body, { ...options, upsert: true })); },
      download(path: string) {
        return storageResult(async () => {
          const response = await fetch(fileReadUrl(bucket, path), { headers: await headers(), credentials: "same-origin", cache: "no-store" });
          if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new FileAccessError(typeof body?.error === "string" ? body.error : "File belum dapat dibuka.", response.status);
          }
          return response.blob();
        });
      },
      createSignedUrl(path: string, expiresIn: number) { return storageResult(() => operation<{ signedUrl: string }>(bucket, "signed-url", { path, expiresIn })); },
      createSignedUrls(paths: string[], expiresIn: number) { return storageResult(() => operation<Array<{ path: string; signedUrl: string; error: string | null }>>(bucket, "signed-urls", { paths, expiresIn })); },
      remove(paths: string[]) { return storageResult(() => operation<Array<{ name: string }>>(bucket, "remove", { paths })); },
      copy(fromPath: string, toPath: string) { return storageResult(() => operation<{ path: string }>(bucket, "copy", { fromPath, toPath })); },
      list(prefix?: string, options?: { limit?: number; offset?: number; search?: string }) { return storageResult(() => operation<unknown[]>(bucket, "list", { prefix, options })); },
      getPublicUrl(path: string, options?: { download?: string | boolean }) { return { data: { publicUrl: fileReadUrl(bucket, path, options?.download) } }; },
    };
  } };
}
