import { FileAccessError, fileBucket, storageFailure } from "@/lib/appStorageShared";
import { fileRouteError, isRecord, PRIVATE_FILE_HEADERS, readFileJson, requestFileContext } from "@/lib/fileRouteAuth";
import { copyPrivateFile, listPrivateFiles, removePrivateFiles, signedPrivateFile } from "@/lib/privateFileService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await requestFileContext(request);
    const body = await readFileJson(request);
    const bucket = fileBucket(body.bucket);
    let data: unknown;
    if (body.action === "signed-url") {
      data = await signedPrivateFile(context, bucket, body.path as string, body.expiresIn as number);
    } else if (body.action === "signed-urls") {
      if (!Array.isArray(body.paths) || body.paths.length > 100 || body.paths.some(path => typeof path !== "string")) throw new FileAccessError("Daftar file tidak valid.");
      data = await Promise.all(body.paths.map(async path => {
        try { return { path, ...await signedPrivateFile(context, bucket, path, body.expiresIn as number), error: null }; }
        catch (error) { return { path, signedUrl: "", error: storageFailure(error).message }; }
      }));
    } else if (body.action === "remove") {
      data = await removePrivateFiles(context, bucket, body.paths as string[]);
    } else if (body.action === "copy") {
      data = await copyPrivateFile(context, bucket, body.fromPath as string, body.toPath as string);
    } else if (body.action === "list") {
      if ((body.prefix !== undefined && typeof body.prefix !== "string") || (body.options !== undefined && !isRecord(body.options))) throw new FileAccessError("Pilihan daftar file tidak valid.");
      data = await listPrivateFiles(context, bucket, body.prefix as string | undefined, body.options || {});
    } else { throw new FileAccessError("Tindakan file tidak valid."); }
    return Response.json({ data }, { headers: PRIVATE_FILE_HEADERS });
  } catch (error) { return fileRouteError(error); }
}
