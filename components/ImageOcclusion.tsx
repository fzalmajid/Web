"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
const prefix = "rb:occlusion:v1:";
type Mask = { path: string; x: number; y: number; w: number; h: number };
export function parseOcclusion(front: string): Mask | null {
  if (!front.startsWith(prefix)) return null;
  try { const m = JSON.parse(front.slice(prefix.length)); return typeof m.path === "string" && [m.x,m.y,m.w,m.h].every(v => Number.isFinite(v) && v >= 0 && v <= 1) && m.w > 0 && m.h > 0 && m.x + m.w <= 1.001 && m.y + m.h <= 1.001 ? m : null; } catch { return null; }
}
export function OcclusionCard({ front, reveal }: { front: string; reveal: boolean }) {
  const mask = parseOcclusion(front), [url, setUrl] = useState("");
  useEffect(() => { let active = true; setUrl(""); if (mask) void supabase.storage.from("study-files").createSignedUrl(mask.path, 900).then(({ data }) => { if (active) setUrl(data?.signedUrl || ""); }); return () => { active = false; }; }, [mask?.path]);
  if (!mask) return <span>{front}</span>;
  if (!url) return <span>Gambar memerlukan akses online.</span>;
  return <span className="occlusionImage"><img src={url} alt="Diagram latihan" />{!reveal && <span style={{ position: "absolute", left: mask.x*100+"%", top: mask.y*100+"%", width: mask.w*100+"%", height: mask.h*100+"%", background: "#426854" }} />}</span>;
}
export default function ImageOcclusion({ account, scope, files, onChange }: { account: string; scope: string; files: { user_id: string; file_path: string; file_name: string; mime_type: string }[]; onChange: () => void }) {
  const options = files.filter(f => f.user_id === account && f.mime_type.startsWith("image/"));
  const [path, setPath] = useState(""), [url, setUrl] = useState(""), [answer, setAnswer] = useState(""), [mask, setMask] = useState<Mask|null>(null), [message, setMessage] = useState("");
  const origin = useRef<[number,number]|null>(null);
  useEffect(() => { let active = true; setUrl(""); setMask(null); if (path) void supabase.storage.from("study-files").createSignedUrl(path, 900).then(({ data }) => { if (active) setUrl(data?.signedUrl || ""); }); return () => { active = false; }; }, [path]);
  return <details className="learningPanel"><summary>Kartu gambar — tutup bagian untuk diingat</summary><p>Gambar asli tidak diubah. Kartu memakai jadwal FSRS yang sama.</p><select aria-label="Gambar latihan" value={path} onChange={e => setPath(e.target.value)}><option value="">Pilih gambar dari Database</option>{options.map(f => <option key={f.file_path} value={f.file_path}>{f.file_name}</option>)}</select>
    {url && <div className="occlusionImage" style={{ touchAction: "none" }} onPointerDown={e => { const r=e.currentTarget.getBoundingClientRect(); origin.current=[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={e => { if (!origin.current) return; const r=e.currentTarget.getBoundingClientRect(), [x,y]=origin.current, endX=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),endY=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height)); setMask({path,x:Math.min(x,endX),y:Math.min(y,endY),w:Math.abs(x-endX),h:Math.abs(y-endY)}); origin.current=null; }}><img src={url} alt="Seret untuk menutup satu bagian" draggable={false}/>{mask && <span style={{position:"absolute",left:mask.x*100+"%",top:mask.y*100+"%",width:mask.w*100+"%",height:mask.h*100+"%",background:"#426854aa",pointerEvents:"none"}}/>}</div>}
    <label>Jawaban bagian tertutup<input value={answer} onChange={e=>setAnswer(e.target.value)}/></label><button type="button" disabled={!mask||mask.w<.01||mask.h<.01||!answer.trim()} onClick={async()=>{if(!mask)return; const {error}=await supabase.from("flashcards").insert({user_id:account,scope_node_id:scope,front:prefix+JSON.stringify(mask),back:answer.trim()}); setMessage(error?.message||"Kartu gambar disimpan."); if(!error){setAnswer("");onChange();}}}>Simpan kartu gambar</button><p role="status">{message}</p>
  </details>;
}
