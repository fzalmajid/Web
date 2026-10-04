/** Password protection is distinct from an empty-password permissions lock. */
export function isPdfPasswordError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { name?: string }).name === "PasswordException";
}

export function pdfPasswordError() {
  return Object.assign(new Error(
    "PDF ini memerlukan kata sandi untuk dibuka. Buka dengan kata sandi yang sah, lalu ekspor salinan tanpa kata sandi dan upload salinan tersebut. File asli tetap tersimpan; isi belum dibaca."
  ), { code: "PDF_PASSWORD_REQUIRED", statusCode: 422 });
}

export function isPdfLibEncryptionError(error: unknown): boolean {
  return error instanceof Error && /Input document to `PDFDocument\.load` is encrypted/.test(error.message);
}
