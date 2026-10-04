import { createIsomorphicCanvasFactory, getDocumentProxy, renderPageAsImage } from "unpdf";
import { isPdfPasswordError, pdfPasswordError } from "./pdfAccess";

/** Render using PDF.js's real encryption support, never copy encrypted streams. */
export async function openPdfRaster(buffer: Uint8Array) {
  const canvasImport = () => import("@napi-rs/canvas");
  const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport);
  try {
    return await getDocumentProxy(new Uint8Array(buffer), {
      CanvasFactory, useSystemFonts: true, disableFontFace: true,
      stopAtErrors: false, maxImageSize: 16_777_216,
    });
  } catch (error) {
    if (isPdfPasswordError(error)) throw pdfPasswordError();
    throw error;
  }
}

export async function rasterizePdfPage(doc: Awaited<ReturnType<typeof openPdfRaster>>, pageNumber: number) {
  const page = await doc.getPage(pageNumber);
  try {
    const viewport = page.getViewport({ scale: 1 });
    if (!(viewport.width > 0 && viewport.height > 0)) throw new Error("Ukuran halaman PDF tidak valid.");
    // Bound both sides and area, including abnormal/tall document pages.
    const scale = Math.min(2, 2000 / Math.max(viewport.width, viewport.height),
      Math.sqrt(4_000_000 / (viewport.width * viewport.height)));
    const image = await renderPageAsImage(doc, pageNumber, {
      scale, canvasImport: () => import("@napi-rs/canvas"),
    });
    return new Uint8Array(image);
  } finally { page.cleanup(); }
}
