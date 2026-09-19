"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type NodeType = "material" | "submaterial" | "database" | "flashcards" | "quiz";
type Correction = { heard: string; corrected: string; basis: string };
type StudyNode = { id:string; user_id:string; parent_id:string|null; title:string; node_type:NodeType; description:string; position:number; created_at:string };
type KnowledgeEntry = { id:string; user_id:string; node_id:string; title:string; category:string; content:string; raw_content:string|null; source_type:"manual"|"file"|"transcript"|"generated"; source_file_id:string|null; created_at:string };
type SourceFile = { id:string; user_id:string; node_id:string; file_path:string; file_name:string; mime_type:string; size_bytes:number; processing_status:"processing"|"ready"|"error"; raw_text:string|null; structured_text:string|null; corrections:Correction[]; error_message:string|null; created_at:string };
type Recording = { id:string; user_id:string; node_id:string|null; title:string; file_path:string; mime_type:string; duration_seconds:number; transcript:string|null; raw_transcript:string|null; structured_transcript:string|null; corrections:Correction[]; knowledge_entry_id:string|null; created_at:string };
type Flashcard = { id:string; front:string; back:string; material_id:string|null; scope_node_id:string|null };
type Quiz = { id:string; question:string; choices:string[]; correct_answer:string; explanation:string; material_id:string|null; scope_node_id:string|null };

const tabs = ["Beranda","Materi","Rekam","Latihan"] as const;
type Tab = (typeof tabs)[number];
const nodeLabels:Record<NodeType,string> = { material:"Materi", submaterial:"Submateri", database:"Database", flashcards:"Flashcard", quiz:"Kuis" };

export default function Home(){
  const [session,setSession]=useState<Session|null>(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));

    // Clear the old cache-first PWA shell that could pin users to an earlier deployment.
    if ("caches" in window) {
      caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))).catch(()=>{});
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js?v=4", { updateViaCache: "none" })
        .then(reg => reg.update())
        .catch(()=>{});
    }

    return ()=>subscription.unsubscribe();
  },[]);
  if(loading) return <main className="center"><div className="loader">Memuat Ruang Belajar...</div></main>;
  if(!session) return <Auth/>;
  return <Dashboard session={session} user={session.user}/>;
}

function Auth(){
  const [mode,setMode]=useState<"login"|"signup">("login");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setMessage("");
    const result=mode==="login"
      ? await supabase.auth.signInWithPassword({email,password})
      : await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}});
    if(result.error) setMessage(result.error.message);
    else if(mode==="signup"&&!result.data.session) setMessage("Akun dibuat. Cek email untuk konfirmasi jika diminta.");
    setBusy(false);
  }
  return <main className="authShell"><section className="authCard">
    <div className="brandMark">RB</div><p className="eyebrow">PRIVATE STUDY SYSTEM</p><h1>Ruang Belajar</h1>
    <p className="muted">Materi, database, rekaman, transkrip, flashcard, dan kuis dalam satu ruang belajar.</p>
    <form onSubmit={submit} className="stack">
      <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="nama@email.com"/></label>
      <label>Password<input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimal 6 karakter"/></label>
      <button className="primary" disabled={busy}>{busy?"Memproses...":mode==="login"?"Masuk":"Buat akun"}</button>
    </form>
    {message&&<div className="notice">{message}</div>}
    <button className="textBtn" onClick={()=>setMode(mode==="login"?"signup":"login")}>{mode==="login"?"Belum punya akun? Daftar":"Sudah punya akun? Masuk"}</button>
  </section></main>;
}

function Dashboard({session,user}:{session:Session;user:User}){
  const [tab,setTab]=useState<Tab>("Beranda");
  const [nodes,setNodes]=useState<StudyNode[]>([]);
  const [entries,setEntries]=useState<KnowledgeEntry[]>([]);
  const [files,setFiles]=useState<SourceFile[]>([]);
  const [recordings,setRecordings]=useState<Recording[]>([]);
  const [cards,setCards]=useState<Flashcard[]>([]);
  const [quizzes,setQuizzes]=useState<Quiz[]>([]);
  const [refreshKey,setRefreshKey]=useState(0);
  useEffect(()=>{void loadAll();},[refreshKey]);
  async function loadAll(){
    const [n,e,f,r,c,q]=await Promise.all([
      supabase.from("study_nodes").select("*").order("position").order("created_at"),
      supabase.from("knowledge_entries").select("*").order("created_at",{ascending:false}),
      supabase.from("source_files").select("*").order("created_at",{ascending:false}),
      supabase.from("recordings").select("*").order("created_at",{ascending:false}),
      supabase.from("flashcards").select("*").order("created_at",{ascending:false}),
      supabase.from("quizzes").select("*").order("created_at",{ascending:false})
    ]);
    setNodes((n.data||[]) as StudyNode[]);setEntries((e.data||[]) as KnowledgeEntry[]);setFiles((f.data||[]) as SourceFile[]);
    setRecordings((r.data||[]) as Recording[]);setCards((c.data||[]) as Flashcard[]);setQuizzes((q.data||[]) as Quiz[]);
  }
  const refresh=()=>setRefreshKey(x=>x+1);
  return <div className="appShell">
    <header className="topbar"><div><p className="eyebrow">RUANG BELAJAR</p><h1>Belajar dari ruangmu sendiri.</h1></div>
      <div className="headerActions"><span className="userPill">{user.email}</span><button className="ghost" onClick={()=>supabase.auth.signOut()}>Keluar</button></div>
    </header>
    <nav className="tabs">{tabs.map(item=><button key={item} className={tab===item?"tab active":"tab"} onClick={()=>setTab(item)}>{item}</button>)}</nav>
    <main className="content">
      {tab==="Beranda"&&<Overview session={session} nodes={nodes} entries={entries} recordings={recordings} cards={cards} quizzes={quizzes} setTab={setTab}/>}
      {tab==="Materi"&&<MaterialsWorkspace session={session} user={user} nodes={nodes} entries={entries} files={files} cards={cards} quizzes={quizzes} onChange={refresh}/>}
      {tab==="Rekam"&&<Recorder session={session} user={user} nodes={nodes} recordings={recordings} onChange={refresh}/>}
      {tab==="Latihan"&&<Study session={session} nodes={nodes} cards={cards} quizzes={quizzes} onChange={refresh}/>}
    </main>
  </div>;
}

function Overview({session,nodes,entries,recordings,cards,quizzes,setTab}:{session:Session;nodes:StudyNode[];entries:KnowledgeEntry[];recordings:Recording[];cards:Flashcard[];quizzes:Quiz[];setTab:(t:Tab)=>void}){
  const materialCount=nodes.filter(n=>n.node_type==="material").length;
  return <>
    <section className="hero card"><div><p className="eyebrow">PRIVATE STUDY LIBRARY</p><h2>Materi adalah ruang. Database adalah pengetahuannya.</h2>
      <p className="muted">AI global di bawah mencari seluruh database akunmu. Di setiap materi ada Tanya AI yang hanya melihat cabang tersebut.</p></div>
      <div className="stats"><Stat n={materialCount} t="Materi"/><Stat n={entries.length} t="Database"/><Stat n={recordings.length} t="Rekaman"/><Stat n={cards.length+quizzes.length} t="Latihan"/></div>
    </section>
    <section className="grid3"><Shortcut title="Bangun materi" body="Buat materi, submateri, database, flashcard, dan kuis bertingkat." onClick={()=>setTab("Materi")}/>
      <Shortcut title="Rekam penjelasan" body="Transkrip verbatim dan versi tertata muncul setelah pemrosesan." onClick={()=>setTab("Rekam")}/>
      <Shortcut title="Latihan" body="Buat flashcard atau kuis dari database scope yang dipilih." onClick={()=>setTab("Latihan")}/></section>
    <div className="spaceTop"><Ask session={session} scopeNodeId={null} title="Tanya seluruh Database" subtitle="Mencari di seluruh database akunmu."/></div>
  </>;
}
function Stat({n,t}:{n:number;t:string}){return <div><strong>{n}</strong><span>{t}</span></div>;}
function Shortcut({title,body,onClick}:{title:string;body:string;onClick:()=>void}){return <article className="card shortcut"><h3>{title}</h3><p className="muted">{body}</p><button className="primary" onClick={onClick}>Buka</button></article>;}

function MaterialsWorkspace({session,user,nodes,entries,files,cards,quizzes,onChange}:{session:Session;user:User;nodes:StudyNode[];entries:KnowledgeEntry[];files:SourceFile[];cards:Flashcard[];quizzes:Quiz[];onChange:()=>void}){
  const roots=useMemo(()=>nodes.filter(n=>!n.parent_id),[nodes]);
  const [selectedId,setSelectedId]=useState("");
  const [rootTitle,setRootTitle]=useState("");
  const [childTitle,setChildTitle]=useState("");
  const [childType,setChildType]=useState<NodeType>("submaterial");
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!selectedId&&roots[0]) setSelectedId(roots[0].id);
    if(selectedId&&!nodes.some(n=>n.id===selectedId)) setSelectedId(roots[0]?.id||"");
  },[nodes,roots,selectedId]);
  const selected=nodes.find(n=>n.id===selectedId)||null;
  async function createRoot(e:FormEvent){
    e.preventDefault();if(!rootTitle.trim())return;setBusy(true);
    const {data,error}=await supabase.from("study_nodes").insert({user_id:user.id,parent_id:null,title:rootTitle.trim(),node_type:"material"}).select("id").single();
    setBusy(false);if(error)return alert(error.message);setRootTitle("");setSelectedId(data.id);onChange();
  }
  async function createChild(e:FormEvent){
    e.preventDefault();if(!selected||!childTitle.trim())return;setBusy(true);
    const {data,error}=await supabase.from("study_nodes").insert({user_id:user.id,parent_id:selected.id,title:childTitle.trim(),node_type:childType}).select("id").single();
    setBusy(false);if(error)return alert(error.message);setChildTitle("");setSelectedId(data.id);onChange();
  }
  return <section className="workspace">
    <aside className="card treeCard"><p className="eyebrow">STRUKTUR MATERI</p><h2>Materi & submateri</h2>
      <form className="miniForm" onSubmit={createRoot}><input value={rootTitle} onChange={e=>setRootTitle(e.target.value)} placeholder="Nama materi baru..."/><button className="primary" disabled={busy||!rootTitle.trim()}>+ Materi</button></form>
      <div className="tree">{roots.length?roots.map(root=><NodeBranch key={root.id} node={root} nodes={nodes} depth={0} selectedId={selectedId} onSelect={setSelectedId}/>):<p className="muted">Belum ada materi. Buat materi utama dulu.</p>}</div>
      {selected&&<div className="childCreator"><small>Tambah di dalam <strong>{selected.title}</strong></small>
        <form className="stack tight" onSubmit={createChild}><input value={childTitle} onChange={e=>setChildTitle(e.target.value)} placeholder="Nama sub/cabang..."/>
          <select value={childType} onChange={e=>setChildType(e.target.value as NodeType)}><option value="submaterial">Submateri</option><option value="database">Database</option><option value="flashcards">Flashcard</option><option value="quiz">Kuis</option></select>
          <button className="ghost" disabled={busy||!childTitle.trim()}>Tambah cabang</button></form></div>}
    </aside>
    <section className="workspaceMain">{!selected?<article className="card"><h2>Pilih atau buat materi.</h2><p className="muted">Isi database, file, rekaman, AI, flashcard, dan kuis akan dikaitkan ke scope yang dipilih.</p></article>:<>
      <article className="card scopeHeader"><div><span className="typeBadge">{nodeLabels[selected.node_type]}</span><h2>{selected.title}</h2></div>
        <p className="muted">AI di halaman ini dibatasi ke cabang <strong>{selected.title}</strong> beserta seluruh anaknya.</p></article>
      {(selected.node_type==="material"||selected.node_type==="submaterial"||selected.node_type==="database")&&<>
        <section className="split"><DatabaseEditor user={user} node={selected} entries={entries} onChange={onChange}/><FileImporter session={session} user={user} node={selected} files={files} onChange={onChange}/></section>
        <Ask session={session} scopeNodeId={selected.id} title={"Tanya AI - "+selected.title} subtitle="Hanya database pada scope ini dan seluruh turunannya yang boleh dipakai."/>
      </>}
      {(selected.node_type==="flashcards"||selected.node_type==="quiz")&&<TypedPractice session={session} node={selected} nodes={nodes} cards={cards} quizzes={quizzes} onChange={onChange}/>}
    </>}</section>
  </section>;
}

function NodeBranch({node,nodes,depth,selectedId,onSelect}:{node:StudyNode;nodes:StudyNode[];depth:number;selectedId:string;onSelect:(id:string)=>void}){
  const children=nodes.filter(n=>n.parent_id===node.id);
  return <div><button className={selectedId===node.id?"treeNode active":"treeNode"} style={{paddingLeft:10+depth*15}} onClick={()=>onSelect(node.id)}><span>{node.title}</span><small>{nodeLabels[node.node_type]}</small></button>
    {children.map(child=><NodeBranch key={child.id} node={child} nodes={nodes} depth={depth+1} selectedId={selectedId} onSelect={onSelect}/>)}</div>;
}

function DatabaseEditor({user,node,entries,onChange}:{user:User;node:StudyNode;entries:KnowledgeEntry[];onChange:()=>void}){
  const [title,setTitle]=useState("");const [category,setCategory]=useState("");const [content,setContent]=useState("");const [busy,setBusy]=useState(false);
  const localEntries=entries.filter(e=>e.node_id===node.id);
  async function save(e:FormEvent){
    e.preventDefault();setBusy(true);
    const {error}=await supabase.from("knowledge_entries").insert({user_id:user.id,node_id:node.id,title:title.trim(),category:category.trim(),content:content.trim(),raw_content:content.trim(),source_type:"manual"});
    setBusy(false);if(error)return alert(error.message);setTitle("");setCategory("");setContent("");onChange();
  }
  async function remove(id:string){if(!confirm("Hapus isi database ini?"))return;const {error}=await supabase.from("knowledge_entries").delete().eq("id",id);if(error)alert(error.message);else onChange();}
  return <article className="card"><p className="eyebrow">DATABASE</p><h2>Isi pengetahuan</h2><p className="muted">Materi adalah ruang; database adalah fakta/catatan yang dipakai AI.</p>
    <form onSubmit={save} className="stack"><label>Judul<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Contoh: Definisi CPOB"/></label>
      <label>Kategori<input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Regulasi, konsep, istilah..."/></label>
      <label>Isi<textarea required rows={8} value={content} onChange={e=>setContent(e.target.value)} placeholder="Masukkan isi database..."/></label>
      <button className="primary" disabled={busy||!title.trim()||!content.trim()}>{busy?"Menyimpan...":"Simpan ke Database"}</button></form>
    <div className="list compactList">{localEntries.length?localEntries.map(entry=><div className="item" key={entry.id}><div className="itemTop"><div><h3>{entry.title}</h3><small>{entry.category||"Tanpa kategori"} · {entry.source_type}</small></div><button className="danger smallBtn" onClick={()=>remove(entry.id)}>Hapus</button></div><p>{entry.content.length>380?entry.content.slice(0,380)+"...":entry.content}</p></div>):<p className="muted">Belum ada isi database langsung pada scope ini.</p>}</div>
  </article>;
}

function FileImporter({session,user,node,files,onChange}:{session:Session;user:User;node:StudyNode;files:SourceFile[];onChange:()=>void}){
  const [selectedFile,setSelectedFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [status,setStatus]=useState("");
  const localFiles=files.filter(f=>f.node_id===node.id);
  async function upload(e:FormEvent){
    e.preventDefault();if(!selectedFile)return;const mimeType=inferMime(selectedFile);
    if(!mimeType)return alert("Jenis file belum didukung. Gunakan PDF, DOCX, TXT/MD/CSV/JSON, audio, video, atau gambar.");
    if(selectedFile.size>50*1024*1024)return alert("File maksimal 50 MB untuk versi ini.");
    setBusy(true);setStatus("Mengupload file...");
    const safeName=selectedFile.name.replace(/[^a-zA-Z0-9._-]+/g,"_");const path=user.id+"/"+node.id+"/"+crypto.randomUUID()+"-"+safeName;
    const uploadResult=await supabase.storage.from("study-files").upload(path,selectedFile,{contentType:mimeType});
    if(uploadResult.error){setBusy(false);setStatus("");return alert(uploadResult.error.message);}
    const {data:fileRow,error:rowError}=await supabase.from("source_files").insert({user_id:user.id,node_id:node.id,file_path:path,file_name:selectedFile.name,mime_type:mimeType,size_bytes:selectedFile.size,processing_status:"processing"}).select("*").single();
    if(rowError){await supabase.storage.from("study-files").remove([path]);setBusy(false);setStatus("");return alert(rowError.message);}
    setStatus("Mengekstrak/transkrip lalu menata isi...");
    const response=await fetch("/api/import-file",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify({sourceFileId:fileRow.id,filePath:path,fileName:selectedFile.name,mimeType,nodeId:node.id})});
    const result=await response.json();setBusy(false);
    if(!response.ok){setStatus("File tersimpan, tetapi pemrosesan gagal.");onChange();return alert(result.error||"Gagal memproses file.");}
    setSelectedFile(null);setStatus("Selesai. Isi sudah masuk ke Database.");onChange();
  }
  async function removeFile(file:SourceFile){
    if(!confirm('Hapus file "'+file.file_name+'" dan database hasil impornya?'))return;
    await supabase.from("knowledge_entries").delete().eq("source_file_id",file.id);
    const storage=await supabase.storage.from("study-files").remove([file.file_path]);if(storage.error)return alert(storage.error.message);
    const {error}=await supabase.from("source_files").delete().eq("id",file.id);if(error)alert(error.message);else onChange();
  }
  return <article className="card"><p className="eyebrow">UPLOAD MATERI</p><h2>File → Database</h2>
    <p className="muted">PDF, Word DOCX, teks, audio, video, dan gambar dapat diupload. Audio/video menghasilkan transkrip verbatim + versi tertata.</p>
    <form onSubmit={upload} className="stack"><label>Pilih file<input type="file" accept=".pdf,.docx,.txt,.md,.csv,.json,.xml,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.webm,.mp4,.mov,.png,.jpg,.jpeg,.webp" onChange={e=>setSelectedFile(e.target.files?.[0]||null)}/></label>
      <button className="primary" disabled={!selectedFile||busy}>{busy?"Memproses...":"Upload & olah"}</button></form>
    {status&&<div className="notice">{status}</div>}
    <div className="list compactList">{localFiles.length?localFiles.map(file=><div className="item" key={file.id}><div className="itemTop"><div><h3>{file.file_name}</h3><small>{file.processing_status} · {formatBytes(file.size_bytes)}</small></div><button className="danger smallBtn" onClick={()=>removeFile(file)}>Hapus</button></div>
      {file.error_message&&<div className="result bad">{file.error_message}</div>}
      {file.structured_text&&<details><summary>Hasil tertata</summary><div className="transcriptBox">{file.structured_text}</div></details>}
      {file.raw_text&&<details><summary>Sumber mentah / verbatim</summary><div className="transcriptBox raw">{file.raw_text}</div></details>}
      {!!file.corrections?.length&&<CorrectionList corrections={file.corrections}/>}</div>):<p className="muted">Belum ada file pada scope ini.</p>}</div>
  </article>;
}

function Recorder({session,user,nodes,recordings,onChange}:{session:Session;user:User;nodes:StudyNode[];recordings:Recording[];onChange:()=>void}){
  const scopes=nodes.filter(n=>["material","submaterial","database"].includes(n.node_type));
  const [scopeId,setScopeId]=useState("");const recRef=useRef<MediaRecorder|null>(null);const chunksRef=useRef<Blob[]>([]);const startedRef=useRef(0);const elapsedRef=useRef(0);
  const [recording,setRecording]=useState(false);const [status,setStatus]=useState("Siap merekam");const [busy,setBusy]=useState(false);const [elapsed,setElapsed]=useState(0);
  const [latest,setLatest]=useState<{raw:string;structured:string;corrections:Correction[]}|null>(null);
  useEffect(()=>{if(!scopeId&&scopes[0])setScopeId(scopes[0].id);},[scopes,scopeId]);
  useEffect(()=>{if(!recording)return;const id=setInterval(()=>{const value=Math.floor((Date.now()-startedRef.current)/1000);elapsedRef.current=value;setElapsed(value);},500);return()=>clearInterval(id);},[recording]);
  async function start(){
    try{
      if(!scopeId)return alert("Buat/pilih Materi atau Database dulu agar rekaman punya scope.");
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const preferred=typeof MediaRecorder!=="undefined"&&MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":"";
      const rec=preferred?new MediaRecorder(stream,{mimeType:preferred}):new MediaRecorder(stream);chunksRef.current=[];recRef.current=rec;setLatest(null);
      rec.ondataavailable=event=>{if(event.data.size)chunksRef.current.push(event.data);};
      rec.onstop=async()=>{stream.getTracks().forEach(track=>track.stop());const blob=new Blob(chunksRef.current,{type:rec.mimeType||"audio/webm"});await processRecording(blob);};
      startedRef.current=Date.now();elapsedRef.current=0;setElapsed(0);rec.start();setRecording(true);setStatus("Sedang merekam...");
    }catch(error:any){alert(error.message);}
  }
  function stop(){recRef.current?.stop();setRecording(false);setStatus("Menyimpan audio...");}
  async function processRecording(blob:Blob){
    setBusy(true);const mimeType=normalizeAudioMime(blob.type);const ext=mimeType==="audio/m4a"?"m4a":mimeType.split("/")[1]||"webm";const path=user.id+"/"+crypto.randomUUID()+"."+ext;
    const upload=await supabase.storage.from("recordings").upload(path,blob,{contentType:mimeType});if(upload.error){setBusy(false);setStatus("Gagal upload");return alert(upload.error.message);}
    const title="Rekaman "+new Date().toLocaleString("id-ID");
    const {data:row,error}=await supabase.from("recordings").insert({user_id:user.id,node_id:scopeId,title,file_path:path,mime_type:mimeType,duration_seconds:elapsedRef.current}).select("*").single();
    if(error){await supabase.storage.from("recordings").remove([path]);setBusy(false);return alert(error.message);}
    setStatus("Membuat transkrip verbatim dan versi tertata...");
    const response=await fetch("/api/transcribe",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify({recordingId:row.id,filePath:path,mimeType,scopeNodeId:scopeId})});
    const result=await response.json();setBusy(false);
    if(!response.ok){setStatus("Audio tersimpan, transkrip belum berhasil.");onChange();return alert(result.error||"Transkripsi gagal.");}
    setLatest({raw:result.rawTranscript||"",structured:result.structuredTranscript||"",corrections:result.corrections||[]});setStatus("Selesai. Transkrip sudah tersimpan ke Database.");onChange();
  }
  async function play(r:Recording){const {data,error}=await supabase.storage.from("recordings").createSignedUrl(r.file_path,600);if(error)return alert(error.message);window.open(data.signedUrl,"_blank");}
  async function remove(r:Recording){
    if(!confirm("Hapus rekaman, audio, dan database transkripnya?"))return;
    const storage=await supabase.storage.from("recordings").remove([r.file_path]);if(storage.error)return alert(storage.error.message);
    if(r.knowledge_entry_id)await supabase.from("knowledge_entries").delete().eq("id",r.knowledge_entry_id);
    const {error}=await supabase.from("recordings").delete().eq("id",r.id);if(error)alert(error.message);else{setLatest(null);onChange();}
  }
  return <section className="split"><article className="card"><p className="eyebrow">VOICE NOTES</p><h2>Rekam → transkrip → database</h2>
    <label className="blockLabel">Simpan ke scope<select value={scopeId} onChange={e=>setScopeId(e.target.value)}><option value="">Pilih materi/database</option>{scopes.map(scope=><option key={scope.id} value={scope.id}>{nodeLabels[scope.node_type]} — {scope.title}</option>)}</select></label>
    <p className="muted">Verbatim mempertahankan yang terdengar. Versi tertata hanya mengoreksi istilah bila database mendukungnya.</p>
    <div className="recPanel"><span className={recording?"dot live":"dot"}/><div><strong>{status}</strong><p>{String(Math.floor(elapsed/60)).padStart(2,"0")}:{String(elapsed%60).padStart(2,"0")}</p></div></div>
    <div className="row"><button className="primary" disabled={recording||busy||!scopeId} onClick={start}>Mulai Rekam</button><button className="danger" disabled={!recording} onClick={stop}>Stop</button></div>
    {busy&&<div className="notice">Audio sedang diproses. Jangan tutup halaman ini.</div>}
    {latest&&<div className="latestTranscript"><h3>Transkrip baru</h3><strong>Versi tertata</strong><div className="transcriptBox">{latest.structured}</div><details><summary>Verbatim / yang terdengar</summary><div className="transcriptBox raw">{latest.raw}</div></details><CorrectionList corrections={latest.corrections}/></div>}
  </article>
  <article className="card"><p className="eyebrow">PRIVATE AUDIO</p><h2>Rekaman tersimpan</h2><div className="list">{recordings.length?recordings.map(r=><div className="item" key={r.id}><div className="itemTop"><div><h3>{r.title}</h3><small>{Math.floor(r.duration_seconds/60)}m {r.duration_seconds%60}s</small></div><button className="danger smallBtn" onClick={()=>remove(r)}>Hapus</button></div>
    {r.structured_transcript&&<div className="transcriptBox">{r.structured_transcript}</div>}
    {r.raw_transcript&&<details><summary>Verbatim</summary><div className="transcriptBox raw">{r.raw_transcript}</div></details>}
    {!!r.corrections?.length&&<CorrectionList corrections={r.corrections}/>}<button className="ghost" onClick={()=>play(r)}>Putar audio</button></div>):<p className="muted">Belum ada rekaman.</p>}</div></article></section>;
}

function Ask({session,scopeNodeId,title,subtitle}:{session:Session;scopeNodeId:string|null;title:string;subtitle:string}){
  const [question,setQuestion]=useState("");const [answer,setAnswer]=useState("");const [sources,setSources]=useState<Array<{id:string;title:string;category:string}>>([]);const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setAnswer("");setSources([]);
    const response=await fetch("/api/ask",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify({question,scopeNodeId})});
    const result=await response.json();setBusy(false);if(!response.ok)return setAnswer(result.error||"Terjadi kesalahan.");setAnswer(result.answer);setSources(result.sources||[]);
  }
  return <article className="card askCard"><p className="eyebrow">DATABASE-ONLY AI</p><h2>{title}</h2><p className="muted">{subtitle}</p>
    <form className="askForm" onSubmit={submit}><input required minLength={3} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Tanyakan sesuatu..."/><button className="primary" disabled={busy}>{busy?"Mencari...":"Tanya"}</button></form>
    <div className="answer">{answer||"Belum ada pertanyaan."}</div>{!!sources.length&&<div className="sources"><strong>Sumber database:</strong>{sources.map(s=><span key={s.id}>{s.title}{s.category?" — "+s.category:""}</span>)}</div>}
  </article>;
}

function TypedPractice({session,node,nodes,cards,quizzes,onChange}:{session:Session;node:StudyNode;nodes:StudyNode[];cards:Flashcard[];quizzes:Quiz[];onChange:()=>void}){
  const parent=nodes.find(n=>n.id===node.parent_id)||null;const sourceNodeId=parent?.id||node.id;const mode=node.node_type==="flashcards"?"flashcards":"quiz";
  return <article className="card"><p className="eyebrow">{nodeLabels[node.node_type].toUpperCase()}</p><h2>{node.title}</h2><p className="muted">Sumber database: {parent?parent.title:node.title}. Hasil disimpan khusus di cabang ini.</p>
    <PracticeContent session={session} sourceNodeId={sourceNodeId} targetNodeId={node.id} mode={mode} cards={cards.filter(c=>c.scope_node_id===node.id)} quizzes={quizzes.filter(q=>q.scope_node_id===node.id)} onChange={onChange}/></article>;
}

function Study({session,nodes,cards,quizzes,onChange}:{session:Session;nodes:StudyNode[];cards:Flashcard[];quizzes:Quiz[];onChange:()=>void}){
  const scopes=nodes.filter(n=>["material","submaterial","database"].includes(n.node_type));const [selected,setSelected]=useState("");
  useEffect(()=>{if(!selected&&scopes[0])setSelected(scopes[0].id);},[scopes,selected]);
  return <article className="card"><div className="studyHead"><div><p className="eyebrow">AI STUDY TOOLS</p><h2>Flashcard & kuis dari Database</h2></div>
    <select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Pilih scope</option>{scopes.map(node=><option key={node.id} value={node.id}>{nodeLabels[node.node_type]} — {node.title}</option>)}</select></div>
    {selected?<PracticeContent session={session} sourceNodeId={selected} targetNodeId={selected} mode="both" cards={cards.filter(c=>c.scope_node_id===selected)} quizzes={quizzes.filter(q=>q.scope_node_id===selected)} onChange={onChange}/>:<p className="muted">Pilih materi/database dulu.</p>}
  </article>;
}

function PracticeContent({session,sourceNodeId,targetNodeId,mode,cards,quizzes,onChange}:{session:Session;sourceNodeId:string;targetNodeId:string;mode:"flashcards"|"quiz"|"both";cards:Flashcard[];quizzes:Quiz[];onChange:()=>void}){
  const [busy,setBusy]=useState(false);const [flipped,setFlipped]=useState<Record<string,boolean>>({});const [answers,setAnswers]=useState<Record<string,string>>({});
  async function generate(){
    setBusy(true);const response=await fetch("/api/generate-study",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify({sourceNodeId,targetNodeId,mode})});
    const result=await response.json();setBusy(false);if(!response.ok)return alert(result.error||"Gagal membuat latihan.");onChange();alert("Dibuat "+result.flashcards+" flashcard dan "+result.quizzes+" soal.");
  }
  return <><div className="practiceAction"><button className="primary" onClick={generate} disabled={busy}>{busy?"Membuat...":mode==="flashcards"?"Buat Flashcard":mode==="quiz"?"Buat Kuis":"Buat Flashcard + Kuis"}</button></div>
    <section className="split">{mode!=="quiz"&&<div><h3>Flashcard</h3><div className="cards">{cards.length?cards.map(card=><button key={card.id} className="flash" onClick={()=>setFlipped(value=>({...value,[card.id]:!value[card.id]}))}><small>{flipped[card.id]?"JAWABAN":"PERTANYAAN"}</small><strong>{flipped[card.id]?card.back:card.front}</strong><span>Ketuk untuk balik</span></button>):<p className="muted">Belum ada flashcard.</p>}</div></div>}
      {mode!=="flashcards"&&<div><h3>Kuis</h3><div className="list">{quizzes.length?quizzes.map(quiz=><div className="item quiz" key={quiz.id}><h3>{quiz.question}</h3>{quiz.choices.map(choice=><button key={choice} onClick={()=>setAnswers(value=>({...value,[quiz.id]:choice}))} className={answers[quiz.id]===choice?"choice selected":"choice"}>{choice}</button>)}{answers[quiz.id]&&<div className={answers[quiz.id]===quiz.correct_answer?"result ok":"result bad"}>{answers[quiz.id]===quiz.correct_answer?"Benar":"Belum tepat"} — Jawaban: {quiz.correct_answer}<br/>{quiz.explanation}</div>}</div>):<p className="muted">Belum ada kuis.</p>}</div></div>}</section></>;
}

function CorrectionList({corrections}:{corrections:Correction[]}){if(!corrections?.length)return null;return <div className="corrections"><strong>Koreksi berbasis Database</strong>{corrections.map((item,index)=><div key={item.heard+"-"+index}><span>{item.heard}</span><b>→</b><span>{item.corrected}</span>{item.basis&&<small>{item.basis}</small>}</div>)}</div>;}
function inferMime(file:File){
  const current=(file.type||"").split(";")[0].toLowerCase();if(current&&current!=="application/octet-stream")return normalizeAudioMime(current);
  const ext=file.name.toLowerCase().split(".").pop()||"";const map:Record<string,string>={pdf:"application/pdf",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",txt:"text/plain",md:"text/markdown",csv:"text/csv",json:"application/json",xml:"application/xml",mp3:"audio/mpeg",wav:"audio/wav",m4a:"audio/m4a",aac:"audio/aac",ogg:"audio/ogg",flac:"audio/flac",opus:"audio/opus",webm:"audio/webm",mp4:"video/mp4",mov:"video/quicktime",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp"};return map[ext]||"";
}
function normalizeAudioMime(value:string){const mime=(value||"audio/webm").split(";")[0].trim().toLowerCase();if(mime==="audio/mp4")return "audio/m4a";return mime||"audio/webm";}
function formatBytes(value:number){if(!value)return "0 B";if(value<1024)return value+" B";if(value<1024*1024)return (value/1024).toFixed(1)+" KB";return (value/(1024*1024)).toFixed(1)+" MB";}
