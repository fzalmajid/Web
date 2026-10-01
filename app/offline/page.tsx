"use client";
import dynamic from "next/dynamic";
const Offline=dynamic(()=>import("@/components/OfflineStudy"),{ssr:false});
export default function OfflinePage(){return <main className="learningTools"><a href="/">← Ruang Belajar</a><Offline/></main>;}
