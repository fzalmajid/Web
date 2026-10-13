import { fileReadUrl, storageResult, type StorageUploadOptions } from "./appStorageShared";
import {
  copyPrivateFile, listPrivateFiles, readPrivateFile, removePrivateFiles, signedPrivateFile,
  uploadPrivateFile, verifiedFileContext, type FileBody,
} from "./privateFileService";

/** Server operations never send a user's access token to a browser endpoint. */
export function createServerAppStorage(getAccessToken: () => Promise<string>) {
  const context = async () => verifiedFileContext(await getAccessToken());
  return { from(bucket: string) { return {
    upload(path: string, body: FileBody, options?: StorageUploadOptions) {
      return storageResult(async () => uploadPrivateFile(await context(), bucket, path, body, options));
    },
    update(path: string, body: FileBody, options?: StorageUploadOptions) {
      return storageResult(async () => uploadPrivateFile(await context(), bucket, path, body, { ...options, upsert: true }));
    },
    download(path: string) {
      return storageResult(async () => {
        const result = await readPrivateFile(await context(), bucket, path);
        return new Response(result.stream, { headers: { "Content-Type": result.blob.contentType } }).blob();
      });
    },
    createSignedUrl(path: string, expiresIn: number) {
      return storageResult(async () => signedPrivateFile(await context(), bucket, path, expiresIn));
    },
    createSignedUrls(paths: string[], expiresIn: number) {
      return storageResult(async () => {
        const caller = await context();
        return Promise.all(paths.map(async path => {
          const result = await storageResult(() => signedPrivateFile(caller, bucket, path, expiresIn));
          return { path, signedUrl: result.data?.signedUrl || "", error: result.error?.message || null };
        }));
      });
    },
    remove(paths: string[]) { return storageResult(async () => removePrivateFiles(await context(), bucket, paths)); },
    copy(fromPath: string, toPath: string) { return storageResult(async () => copyPrivateFile(await context(), bucket, fromPath, toPath)); },
    list(prefix?: string, options?: { limit?: number; offset?: number; search?: string }) {
      return storageResult(async () => listPrivateFiles(await context(), bucket, prefix, options));
    },
    getPublicUrl(path: string, options?: { download?: string | boolean }) {
      // This stable app URL still requires the caller's HttpOnly login cookie.
      return { data: { publicUrl: fileReadUrl(bucket, path, options?.download) } };
    },
  }; } };
}
