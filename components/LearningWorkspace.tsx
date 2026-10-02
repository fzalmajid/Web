"use client";
import dynamic from "next/dynamic";
import {useState} from "react";
const Paper=dynamic(()=>import("./PaperExplorer"),{ssr:false});
const Data=dynamic(()=>import("./DataLab"),{ssr:false});
const Molecule=dynamic(()=>import("./MoleculeLab"),{ssr:false});
const Ebook=dynamic(()=>import("./EbookReader"),{ssr:false});
const Local=dynamic(()=>import("./LocalHelper"),{ssr:false});
export default function LearningWorkspace(){
  const [tab,setTab]=useState("paper");
  return <div className="learningWorkspace"><p className="muted">Alat yang sama tersedia dari + Upload. Tidak ada materi yang otomatis masuk RAG: simpan atau lampirkan hasilnya saat diperlukan.</p>
    <nav className="learningRow" aria-label="Alat belajar">{[["paper","Paper & sitasi"],["data","Data & kalibrasi"],["molecule","Molekul & protein"],["epub","EPUB"],["local","Helper lokal"]].map(([id,label])=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {tab==="paper"?<Paper/>:tab==="data"?<Data/>:tab==="molecule"?<Molecule/>:tab==="epub"?<Ebook/>:<Local/>}
  </div>;
}
