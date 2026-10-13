import { copy as copyBlob, del, get, issueSignedToken, list as listBlobs, presignUrl, put } from "@vercel/blob";
import { DATA_BACKEND, requireNeonDataApiUrl } from "./dataBackend";
import { verifyNeonToken } from "./neonAuthToken";
import {
  AVATAR_CONTENT_TYPES, MAX_AVATAR_BYTES, MAX_FILE_BYTES, FileAccessError, blobPath,
  fileBucket, filePath, signedUrlLifetime, type FileBucket, type StorageUploadOptions,
} from "./appStorageShared";

export type FileAccessContext = { token: string; userId: string };
export type FileBody = Blob | ArrayBuffer | Buffer | string;

export function requirePrivateFilesBackend() {
  if (DATA_BACKEND !== "neondb") throw new FileAccessError("Penyimpanan file baru belum aktif.", 503);
}

/** Every operation uses a signature-verified managed Auth JWT. */
export async function verifiedFileContext(token: string): Promise<FileAccessContext> {
  requirePrivateFilesBackend();
  try { return { token, userId: (await verifyNeonToken(token)).id.toLowerCase() }; }
  catch { throw new FileAccessError("Login diperlukan untuk membuka file.", 401); }
}

async function acceptedFriend(context: FileAccessContext, ownerId: string): Promise<boolean> {
  const url = new URL(requireNeonDataApiUrl() + "/friend_connections");
  url.searchParams.set("select", "requester_id,addressee_id,status");
  url.searchParams.set("status", "eq.accepted");
  url.searchParams.set("or", `(and(requester_id.eq.${context.userId},addressee_id.eq.${ownerId}),and(requester_id.eq.${ownerId},addressee_id.eq.${context.userId}))`);
  url.searchParams.set("limit", "1");
  try {
    const response = await fetch(url, { headers: { Authorization: "Bearer " + context.token, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    const rows: unknown = await response.json();
    return Array.isArray(rows) && rows.some(row => row && row.status === "accepted" &&
      ((row.requester_id === context.userId && row.addressee_id === ownerId) ||
       (row.addressee_id === context.userId && row.requester_id === ownerId)));
  } catch { return false; }
}

async function sharedFileVisible(context: FileAccessContext, bucket: FileBucket, path: string, ownerId: string): Promise<boolean> {
  // Large-file parts belong to a ready source's manifest; OCR parts belong to its source.
  const sourcePath = path.replace(/\.ocrpart-\d+-\d+\.pdf$/, "").replace(/\.rbpart-\d{3}$/, ".rbmanifest.json");
  const table = bucket === "recordings" ? "recordings" : "source_files";
  const url = new URL(requireNeonDataApiUrl() + "/" + table);
  url.searchParams.set("select", bucket === "recordings" ? "user_id,file_path" : "user_id,file_path,processing_status");
  url.searchParams.set("user_id", "eq." + ownerId);
  url.searchParams.set("file_path", "eq." + (bucket === "recordings" ? path : sourcePath));
  if (bucket !== "recordings") url.searchParams.set("processing_status", "eq.ready");
  url.searchParams.set("limit", "1");
  try {
    const response = await fetch(url, { headers: { Authorization: "Bearer " + context.token, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    const rows: unknown = await response.json();
    return Array.isArray(rows) && rows.some(row => row && row.user_id === ownerId &&
      row.file_path === (bucket === "recordings" ? path : sourcePath) &&
      (bucket === "recordings" || row.processing_status === "ready"));
  } catch { return false; }
}

export async function authorizeFile(context: FileAccessContext, bucketValue: unknown, pathValue: unknown, access: "read" | "write") {
  requirePrivateFilesBackend();
  const bucket = fileBucket(bucketValue);
  const { path, ownerId } = filePath(pathValue);
  if (ownerId === context.userId || (access === "read" &&
      (bucket === "profile-avatars" || (await acceptedFriend(context, ownerId) && await sharedFileVisible(context, bucket, path, ownerId))))) {
    return { bucket, path, pathname: blobPath(bucket, path) };
  }
  throw new FileAccessError("Anda tidak memiliki akses ke file ini.", 403);
}

export function uploadConstraints(bucket: FileBucket, options: StorageUploadOptions = {}) {
  if (options.upsert !== undefined && typeof options.upsert !== "boolean") throw new FileAccessError("Pilihan unggah tidak valid.");
  if (options.contentType !== undefined && (typeof options.contentType !== "string" || options.contentType.length > 200 || /[\r\n]/.test(options.contentType))) {
    throw new FileAccessError("Jenis file tidak valid.");
  }
  if (bucket === "profile-avatars" && !AVATAR_CONTENT_TYPES.includes(options.contentType || "")) {
    throw new FileAccessError("Foto profil harus berformat JPG, PNG, atau WebP.");
  }
  return {
    access: "private" as const,
    addRandomSuffix: false,
    allowOverwrite: options.upsert === true,
    contentType: options.contentType,
    maximumSizeInBytes: bucket === "profile-avatars" ? MAX_AVATAR_BYTES : MAX_FILE_BYTES,
    cacheControlMaxAge: 60,
  };
}

function knownBodySize(body: FileBody): number {
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer || Buffer.isBuffer(body)) return body.byteLength;
  throw new FileAccessError("Isi file tidak valid.");
}

export async function uploadPrivateFile(context: FileAccessContext, bucket: string, path: string, body: FileBody, options: StorageUploadOptions = {}) {
  const target = await authorizeFile(context, bucket, path, "write");
  const constraints = uploadConstraints(target.bucket, options);
  if (knownBodySize(body) > constraints.maximumSizeInBytes) throw new FileAccessError("File melebihi batas ukuran penyimpanan.", 413);
  await put(target.pathname, body, { ...constraints, multipart: true });
  return { path: target.path, fullPath: target.pathname, id: target.pathname };
}

export async function readPrivateFile(context: FileAccessContext, bucket: string, path: string) {
  const target = await authorizeFile(context, bucket, path, "read");
  const result = await get(target.pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new FileAccessError("File tidak ditemukan.", 404);
  return { ...result, bucket: target.bucket, path: target.path };
}

export async function signedPrivateFile(context: FileAccessContext, bucket: string, path: string, expiresIn: number) {
  const target = await authorizeFile(context, bucket, path, "read");
  const validUntil = Date.now() + signedUrlLifetime(expiresIn) * 1000;
  const token = await issueSignedToken({ pathname: target.pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(token, { operation: "get", pathname: target.pathname, access: "private", validUntil, useCache: false });
  return { signedUrl: presignedUrl };
}

export async function removePrivateFiles(context: FileAccessContext, bucket: string, paths: string[]) {
  if (!Array.isArray(paths) || paths.length > 100) throw new FileAccessError("Daftar file tidak valid.");
  const targets = await Promise.all(paths.map(path => authorizeFile(context, bucket, path, "write")));
  if (targets.length) await del(targets.map(target => target.pathname));
  return targets.map(target => ({ name: target.path }));
}

export async function copyPrivateFile(context: FileAccessContext, bucket: string, fromPath: string, toPath: string) {
  const target = await authorizeFile(context, bucket, toPath, "write");
  const source = await authorizeFile(context, bucket, fromPath, "read");
  await copyBlob(source.pathname, target.pathname, { access: "private", addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 });
  return { path: target.path };
}

export async function listPrivateFiles(context: FileAccessContext, bucket: string, prefix = "", options: { limit?: number; offset?: number; search?: string } = {}) {
  const name = fileBucket(bucket);
  const folder = prefix ? prefix.replace(/\/$/, "") : context.userId;
  // Lists always end on a directory boundary and remain inside the caller's folder.
  const parsed = filePath(folder + "/.listing");
  await authorizeFile(context, name, parsed.path, "write");
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 1000 ||
      (options.search !== undefined && (typeof options.search !== "string" || options.search.length > 200))) {
    throw new FileAccessError("Pilihan daftar file tidak valid.");
  }
  const physicalPrefix = name + "/" + folder + "/";
  const result = await listBlobs({ prefix: physicalPrefix, limit: Math.min(1000, offset + limit) });
  return result.blobs.filter(blob => blob.pathname.startsWith(physicalPrefix))
    .map(blob => ({ name: blob.pathname.slice(physicalPrefix.length), id: blob.pathname, created_at: blob.uploadedAt.toISOString(), updated_at: blob.uploadedAt.toISOString(), last_accessed_at: null, metadata: { size: blob.size } }))
    .filter(blob => !options.search || blob.name.includes(options.search)).slice(offset, offset + limit);
}
