import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import {
  STORAGE_OBJECT_LIMIT, MAX_LARGE_PDF_BYTES, PDF_STORAGE_PART_BYTES,
  LARGE_PDF_MANIFEST_KIND, checkLargePdf, isLargePdf,
  parseLargePdfManifest, pdfOcrParts, type LargePdfManifest, type PdfOcrPart,
} from "./largePdf";

export function isChunkedPdfPath(path: string) {
  return path.endsWith(".rbmanifest.json");
}

export async function getChunkedPdfManifest(path: string) {
  const { data, error } = await supabase.storage.from("study-files").download(path);
  if (error || !data) throw error || new Error("Manifest PDF besar tidak ditemukan.");
  const manifest = parseLargePdfManifest(JSON.parse(await data.text()));
  const base = path.replace(/\.rbmanifest\.json$/, "");
  if (!manifest || !manifest.parts.every((part, i) =>
    part.path === base + ".rbpart-" + String(i + 1).padStart(3, "0")
  )) throw new Error("Manifest PDF besar rusak atau bagian file tidak valid.");
  return manifest;
}

/** Reconstruct original PDF bytes in the user's browser, not on Vercel. */
export async function downloadChunkedPdf(path: string) {
  const manifest = await getChunkedPdfManifest(path);
  const blobs: Blob[] = [];
  for (const part of manifest.parts) {
    const { data, error } = await supabase.storage.from("study-files").download(part.path);
    if (error || !data || data.size !== part.bytes) {
      throw error || new Error("Salah satu bagian PDF asli tidak lengkap.");
    }
    blobs.push(data);
  }
  return new Blob(blobs, { type: "application/pdf" });
}

export async function removeStoredStudyFile(path: string) {
  if (isChunkedPdfPath(path)) {
    const manifest = await getChunkedPdfManifest(path);
    const { error } = await supabase.storage.from("study-files").remove([
      ...manifest.parts.map((part) => part.path), path,
    ]);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.storage.from("study-files").remove([path]);
  if (error) throw error;
}

export async function copyChunkedPdf(path: string, targetNodeId: string, userId: string) {
  const manifest = await getChunkedPdfManifest(path);
  const nextBase = userId + "/" + targetNodeId + "/" + crypto.randomUUID() + "-copy";
  const nextManifestPath = nextBase + ".rbmanifest.json";
  const nextParts: LargePdfManifest["parts"] = [];
  const written: string[] = [];
  try {
    for (let i = 0; i < manifest.parts.length; i++) {
      const nextPath = nextBase + ".rbpart-" + String(i + 1).padStart(3, "0");
      const { error } = await supabase.storage.from("study-files").copy(
        manifest.parts[i].path, nextPath
      );
      if (error) throw error;
      written.push(nextPath);
      nextParts.push({ path: nextPath, bytes: manifest.parts[i].bytes });
    }
    const nextManifest: LargePdfManifest = { ...manifest, parts: nextParts };
    const { error } = await supabase.storage.from("study-files").upload(
      nextManifestPath,
      new Blob([JSON.stringify(nextManifest)], { type: "application/json" }),
      { contentType: "application/json" }
    );
    if (error) throw error;
    written.push(nextManifestPath);
    return nextManifestPath;
  } catch (error) {
    if (written.length) await supabase.storage.from("study-files").remove(written);
    throw error;
  }
}

export type LargePdfSourceRow = {
  id: string;
  user_id: string;
  node_id: string;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  raw_text: string | null;
  processing_status: string;
};

async function uploadOriginal(
  user: User, nodeId: string, file: File,
  onStatus?: (value: string) => void
): Promise<LargePdfSourceRow> {
  checkLargePdf(file);
  if (!isLargePdf(file)) throw new Error("Jalur PDF besar hanya untuk PDF di atas 50 MB.");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const base = user.id + "/" + nodeId + "/" + crypto.randomUUID() + "-" + safeName;
  const manifestPath = base + ".rbmanifest.json";
  const parts: LargePdfManifest["parts"] = [];
  const written: string[] = [];
  try {
    for (let offset = 0, n = 1; offset < file.size; offset += PDF_STORAGE_PART_BYTES, n++) {
      const end = Math.min(file.size, offset + PDF_STORAGE_PART_BYTES);
      const path = base + ".rbpart-" + String(n).padStart(3, "0");
      onStatus?.("Menyimpan PDF asli · bagian " + n + " · " +
        Math.round(end / file.size * 100) + "%...");
      const { error } = await supabase.storage.from("study-files").upload(
        path, file.slice(offset, end, "application/pdf"), { contentType: "application/pdf" }
      );
      if (error) throw error;
      written.push(path);
      parts.push({ path, bytes: end - offset });
    }
    const manifest: LargePdfManifest = {
      kind: LARGE_PDF_MANIFEST_KIND,
      name: file.name,
      mimeType: "application/pdf",
      totalBytes: file.size,
      parts,
    };
    const { error: manifestError } = await supabase.storage.from("study-files").upload(
      manifestPath,
      new Blob([JSON.stringify(manifest)], { type: "application/json" }),
      { contentType: "application/json" }
    );
    if (manifestError) throw manifestError;
    written.push(manifestPath);
    const { data, error } = await supabase.from("source_files").insert({
      user_id: user.id,
      node_id: nodeId,
      file_path: manifestPath,
      file_name: file.name,
      mime_type: "application/pdf",
      size_bytes: file.size,
      processing_status: "processing",
      raw_text: null,
      structured_text: null,
      corrections: [],
      error_message: null,
      source_kind: "file",
      source_url: null,
    }).select("*").single();
    if (error || !data) throw error || new Error("Gagal mendaftarkan PDF besar.");
    return data as LargePdfSourceRow;
  } catch (error) {
    if (written.length) await supabase.storage.from("study-files").remove(written);
    throw error;
  }
}

/** Store the exact original as 40 MB pieces, OCR short independent PDF page-ranges. */
export async function saveLargePdfToFolder(
  user: User,
  nodeId: string,
  file: File,
  onOcrPart: (row: LargePdfSourceRow, path: string, part: PdfOcrPart) => Promise<void>,
  onStatus?: (value: string) => void,
  onUploaded?: () => void
): Promise<LargePdfSourceRow> {
  if (file.size <= STORAGE_OBJECT_LIMIT) throw new Error("PDF ini bisa diunggah biasa.");
  if (file.size > MAX_LARGE_PDF_BYTES) {
    throw new Error("PDF maksimal 200 MB untuk upload otomatis di Supabase Free.");
  }
  const row = await uploadOriginal(user, nodeId, file, onStatus);
  onUploaded?.();
  try {
    for await (const part of pdfOcrParts(file, onStatus)) {
      const path = row.file_path + ".ocrpart-" + part.startPage + "-" + part.endPage + ".pdf";
      const copy = new Uint8Array(part.bytes.length);
      copy.set(part.bytes);
      onStatus?.("Mengunggah halaman " + part.startPage + "–" + part.endPage + " untuk OCR...");
      const { error } = await supabase.storage.from("study-files").upload(
        path, new Blob([copy.buffer], { type: "application/pdf" }),
        { contentType: "application/pdf" }
      );
      if (error) throw error;
      try {
        await onOcrPart(row, path, part);
      } finally {
        await supabase.storage.from("study-files").remove([path]);
      }
    }
    const { error } = await supabase.from("source_files")
      .update({ processing_status: "ready", error_message: null })
      .eq("id", row.id);
    if (error) throw error;
    onStatus?.("PDF asli utuh dan seluruh halaman selesai dibaca.");
    return { ...row, processing_status: "ready" };
  } catch (error: any) {
    await supabase.from("source_files").update({
      processing_status: "error",
      error_message: String(error?.message || "Gagal membaca PDF besar.").slice(0, 600),
    }).eq("id", row.id);
    throw error;
  }
}
