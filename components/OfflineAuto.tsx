"use client";
import {useEffect,useState} from "react";
export default function OfflineAuto(){
  const [offline,setOffline]=useState(false);
  useEffect(()=>{
    const update=()=>setOffline(!navigator.onLine);update();
    window.addEventListener("online",update);window.addEventListener("offline",update);
    if(process.env.NODE_ENV==="production"&&"serviceWorker" in navigator){
      // Only public application assets and the empty offline shell are precached.
      // Private snapshots remain an explicit, account-scoped choice.
      void navigator.serviceWorker.register("/learning-sw.js",{scope:"/",updateViaCache:"none"}).then(reg=>reg.update()).catch(()=>undefined);
    }
    return()=>{window.removeEventListener("online",update);window.removeEventListener("offline",update);};
  },[]);
  return offline?<aside className="offlineConnection" role="status">Mode offline aktif. Hanya materi yang sudah disimpan di perangkat tersedia; AI cloud dan Web menunggu koneksi. <a href="/offline">Buka materi offline</a></aside>:null;
}
