import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { readPdfNativeBatch, readPdfBatchWithOcr } from "../lib/visualOcr";
import { openPdfRaster, rasterizePdfPage } from "../lib/pdfRasterServer";
import { UPLOAD_MODELS } from "../lib/uploadAi";

// Synthetic Standard Security Handler R2 fixture; no third-party document content.
function encryptedPdf(password = "") {
  const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const pad = (value: string) => Buffer.concat([Buffer.from(value), padding]).subarray(0, 32);
  const md5 = (value: Buffer) => createHash("md5").update(value).digest();
  const rc4 = (key: Buffer, input: Buffer) => {
    const s = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    let i = 0; j = 0;
    return Buffer.from(input.map(byte => {
      i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]];
      return byte ^ s[(s[i] + s[j]) & 255];
    }));
  };
  const id = Buffer.alloc(16, 7), permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const owner = rc4(md5(pad("fixture-owner")).subarray(0, 5), pad(password));
  const key = md5(Buffer.concat([pad(password), owner, permissions, id])).subarray(0, 5);
  const user = rc4(key, padding);
  const contentKey = md5(Buffer.concat([key, Buffer.from([5, 0, 0, 0, 0])])).subarray(0, 10);
  const stream = rc4(contentKey, Buffer.from("BT /F1 18 Tf 30 100 Td (OCR permission PDF) Tj ET"));
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + stream.length + " >>\nstream\n" + stream.toString("latin1") + "\nendstream",
    "<< /Filter /Standard /V 1 /R 2 /O <" + owner.toString("hex") + "> /U <" + user.toString("hex") + "> /P -4 >>",
  ];
  let pdf = "%PDF-1.4\n", offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf, "latin1")); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 7\n0000000000 65535 f \n" + offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("");
  pdf += `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

test("Permissions-encrypted PDF reads and renders without ignoreEncryption or rewriting original", async () => {
  const pdf = encryptedPdf(), before = Buffer.from(pdf);
  await assert.rejects(PDFDocument.load(pdf), /is encrypted/);
  const batch = await readPdfNativeBatch(pdf, 1);
  assert.match(batch.pages[0].text, /OCR permission PDF/);
  const doc = await openPdfRaster(pdf);
  try {
    const png = await rasterizePdfPage(doc, 1);
    assert.equal(Buffer.from(png.subarray(0, 8)).toString("hex"), "89504e470d0a1a0a");
    assert.ok(png.length > 1000);
  } finally { await doc.loadingTask.destroy(); }
  assert.deepEqual(pdf, before);
});

test("Encrypted short-text page reaches upload OCR as a PNG, not encrypted PDF bytes", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      if (!init?.body) return Response.json({ models: UPLOAD_MODELS.map(name => ({ name: "models/" + name, supportedGenerationMethods: ["generateContent"] })) });
      const request = JSON.parse(String(init.body));
      const image = request.contents.flatMap((c: any) => c.parts).find((p: any) => p.inlineData)?.inlineData;
      assert.equal(image.mimeType, "image/png");
      assert.equal(Buffer.from(image.data, "base64").subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      calls++;
      return Response.json({ candidates: [{ content: { parts: [{ text: "OCR permission PDF" }] }, finishReason: "STOP" }] });
    };
    const pages = await readPdfBatchWithOcr(encryptedPdf(), [{ page: 1, text: "" }], {
      auth: { apiKey: "fixture-key" }, deadlineAt: Date.now() + 30000,
    } as any);
    assert.equal(pages[0].text, "OCR permission PDF"); assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test("Password-required PDF gives actionable 422 error without provider calls or encryption bypass", async () => {
  const validate = (error: any) => error.code === "PDF_PASSWORD_REQUIRED" && error.statusCode === 422 && /kata sandi/.test(error.message);
  await assert.rejects(readPdfNativeBatch(encryptedPdf("required-secret"), 1), validate);
  await assert.rejects(openPdfRaster(encryptedPdf("required-secret")), validate);
});
