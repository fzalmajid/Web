"use client";
import { useEffect, useRef, useState } from "react";
import { transcribeBrowserAudio } from "@/lib/localWhisper";
import { validateLocalAudio } from "@/lib/audioPolicy";
import type { TranscriptSegment } from "@/lib/audioTimeline";

export default function AudioTranscriber({onUseTranscript}:{onUseTranscript?:(text:string)=>void} = {}) {
  const [file, setFile] = useState<File | null>(null), [url, setUrl] = useState("");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [text, setText] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const audio = useRef<HTMLAudioElement>(null), controller = useRef<AbortController | null>(null), run = useRef(0);
  useEffect(() => () => { run.current++; controller.current?.abort(); }, []);
  useEffect(() => { if (!file) { setUrl(""); return; } const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  function stop() { run.current++; controller.current?.abort(); controller.current = null; setBusy(false); }
  async function transcribe() {
    if (!file || busy) return;
    const id = ++run.current, active = new AbortController();
    controller.current = active; setBusy(true); setText(""); setSegments([]); setMessage("Menyiapkan audio lokal...");
    try {
      const result = await transcribeBrowserAudio(file, { signal: active.signal, onProgress: value => { if (run.current === id) setMessage(value); } });
      if (run.current !== id) return;
      setText(result.text); setSegments(result.chunks);
      setMessage(result.noSpeech ? "Tidak ada ucapan terdeteksi. Audio hening tidak dikirim ke AI atau cloud." : `Selesai · ${result.device === "webgpu" ? "akselerasi grafis" : "mode perangkat ringan"} · ${result.usedVad ? "pemisahan ucapan aktif" : "audio utuh, pemisahan ucapan belum tersedia"}. Periksa kembali nama, istilah, dan angka dengan audio asli.`);
    } catch (error) {
      if (run.current !== id) return;
      setMessage(error instanceof Error && error.name === "AbortError" ? "Pemrosesan dibatalkan." : "Transkripsi lokal belum berhasil. Periksa format file, koneksi unduhan awal, dan kapasitas perangkat. Audio tidak dikirim ke cloud; coba potongan yang lebih pendek.");
    } finally { if (run.current === id) { controller.current = null; setBusy(false); } }
  }
  return <section className="learningPanel localAudioPanel" aria-busy={busy}>
    <h2>Audio & transkrip lokal</h2>
    <p>Untuk rekaman kuliah atau pertemuan yang sudah berupa file. Audio diproses di browser, tidak diunggah atau otomatis dimasukkan ke Database/RAG. Bahasa transkripsi: Indonesia. Unduhan model awal bisa mencapai ratusan MB; bobot model di-cache browser, bukan audio Anda.</p>
    <label>Pilih file audio (maksimal 40 MB / 20 menit)<input type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm" onChange={event => {
      stop(); setText(""); setSegments([]); setFile(null); setMessage("");
      const next = event.target.files?.[0];
      if (!next) return;
      try { validateLocalAudio(next.size); if (!next.type.startsWith("audio/") && !/\.(wav|mp3|m4a|aac|ogg|oga|flac|webm|mp4)$/i.test(next.name)) throw new Error("Pilih file audio yang didukung browser."); setFile(next); setMessage("Audio siap. Tekan Transkripsi lokal untuk mulai; tidak ada model yang diunduh sebelum Anda memulai."); }
      catch (error) { setMessage(error instanceof Error ? error.message : "File audio tidak valid."); event.target.value = ""; }
    }}/></label>
    {url && <audio ref={audio} src={url} controls preload="metadata" aria-label="Audio asli untuk memeriksa transkrip"/>}
    <div className="learningRow"><button disabled={!file || busy} onClick={transcribe}>Transkripsi lokal</button><button disabled={!busy} onClick={() => { stop(); setMessage("Pemrosesan dibatalkan. Audio tetap di perangkat; tidak ada fallback cloud."); }}>Batalkan</button></div>
    <p role="status" aria-live="polite">{message}</p>
    {text && <><label>Transkrip otomatis — periksa dengan audio asli<textarea readOnly rows={8} value={text}/></label><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setMessage("Transkrip disalin sebagai teks biasa."); } catch { setMessage("Clipboard tidak tersedia. Pilih dan salin teks di kotak transkrip."); } }}>Salin teks transkrip</button>{onUseTranscript&&<button type="button" onClick={()=>onUseTranscript(text)}>Tinjau & simpan transkrip ke folder</button>}</>}
    {segments.length > 0 && <details><summary>Timestamp ucapan pada audio asli</summary>{segments.map((segment, index) => <p key={index}><button onClick={() => { if (audio.current) audio.current.currentTime = segment.timestamp[0]; }}>{Math.floor(segment.timestamp[0] / 60)}:{String(Math.floor(segment.timestamp[0] % 60)).padStart(2, "0")}</button> {segment.text}</p>)}</details>}
    <p>File tidak disimpan oleh modul ini. Navigasi keluar menghentikan pekerjaan yang berjalan. Mikrofon tidak digunakan; noise suppression WebRTC hanya berlaku ketika merekam langsung di Record.</p>
  </section>;
}
