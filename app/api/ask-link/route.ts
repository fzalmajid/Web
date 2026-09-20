import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function isSafePublicUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return false;
    return true;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)));
}

function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const body = await req.json();
    const rawUrl = String(body.url || "").trim();
    if (!isSafePublicUrl(rawUrl)) {
      return NextResponse.json({ error: "Link harus URL http/https publik yang valid." }, { status: 400 });
    }

    const response = await fetch(rawUrl, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": "RuangBelajar/1.0",
        Accept: "text/html,application/xhtml+xml,application/pdf,image/*,text/plain,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Link tidak dapat dibaca (" + response.status + ")." },
        { status: 422 }
      );
    }

    const finalUrl = response.url || rawUrl;
    const contentType = String(response.headers.get("content-type") || "text/html")
      .split(";")[0]
      .trim()
      .toLowerCase();

    let title = "";
    let rawText = "";

    if (
      contentType.includes("html") ||
      contentType.startsWith("text/") ||
      contentType === "application/json" ||
      contentType === "application/xml"
    ) {
      const text = await response.text();
      if (contentType.includes("html")) {
        const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        title = titleMatch ? htmlToText(titleMatch[1]).slice(0, 240) : "";
        rawText = htmlToText(text).slice(0, 70000);
      } else {
        rawText = text.trim().slice(0, 70000);
      }
    }

    if (!title) {
      try {
        const url = new URL(finalUrl);
        title = url.hostname + (url.pathname === "/" ? "" : url.pathname);
      } catch {
        title = "Link";
      }
    }

    return NextResponse.json({
      url: finalUrl,
      title,
      mimeType: contentType,
      rawText,
      directBinary: !rawText,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Gagal membaca link." },
      { status: 500 }
    );
  }
}
