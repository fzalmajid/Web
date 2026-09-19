import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const prefix = String(body?.prefix || "").trim().toUpperCase();

    if (!/^[A-F0-9]{5}$/.test(prefix)) {
      return NextResponse.json({ error: "Prefix hash tidak valid." }, { status: 400 });
    }

    const response = await fetch("https://api.pwnedpasswords.com/range/" + prefix, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": "RuangBelajar-Password-Protection",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Pemeriksaan password bocor sedang tidak tersedia." },
        { status: 503 }
      );
    }

    const text = await response.text();
    const suffixes = text
      .split(/\r?\n/)
      .map((line) => {
        const [suffix, count] = line.split(":");
        return {
          suffix: String(suffix || "").trim().toUpperCase(),
          count: Number(count || 0),
        };
      })
      .filter((item) => /^[A-F0-9]{35}$/.test(item.suffix));

    return NextResponse.json({ suffixes });
  } catch {
    return NextResponse.json(
      { error: "Pemeriksaan password bocor sedang tidak tersedia." },
      { status: 503 }
    );
  }
}
