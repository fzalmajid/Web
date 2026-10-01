"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
const Paper=dynamic(()=>import("@/components/PaperExplorer"),{ssr:false});
const Data=dynamic(()=>import("@/components/DataLab"),{ssr:false});
const Molecule=dynamic(()=>import("@/components/MoleculeLab"),{ssr:false});
const Offline=dynamic(()=>import("@/components/OfflineStudy"),{ssr:false});
const Ebook=dynamic(()=>import("@/components/EbookReader"),{ssr:false});
const Local=dynamic(()=>import("@/components/LocalHelper"),{ssr:false});
const Audio=dynamic(()=>import("@/components/AudioTranscriber"),{ssr:false});
export default function Tools(){const [tab,setTab]=useState("paper");return <main className="learningTools"><a href="/">← Ruang Belajar</a><h1>Alat belajar</h1><p>Modul dimuat saat digunakan. Data CSV, audio dan SMILES diproses lokal; pencarian paper dan PubChem memakai sumber publik setelah login.</p><nav className="learningRow" aria-label="Alat belajar">{[["paper","Paper & sitasi"],["data","Data & kalibrasi"],["molecule","Molekul & protein"],["audio","Audio & transkrip"],["epub","EPUB"],["local","Helper lokal"],["offline","Offline"]].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>{tab==="paper"?<Paper/>:tab==="data"?<Data/>:tab==="molecule"?<Molecule/>:tab==="audio"?<Audio/>:tab==="epub"?<Ebook/>:tab==="local"?<Local/>:<Offline/>}</main>;}
