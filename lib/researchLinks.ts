import { normalizeDoi } from "./referenceMetadata";
export function doiFromUrl(value: string) {
  const match = String(value || "").match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi:)?(10\.\d{4,9}\/[^\s<>"?#]+)/i);
  return match ? normalizeDoi(match[1].replace(/[.,;)]$/, "")) : "";
}
export function publicUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password || /^(localhost$|.*\.localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[|0\.)/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}
