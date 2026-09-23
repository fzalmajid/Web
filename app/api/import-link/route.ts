import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function isPrivateHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "169.254.169.254"
  ) return true;

  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16)));
}

function htmlToText(html: string) {
  const withoutNoise = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ");
  return decodeHtml(
    withoutNoise
      .replace(/<\/(p|div|section|article|main|header|footer|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fallbackTitle(url: URL) {
  return url.hostname + (url.pathname === "/" ? "" : url.pathname).slice(0, 150);
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });

    const body = await req.json();
    const nodeId = String(body.nodeId || "").trim();
    const input = String(body.url || "").trim();
    if (!nodeId || !input) return NextResponse.json({ error: "Database dan link wajib diisi." }, { status: 400 });

    let url: URL;
    try { url = new URL(input); } catch { return NextResponse.json({ error: "Link tidak valid." }, { status: 400 }); }
    if (!["http:", "https:"].includes(url.protocol) || isPrivateHost(url.hostname)) {
      return NextResponse.json({ error: "Link ini tidak diizinkan." }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response: Response | null = null;
    let importNote = "";
    try {
      response = await fetch(url.toString(), {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; RuangBelajar/1.0; +https://web-fzalmajid.vercel.app)",
          Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*",
        },
        cache: "no-store",
      });
    } catch (error: any) {
      importNote = error?.name === "AbortError"
        ? "Server sumber terlalu lama merespons. URL disimpan sebagai referensi dan akan dicoba lagi saat dipakai AI."
        : "Server sumber belum dapat dibaca saat ini. URL disimpan sebagai referensi dan akan dicoba lagi saat dipakai AI.";
    } finally {
      clearTimeout(timer);
    }

    let title = fallbackTitle(url);
    let rawText = "SOURCE URL: " + url.toString();
    let mimeType = "text/html";

    if (response && response.ok) {
      const type = String(response.headers.get("content-type") || "").toLowerCase();
      mimeType = type.split(";")[0] || mimeType;
      if (type.includes("text/html") || type.includes("text/plain") || type.includes("application/json")) {
        const rawBody = (await response.text()).slice(0, 2_000_000);
        const extracted = type.includes("text/html") ? htmlToText(rawBody) : rawBody.trim();
        const titleMatch = rawBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const pageTitle = titleMatch ? htmlToText(titleMatch[1]).slice(0, 180) : "";
        if (pageTitle) title = pageTitle;
        if (extracted) rawText = (rawText + "\n\n" + extracted).slice(0, 120000);
        else importNote = "Halaman tidak mengandung teks yang dapat diekstrak. URL tetap disimpan sebagai referensi.";
      } else {
        importNote = "Link mengarah ke file atau format yang belum dapat diekstrak langsung. URL tetap disimpan sebagai referensi.";
      }
    } else if (response) {
      importNote = "Server sumber mengembalikan HTTP " + response.status + ". URL tetap disimpan sebagai referensi dan akan dicoba lagi saat dipakai AI.";
    }

    if (importNote) rawText += "\n\nCATATAN IMPOR: " + importNote;
    const { data: source, error: sourceError } = await supabase
      .from("source_files")
      .insert({
        user_id: userData.user.id,
        node_id: nodeId,
        file_path: url.toString(),
        file_name: title,
        mime_type: mimeType,
        size_bytes: new TextEncoder().encode(rawText).length,
        processing_status: "ready",
        raw_text: rawText,
        structured_text: null,
        corrections: [],
        error_message: importNote || null,
        source_kind: "link",
        source_url: url.toString(),
      })
      .select("id")
      .single();

    if (sourceError) throw sourceError;

    const { data: entry, error } = await supabase
      .from("knowledge_entries")
      .insert({
        user_id: userData.user.id,
        node_id: nodeId,
        title,
        category: "Link RAW",
        content: rawText,
        raw_content: rawText,
        source_type: "file",
        source_file_id: source.id,
      })
      .select("id")
      .single();

    if (error) {
      await supabase.from("source_files").delete().eq("id", source.id);
      throw error;
    }

    return NextResponse.json({
      id: entry.id,
      sourceFileId: source.id,
      title,
      url: url.toString(),
      rawText,
      warning: importNote || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.name === "AbortError" ? "Link terlalu lama merespons." : error?.message || "Gagal membaca link." }, { status: 500 });
  }
}

