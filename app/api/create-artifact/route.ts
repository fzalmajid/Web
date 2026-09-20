import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import {
  artifactTitleFromQuestion,
  generateArtifact,
  type ArtifactFormat,
} from "@/lib/artifacts";

export const runtime = "nodejs";
export const maxDuration = 60;

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function validFormat(value: unknown): value is ArtifactFormat {
  return (
    value === "docx" ||
    value === "pdf" ||
    value === "pptx" ||
    value === "txt" ||
    value === "md" ||
    value === "csv" ||
    value === "json"
  );
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const body = await req.json();
    const format = String(body.format || "").toLowerCase();
    const question = String(body.question || "").trim();
    const content = String(body.content || "").trim().slice(0, 180000);
    const requestedTitle = String(body.title || "").trim();

    if (!validFormat(format)) {
      return NextResponse.json({ error: "Format file belum didukung." }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ error: "Isi file masih kosong." }, { status: 400 });
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const title =
      requestedTitle ||
      artifactTitleFromQuestion(question) ||
      "Dokumen AI";

    const artifact = await generateArtifact(format, title, content);
    if (artifact.buffer.byteLength > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File hasil terlalu besar. Ringkas isi lalu coba lagi." },
        { status: 413 }
      );
    }

    const safeName = artifact.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const path =
      userData.user.id +
      "/ai-artifacts/" +
      Date.now() +
      "-" +
      crypto.randomUUID() +
      "-" +
      safeName;

    const { error: uploadError } = await supabase.storage
      .from("study-files")
      .upload(path, artifact.buffer, {
        contentType: artifact.mimeType,
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { data: signed, error: signedError } = await supabase.storage
      .from("study-files")
      .createSignedUrl(path, 60 * 60 * 24);

    if (signedError || !signed?.signedUrl) {
      throw signedError || new Error("Link file belum dapat dibuat.");
    }

    return NextResponse.json({
      artifact: {
        format: artifact.extension,
        fileName: artifact.fileName,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.buffer.byteLength,
        url: signed.signedUrl,
        storagePath: path,
        expiresIn: 86400,
      },
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    console.error("[API_CREATE_ARTIFACT_ERROR]", {
      name: error?.name,
      code: error?.code,
      status,
    });
    return NextResponse.json(
      { error: error?.message || "Gagal membuat file." },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}
