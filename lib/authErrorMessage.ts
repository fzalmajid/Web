/** Translate the provider restriction observed on this project; keep other errors intact. */
export function authErrorMessage(message: string): string {
  if (/exceed_cached_egress_quota|service for this project is restricted/i.test(message)) {
    return "Layanan akun Ruang Belajar sedang dibatasi oleh penyedia. Pengelola perlu memulihkan layanan agar kamu bisa masuk atau membuat akun.";
  }
  return message;
}
