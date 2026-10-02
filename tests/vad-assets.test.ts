import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
test("build prepares both ONNX WASM variants requested by the VAD runtime", () => {
  const script = readFileSync(join(process.cwd(), "scripts/copy-vad-assets.mjs"), "utf8");
  const buildAssets = readFileSync(join(process.cwd(), "scripts/copy-learning-assets.mjs"), "utf8");
  assert.match(buildAssets, /import "\.\/copy-vad-assets\.mjs"/);
  for (const file of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
    assert.ok(script.includes(`node_modules/onnxruntime-web/dist/${file}`));
    assert.ok(statSync(join(process.cwd(), "node_modules/onnxruntime-web/dist", file)).size > 0);
  }
});
