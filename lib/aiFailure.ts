/** Public error contract. Never include provider payloads, keys or source text. */
export function aiFailure(error: any, fallback: string) {
  const code = String(error?.code || "");
  const messages: Record<string,string> = {
    GEMINI_QUOTA: "Batas penggunaan Gemini API sedang tercapai. Input tetap tersimpan; coba kembali setelah kuota provider tersedia. Mengubah Simple–High tidak menambah kuota Google.",
    WEB_SEARCH_QUOTA: "Kuota pencarian Web Gemini sedang tercapai. Coba kembali nanti. Web tidak akan diganti diam-diam dengan pengetahuan AI tanpa sumber.",
    GEMINI_AUTH_REJECTED: "Akses Gemini ditolak. Pengelola perlu memeriksa API key, izin API, atau project Google yang terhubung.",
    GEMINI_UNAVAILABLE: "Layanan AI sedang sibuk atau tidak dapat dihubungi. Input tetap tersimpan; coba kembali nanti.",
    GEMINI_MODEL_UNAVAILABLE: "Jalur AI yang dicoba belum dapat digunakan pada project ini. Pengelola perlu memeriksa akses model; bukan kesalahan input Anda.",
    GEMINI_NO_AVAILABLE_MODEL: "Katalog Gemini belum menyediakan model yang dapat dipakai untuk akses ini. Pengelola perlu memeriksa project dan izin model.",
  };
  const delay = Number(error?.retryAfterSeconds);
  const retryAfterSeconds = Number.isFinite(delay) && delay > 0 ? Math.min(86400, Math.ceil(delay)) : undefined;
  const message = messages[code] || String(error?.message || fallback);
  const status = Number(error?.statusCode || 500);
  return {
    body: { error: message + (retryAfterSeconds ? ` Waktu tunggu dari provider: ${retryAfterSeconds} detik.` : ""),
      ...(code ? {code} : {}), ...(retryAfterSeconds ? {retryAfterSeconds} : {}) },
    init: { status: status >= 400 && status < 600 ? status : 500,
      ...(retryAfterSeconds ? {headers:{"Retry-After":String(retryAfterSeconds)}} : {}) },
  };
}
