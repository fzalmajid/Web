import { getNeonAuthServer } from "./neonAuthServer";
import { FileAccessError } from "./appStorageShared";
import { requirePrivateFilesBackend, verifiedFileContext } from "./privateFileService";

export const PRIVATE_FILE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function requestFileContext(request: Request) {
  requirePrivateFilesBackend();
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    if (!match) throw new FileAccessError("Login diperlukan untuk membuka file.", 401);
    return verifiedFileContext(match[1]);
  }
  // Bearer clients are already explicit. Cookie mutations must come from this app.
  if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) {
    throw new FileAccessError("Permintaan file tidak diizinkan.", 403);
  }
  try {
    const result = await getNeonAuthServer().token();
    if (result.error || !result.data?.token) throw new Error();
    return await verifiedFileContext(result.data.token);
  } catch { throw new FileAccessError("Login diperlukan untuk membuka file.", 401); }
}

export function fileRouteError(error: unknown) {
  return Response.json({ error: error instanceof FileAccessError ? error.message : "File belum dapat diproses. Coba lagi sebentar." }, {
    status: error instanceof FileAccessError ? error.status : 503, headers: PRIVATE_FILE_HEADERS,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Upload authorization/operation requests never need file bytes in their JSON. */
export async function readFileJson(request: Request): Promise<Record<string, unknown>> {
  const limit = 16 * 1024;
  const reader = request.body?.getReader();
  if (!reader) throw new FileAccessError("Permintaan file tidak valid.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new FileAccessError("Permintaan file terlalu besar.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(body)) throw new Error();
    return body;
  } catch { throw new FileAccessError("Permintaan file tidak valid."); }
}
