"use client";
import { useState } from "react";
import { prepareLocalQwen, unloadLocalQwen } from "@/lib/localQwen";
import { buildLocalHelperHints } from "@/lib/localAiHelper";
export default function LocalHelper(){
  const[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[query,setQuery]=useState("Carikan referensi kurva kalibrasi spektrofotometri"),[result,setResult]=useState("");
  return <section className="learningPanel"><h2>Helper AI lokal</h2><p>Opsional. Memuat Qwen kecil melalui WebLLM/WebGPU untuk rewrite, klasifikasi dan kritik awal. Unduhan awal dapat mencapai ratusan MB; pertanyaan diproses di browser, bukan API berbayar. Perangkat lemah tetap memakai heuristik ringan.</p>
    <div className="learningRow"><button disabled={busy} onClick={async()=>{setBusy(true);try{await prepareLocalQwen(setMessage);localStorage.setItem("rb-local-qwen-enabled","1");setMessage("Helper lokal siap. Medium/High akan memakainya sebagai petunjuk, bukan sumber fakta.");}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}}>Aktifkan helper lokal</button>
    <button onClick={async()=>{localStorage.removeItem("rb-local-qwen-enabled");await unloadLocalQwen();setBusy(false);setMessage("Helper model dihentikan. Heuristik lokal tetap aktif; cache bobot bukan data pribadi.");}}>Hentikan / nonaktifkan model lokal</button></div>
    <p role="status">{message}</p><label>Kueri percobaan<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button disabled={busy} onClick={async()=>{setBusy(true);try{setResult(JSON.stringify(await buildLocalHelperHints(query),null,2));}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}}>Uji helper</button><pre>{result}</pre></section>;
}
