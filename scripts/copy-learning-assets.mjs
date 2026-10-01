import { mkdir, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
const root = process.cwd(), target = join(root, "public", "learning-assets");
await mkdir(target, { recursive: true });
for (const file of ["duckdb-mvp.wasm", "duckdb-eh.wasm", "duckdb-browser-mvp.worker.js", "duckdb-browser-eh.worker.js"]) {
  await copyFile(join(root, "node_modules/@duckdb/duckdb-wasm/dist", file), join(target, file));
}
await copyFile(join(root, "node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm"), join(target, "RDKit_minimal.wasm"));
await copyFile(join(root, "node_modules/@rdkit/rdkit/dist/RDKit_minimal.js"), join(target, "RDKit_minimal.js"));
await copyFile(join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"), join(target, "pdf.worker.min.mjs"));
const foliateTarget=join(target,"foliate");
if(foliateTarget!==join(root,"public","learning-assets","foliate"))throw new Error("Invalid asset output directory");
await rm(foliateTarget,{recursive:true,force:true});
await mkdir(join(foliateTarget,"vendor"),{recursive:true});
for (const file of ["epub.js","epubcfi.js","LICENSE","vendor/zip.js"]) {
  await copyFile(join(root,"node_modules/foliate-js",file),join(target,"foliate",file));
}
await copyFile(join(root,"node_modules/pdfjs-dist/LICENSE"),join(target,"PDFjs-LICENSE.txt"));
await copyFile(join(root,"node_modules/3dmol/LICENSE"),join(target,"3Dmol-LICENSE.txt"));
