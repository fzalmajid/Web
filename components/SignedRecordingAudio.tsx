"use client";
import {useState} from "react";
import {supabase} from "@/lib/supabase";
import AudioTimeline from "./AudioTimeline";
import type {TranscriptSegment} from "@/lib/audioTimeline";
export default function SignedRecordingAudio({item}:{item:{id:string;file_path:string;user_id:string;duration_seconds:number;transcript_segments?:TranscriptSegment[]}}){
  const[url,setUrl]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  return <div><button disabled={busy} onClick={async()=>{if(url){setUrl("");return;}setBusy(true);setError("");try{const {data,error}=await supabase.storage.from("recordings").createSignedUrl(item.file_path,3600);if(error||!data?.signedUrl)throw error||new Error("Audio belum tersedia.");setUrl(data.signedUrl);}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>{busy?"Membuka audio…":url?"Tutup audio":"Buka audio & timestamp"}</button><p role="status">{error}</p>{url&&<AudioTimeline url={url} account={item.user_id} recording={item.id} segments={item.transcript_segments} duration={item.duration_seconds}/>}</div>;
}
