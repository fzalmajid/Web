"use client";

import { useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Material = {
  id: string; title: string; category: string; content: string;
  source_type: "manual" | "transcript"; created_at: string;
};
type Recording = {
  id: string; title: string; file_path: string; mime_type: string;
  duration_seconds: number; transcript: string | null; created_at: string;
};
type Flashcard = { id:string; front:string; back:string; material_id:string|null };
type Quiz = { id:string; question:string; choices:string[]; correct_answer:string; explanation:string; material_id:string|null };

const tabs = ["Beranda","Materi","Rekam","Tanya AI","Latihan"] as const;
type Tab = typeof tabs[number];

export default function Home() {
  const [session,setSession] = useState<Session|null>(null);
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setLoading(false)});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
    if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
    return ()=>subscription.unsubscribe();
  },[]);

  if(loading) return <main className="center"><div className="loader">Memuat Ruang Belajarâ€¦</div></main>;
  if(!session) return <Auth />;
  return <Dashboard session={session} user={session.user} />;
}

function Auth(){
  const [mode,setMode]=useState<"login"|"signup">("login");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  async function submit(e:React.FormEvent){
    e.preventDefault(); setBusy(true); setMessage("");
    const fn = mode==="login" ? supabase.auth.signInWithPassword : supabase.auth.signUp;
    const {error,data} = await fn({email,password});
    if(error) setMessage(error.message);
    else if(mode==="signup" && !data.session) setMessage("Akun dibuat. Cek email untuk konfirmasi jika diminta.");
    setBusy(false);
  }

  return <main className="authShell">
    <section className="authCard">
      <div className="brandMark">RB</div>
      <p className="eyebrow">DATABASE-ONLY STUDY SPACE</p>
      <h1>Ruang Belajar</h1>
      <p className="muted">Simpan materi, rekam penjelasan, lalu belajar hanya dari database milikmu.</p>
      <form onSubmit={submit} className="stack">
        <label>Email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="nama@email.com"/></label>
        <label>Password<input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimal 6 karakter"/></label>
        <button className="primary" disabled={busy}>{busy?"Memprosesâ€¦":mode==="login"?"Masuk":"Buat akun"}</button>
      </form>
      {message && <div className="notice">{message}</div>}
      <button className="textBtn" onClick={()=>setMode(mode==="login"?"signup":"login")}>
        {mode==="login"?"Belum punya akun? Daftar":"Sudah punya akun? Masuk"}
      </button>
    </section>
  </main>
}

function Dashboard({session,user}:{session:Session,user:User}){
  const [tab,setTab]=useState<Tab>("Beranda");
  const [materials,setMaterials]=useState<Material[]>([]);
  const [recordings,setRecordings]=useState<Recording[]>([]);
  const [cards,setCards]=useState<Flashcard[]>([]);
  const [quizzes,setQuizzes]=useState<Quiz[]>([]);
  const [refreshKey,setRefreshKey]=useState(0);

  useEffect(()=>{ loadAll(); },[refreshKey]);

  async function loadAll(){
    const [{data:m},{data:r},{data:f},{data:q}] = await Promise.all([
      supabase.from("materials").select("*").order("created_at",{ascending:false}),
      supabase.from("recordings").select("*").order("created_at",{ascending:false}),
      supabase.from("flashcards").select("*").order("created_at",{ascending:false}),
      supabase.from("quizzes").select("*").order("created_at",{ascending:false}),
    ]);
    setMaterials((m||[]) as Material[]); setRecordings((r||[]) as Recording[]);
    setCards((f||[]) as Flashcard[]); setQuizzes((q||[]) as Quiz[]);
  }

  return <div className="appShell">
    <header className="topbar">
      <div><p className="eyebrow">RUANG BELAJAR</p><h1>Belajar dari datamu sendiri.</h1></div>
      <div className="headerActions">
        <span className="userPill">{user.email}</span>
        <button className="ghost" onClick={()=>supabase.auth.signOut()}>Keluar</button>
      </div>
    </header>

    <nav className="tabs">{tabs.map(x=><button key={x} className={tab===x?"tab active":"tab"} onClick={()=>setTab(x)}>{x}</button>)}</nav>

    <main className="content">
      {tab==="Beranda" && <Overview materials={materials} recordings={recordings} cards={cards} quizzes={quizzes} setTab={setTab}/>}
      {tab==="Materi" && <Materials user={user} materials={materials} onChange={()=>setRefreshKey(x=>x+1)}/>}
      {tab==="Rekam" && <Recorder session={session} user={user} recordings={recordings} onChange={()=>setRefreshKey(x=>x+1)}/>}
      {tab==="Tanya AI" && <Ask session={session}/>}
      {tab==="Latihan" && <Study session={session} materials={materials} cards={cards} quizzes={quizzes} onChange={()=>setRefreshKey(x=>x+1)}/>}
    </main>
  </div>
}

function Overview({materials,recordings,cards,quizzes,setTab}:any){
  return <>
    <section className="hero card">
      <div><p className="eyebrow">PRIVATE STUDY LIBRARY</p><h2>Catat. Rekam. Tanya. Uji diri.</h2>
      <p className="muted">AI hanya diberi materi yang ditemukan di database akunmu. Jika tidak ada sumber, sistem berhenti.</p></div>
      <div className="stats">
        <Stat n={materials.length} t="Materi"/><Stat n={recordings.length} t="Rekaman"/>
        <Stat n={cards.length} t="Flashcard"/><Stat n={quizzes.length} t="Soal"/>
      </div>
    </section>
    <section className="grid3">
      <Shortcut title="Tambah materi" body="Tulis atau tempel catatan belajar." onClick={()=>setTab("Materi")}/>
      <Shortcut title="Rekam penjelasan" body="Simpan audio dan ubah menjadi transcript." onClick={()=>setTab("Rekam")}/>
      <Shortcut title="Tanya database" body="Gunakan AI hanya dengan sumber milikmu." onClick={()=>setTab("Tanya AI")}/>
    </section>
  </>
}
function Stat({n,t}:{n:number,t:string}){return <div><strong>{n}</strong><span>{t}</span></div>}
function Shortcut({title,body,onClick}:any){return <article className="card shortcut"><h3>{title}</h3><p className="muted">{body}</p><button className="primary" onClick={onClick}>Buka</button></article>}

function Materials({user,materials,onChange}:{user:User,materials:Material[],onChange:()=>void}){
  const [title,setTitle]=useState(""); const [category,setCategory]=useState(""); const [content,setContent]=useState("");
  const [search,setSearch]=useState(""); const [busy,setBusy]=useState(false);
  const filtered=materials.filter(m=>(m.title+" "+m.category+" "+m.content).toLowerCase().includes(search.toLowerCase()));

  async function save(e:React.FormEvent){
    e.preventDefault(); setBusy(true);
    const {error}=await supabase.from("materials").insert({user_id:user.id,title,category,content,source_type:"manual"});
    setBusy(false); if(error) return alert(error.message);
    setTitle("");setCategory("");setContent("");onChange();
  }
  async function remove(id:string){
    if(!confirm("Hapus MÄS‘!6