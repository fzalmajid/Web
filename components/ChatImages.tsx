"use client";
import {useEffect,useState} from "react";
import {supabase} from "@/lib/supabase";
import {chatImageIntent} from "@/lib/chatImageIntent";
type ChatImage={id:string;title:string;thumbnail:string;source:string;attribution:string;licenseUrl?:string};
export default function ChatImages({question,allowWeb}:{question:string;allowWeb:boolean}){
  const [images,setImages]=useState<ChatImage[]>([]),[message,setMessage]=useState("");
  const intent=chatImageIntent(question);
  const kind=intent?.kind,query=intent?.query;
  useEffect(()=>{
    setImages([]);setMessage("");if(!allowWeb||!kind||!query)return;
    const controller=new AbortController();
    void(async()=>{
      try{
        const session=(await supabase.auth.getSession()).data.session;if(!session)return;
        const response=await fetch(kind==="pubchem"?"/api/molecules?name="+encodeURIComponent(query):"/api/open-media?q="+encodeURIComponent(query),{signal:controller.signal,headers:{Authorization:"Bearer "+session.access_token}});
        const body=await response.json();if(!response.ok)throw new Error("Gambar sumber publik belum tersedia.");
        if(controller.signal.aborted)return;
        setImages(kind==="pubchem"?[{id:String(body.cid),title:`${query} — struktur 2D PubChem (CID ${body.cid})`,thumbnail:body.image2d,source:body.source,attribution:"Struktur dari PubChem; bukan gambar yang diekstrak dari Farmakope."}]:body.images.slice(0,3).filter((row:any)=>row.thumbnail).map((row:any)=>({id:row.id,title:row.title,thumbnail:row.thumbnail,source:row.source,attribution:`${row.creator} · ${row.license} ${row.licenseVersion}`,licenseUrl:row.licenseUrl})));
      }catch{if(!controller.signal.aborted)setMessage("Gambar publik belum tersedia. Jawaban teks dan tautan sumber tetap bisa diperiksa.");}
    })();return()=>controller.abort();
  },[allowWeb,kind,query]);
  if(!allowWeb||!intent)return null;
  return <section className="chatImages" aria-label="Gambar terkait jawaban">{images.length>0&&<><h3>Gambar terkait</h3>{intent.requestedDocument&&<p>Ini struktur pembanding dari PubChem, bukan reproduksi gambar FI 6. Untuk gambar FI 6 asli diperlukan halaman dokumen yang benar-benar memuatnya.</p>}<div className="openMediaGrid">{images.map(row=><figure key={row.id}><img src={row.thumbnail} alt={row.title} loading="lazy" referrerPolicy="no-referrer" onError={()=>setMessage("Gambar tidak dapat dimuat; buka sumber untuk memeriksanya.")}/><figcaption><a href={row.source} target="_blank" rel="noreferrer">{row.title}</a><p>{row.attribution} {row.licenseUrl&&<a href={row.licenseUrl} target="_blank" rel="noreferrer">Lisensi</a>}</p></figcaption></figure>)}</div></>}<p role="status">{message}</p></section>;
}
