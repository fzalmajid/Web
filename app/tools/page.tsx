"use client";
import dynamic from "next/dynamic";
const Workspace=dynamic(()=>import("@/components/LearningWorkspace"),{ssr:false});
export default function Tools(){return <main className="learningTools"><header className="learningToolsHeader"><a href="/">← Ruang Belajar</a><p className="eyebrow">RUANG BELAJAR</p><h1>Alat belajar</h1><p>Audio dan transkrip ada di mic Tanya AI atau + Upload → Rekaman & transkrip. Mode offline aktif otomatis saat jaringan putus; materi pribadi harus sudah disimpan di perangkat.</p><a href="/offline">Kelola materi offline</a></header><Workspace/></main>;}
