import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {chatImageIntent} from "../lib/chatImageIntent";
test("monograph images identify PubChem separately from FI6",()=>{assert.deepEqual(chatImageIntent("Monografi pct di FI 6 dan gambar"),{kind:"pubchem",query:"paracetamol",requestedDocument:true});assert.equal(chatImageIntent("Berapa dosis pct?"),null);});
test("normal composer has no model picker; settings is explicit opt-in",()=>{const source=readFileSync("app/page.tsx","utf8");const composer=source.slice(source.indexOf("function BottomAskBar"));assert.ok(!composer.includes("showModelDebug\n"));assert.ok(source.includes("Diagnostik AI — untuk pengujian"));});
test("question audio transcribes locally before any storage operation",()=>{const source=readFileSync("app/page.tsx","utf8");const process=source.slice(source.indexOf("async function processAskVoice"),source.indexOf("async function savePendingVoiceToDatabase"));assert.match(process,/transcribeBrowserAudio/);assert.doesNotMatch(process,/storage\.from|\/api\/transcribe/);assert.match(process,/signal:controller.signal/);});
test("offline navigation falls back to public shell without caching private navigation or API data",()=>{const source=readFileSync("app/sw.ts","utf8");assert.match(source,/new NetworkOnly\(\)/);assert.match(source,/url:"\/offline"/);assert.doesNotMatch(source,/\/api\/|NetworkFirst/);const page=readFileSync("app/page.tsx","utf8");assert.doesNotMatch(page,/keys\.map\(\(key\) => caches\.delete/);});
