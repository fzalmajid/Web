import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { AVATAR_CONTENT_TYPES, FileAccessError } from "@/lib/appStorageShared";
import { fileRouteError, isRecord, PRIVATE_FILE_HEADERS, readFileJson, requestFileContext } from "@/lib/fileRouteAuth";
import { authorizeFile, uploadConstraints } from "@/lib/privateFileService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requestFileContext(request);
    const body = await readFileJson(request);
    if (body.type !== "blob.generate-client-token" || !isRecord(body.payload) ||
        typeof body.payload.pathname !== "string" || typeof body.payload.multipart !== "boolean" ||
        typeof body.payload.clientPayload !== "string") throw new FileAccessError("Permintaan unggah tidak valid.");
    const result = await handleUpload({
      request, body: body as unknown as HandleUploadBody,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let payload: unknown;
        try { payload = JSON.parse(clientPayload || ""); }
        catch { throw new FileAccessError("Permintaan unggah tidak valid."); }
        if (!isRecord(payload)) throw new FileAccessError("Permintaan unggah tidak valid.");
        const target = await authorizeFile(context, payload.bucket, payload.path, "write");
        if (pathname !== target.pathname) throw new FileAccessError("Alamat unggah tidak valid.");
        const constraints = uploadConstraints(target.bucket, { contentType: payload.contentType as string | undefined, upsert: payload.upsert as boolean | undefined });
        return {
          addRandomSuffix: false, allowOverwrite: constraints.allowOverwrite,
          maximumSizeInBytes: constraints.maximumSizeInBytes, validUntil: Date.now() + 10 * 60 * 1000,
          cacheControlMaxAge: 60,
          ...(target.bucket === "profile-avatars" ? { allowedContentTypes: AVATAR_CONTENT_TYPES } : constraints.contentType ? { allowedContentTypes: [constraints.contentType] } : {}),
        };
      },
    });
    return Response.json(result, { headers: PRIVATE_FILE_HEADERS });
  } catch (error) { return fileRouteError(error); }
}
