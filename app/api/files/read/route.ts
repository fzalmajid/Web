import { AVATAR_CONTENT_TYPES, FileAccessError } from "@/lib/appStorageShared";
import { fileRouteError, PRIVATE_FILE_HEADERS, requestFileContext } from "@/lib/fileRouteAuth";
import { readPrivateFile } from "@/lib/privateFileService";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await requestFileContext(request);
    const params = new URL(request.url).searchParams;
    const result = await readPrivateFile(context, params.get("bucket") || "", params.get("path") || "");
    const isAvatar = result.bucket === "profile-avatars";
    if (isAvatar && !AVATAR_CONTENT_TYPES.includes(result.blob.contentType)) throw new FileAccessError("Foto profil tidak valid.", 415);
    const requestedName = params.get("download");
    const filename = requestedName && requestedName !== "1" ? requestedName : result.path.split("/").pop() || "file";
    const disposition = isAvatar && !requestedName ? "inline" : "attachment; filename*=UTF-8''" + encodeURIComponent(filename).replace(/['()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
    return new Response(result.stream, { headers: {
      ...PRIVATE_FILE_HEADERS, "Content-Type": result.blob.contentType, "Content-Length": String(result.blob.size),
      "Content-Disposition": disposition, "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch (error) { return fileRouteError(error); }
}
