import { test } from "node:test";
import assert from "node:assert/strict";
import { selectWhisperCapability, validateLocalAudio, checkAudioAbort, isDigitalSilence, MAX_LOCAL_AUDIO_BYTES } from "../lib/audioPolicy";
import { decodeBrowserAudio } from "../lib/audioDecode";

test("Small needs a working GPU, eight cores and known sufficient memory", () => {
  assert.equal(selectWhisperCapability({ webgpu: true, hardwareConcurrency: 8, deviceMemory: 8 }).tier, "small");
  assert.equal(selectWhisperCapability({ webgpu: true, hardwareConcurrency: 16 }).tier, "base");
  assert.equal(selectWhisperCapability({ webgpu: true, hardwareConcurrency: 4, deviceMemory: 2 }).tier, "tiny");
  assert.equal(selectWhisperCapability({ webgpu: false, hardwareConcurrency: 16, deviceMemory: 16 }).tier, "tiny");
  assert.equal(selectWhisperCapability({ webgpu: false, hardwareConcurrency: NaN, deviceMemory: Infinity }).hardwareConcurrency, 1);
});
test("local file size and duration are checked before model work", () => {
  assert.throws(() => validateLocalAudio(0), /kosong/);
  assert.throws(() => validateLocalAudio(MAX_LOCAL_AUDIO_BYTES + 1), /40 MB/);
  assert.throws(() => validateLocalAudio(100, 1201), /20 menit/);
  assert.throws(() => validateLocalAudio(100, NaN), /20 menit/);
  assert.doesNotThrow(() => validateLocalAudio(MAX_LOCAL_AUDIO_BYTES, 1200));
});
test("digital silence gate does not discard faint nonzero speech or invalid samples", () => {
  assert.equal(isDigitalSilence(new Float32Array(100)), true);
  assert.equal(isDigitalSilence(new Float32Array([0, 0.00000001])), false);
  assert.equal(isDigitalSilence(new Float32Array([NaN])), false);
  assert.equal(isDigitalSilence(new Float32Array()), false);
});
test("abort is a distinct error and does not become an inference retry", () => {
  const controller = new AbortController(); controller.abort();
  assert.throws(() => checkAudioAbort(controller.signal), { name: "AbortError" });
});
test("resampling uses native filtered rendering and always closes the decoder", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let closed = 0, disconnected = 0, rendered = 0;
  class Context { async decodeAudioData() { return { duration: .001, sampleRate: 48000, numberOfChannels: 1 }; } async close() { closed++; } }
  class Offline {
    destination = {};
    constructor(channels: number, length: number, rate: number) { assert.deepEqual([channels, length, rate], [1, 16, 16000]); }
    createBufferSource() { return { buffer: null, connect: () => {}, start: () => {}, disconnect: () => { disconnected++; } }; }
    async startRendering() { rendered++; return { getChannelData: () => new Float32Array(16).fill(.2) }; }
  }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { AudioContext: Context, OfflineAudioContext: Offline } });
  try { const result = await decodeBrowserAudio(new Blob(["fixture"])); assert.equal(result.sampleRate, 16000); assert.equal(result.samples.length, 16); assert.deepEqual([closed, disconnected, rendered], [1, 1, 1]); }
  finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});
test("decoder cleanup survives an oversized decoded duration", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window"); let closed = false;
  class Context { async decodeAudioData() { return { duration: 1300 }; } async close() { closed = true; } }
  Object.defineProperty(globalThis, "window", { configurable: true, value: { AudioContext: Context } });
  try { await assert.rejects(decodeBrowserAudio(new Blob(["fixture"])), /20 menit/); assert.equal(closed, true); }
  finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});
