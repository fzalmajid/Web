"use client";
import { useEffect, useRef, useState } from "react";
import { learningStore } from "@/lib/learningStore";
import type { TranscriptSegment } from "@/lib/audioTimeline";
import { supabase } from "@/lib/supabase";
export default function AudioTimeline({ url, account: _owner, recording, segments = [], duration = 0 }: { url: string; account: string; recording: string; segments?: TranscriptSegment[]; duration?: number }) {
  const[account,setAccount]=useState("");
  useEffect(()=>{let active=true;void supabase.auth.getSession().then(({data})=>{if(active)setAccount(data.session?.user.id||"");});const{data}=supabase.auth.onAuthStateChange((_event,session)=>{setAccount(session?.user.id||"");setMarks([]);});return()=>{active=false;data.subscription.unsubscribe();};},[]);
  const audio = useRef<HTMLAudioElement>(null), wave = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState(""), [marks, setMarks] = useState<any[]>([]);
  useEffect(() => {
    let active = true, waveform: any;
    setMarks([]);if(account)void learningStore.bookmarks.where("[account+recording]").equals([account, recording]).toArray().then(rows => { if (active) setMarks(rows); }).catch(() => undefined);
    if (account && duration > 0 && duration <= 1200) void import("wavesurfer.js").then(({ default: WaveSurfer }) => {
      if (!active || !wave.current || !audio.current) return;
      waveform = WaveSurfer.create({ container: wave.current, media: audio.current, waveColor: "#9cbbb0", progressColor: "#426854", height: 70, normalize: true });
      waveform.on("error", () => { if (active) setMessage("Waveform tidak tersedia; pemutar audio tetap aktif."); });
    }).catch(() => { if (active) setMessage("Pemutar standar digunakan."); });
    return () => { active = false; waveform?.destroy(); };
  }, [url, account, recording, duration]);
  function seek(seconds: number) { if (audio.current) { audio.current.currentTime = seconds; void audio.current.play().catch(() => undefined); } }
  if(!account)return <p>Login diperlukan untuk membuka audio dan bookmark pribadi.</p>;
  return <section className="learningPanel" onClick={e => e.stopPropagation()}><audio ref={audio} src={url} controls preload="metadata" /><div ref={wave} />
    {duration > 1200 && <p>Rekaman panjang memakai pemutar standar agar decoding waveform tidak membebani memori.</p>}
    <button onClick={async () => { if (!audio.current) return; const title = prompt("Nama bookmark", "Bagian penting"); if (!title) return; const row = { key: crypto.randomUUID(), account, recording, seconds: audio.current.currentTime, title: title.slice(0, 160) }; try { await learningStore.bookmarks.put(row); setMarks(items => [...items, row]); } catch { setMessage("Penyimpanan lokal tidak tersedia."); } }}>Bookmark waktu ini</button>
    <p>{message} Bookmark disimpan di perangkat ini.</p><div className="learningRow">{marks.map(mark => <span key={mark.key}><button onClick={() => seek(mark.seconds)}>{Math.floor(mark.seconds / 60)}:{String(Math.floor(mark.seconds % 60)).padStart(2, "0")} {mark.title}</button><button aria-label={"Hapus bookmark " + mark.title} onClick={async () => { await learningStore.bookmarks.delete(mark.key); setMarks(items => items.filter(item => item.key !== mark.key)); }}>×</button></span>)}</div>
    {segments.length > 0 ? <details><summary>Transkrip bertimestamp (otomatis; periksa audio asli)</summary>{segments.map((segment, i) => <p key={i}><button onClick={() => seek(segment.timestamp[0])}>{Math.floor(segment.timestamp[0])}s</button> {segment.text}</p>)}</details> : <p>Timestamp belum tersedia untuk rekaman ini. Bookmark dapat dipakai tanpa mengubah transkrip.</p>}
  </section>;
}
