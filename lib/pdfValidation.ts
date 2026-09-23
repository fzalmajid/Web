/** Validate a file's actual PDF signature, not its extension or browser MIME type. */
function looksLikePdf(bytes: Uint8Array) {
  const limit = Math.min(bytes.length, 1024);
  for (let i = 0; i + 5 <= limit; i++) {
    if (
      bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d
    ) return true;
  }
  return false;
}

export function assertPdfHeader(bytes: Uint8Array, name = "Dokumen PDF") {
  if (looksLikePdf(bytes)) return;
  const first = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 400)))
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  if (first.startsWith("<!doctype html") || first.startsWith("<html") || first.startsWith("<?xml")) {
    throw new Error(
      name + ": isi file ternyata halaman HTML/XML, bukan PDF. " +
      "Unduh PDF asli dari sumbernya; jangan menyimpan halaman login atau halaman web dengan ekstensi .pdf."
    );
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    throw new Error(name + ": isi file berupa ZIP/Office, bukan PDF. Unggah dengan format file aslinya.");
  }
  if (
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
  ) {
    throw new Error(name + ": file ini sebenarnya gambar. Unggah sebagai JPG/PNG atau konversi menjadi PDF dahulu.");
  }
  throw new Error(
    name + ": header %PDF- tidak ditemukan. File mungkin rusak, terpotong, " +
    "atau bukan PDF meskipun namanya berakhiran .pdf. Unduh ulang PDF asli lalu coba lagi."
  );
}

export async function assertPdfFile(file: File) {
  if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) return;
  if (file.size < 8) throw new Error(file.name + ": file PDF kosong atau tidak lengkap.");
  const prefix = new Uint8Array(await file.slice(0, 2048).arrayBuffer());
  assertPdfHeader(prefix, file.name);
}
