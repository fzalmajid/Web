"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { loadRDKit } from "@/lib/rdkitBrowser";

export default function MoleculeLab() {
  const [name, setName] = useState("aspirin"), [smiles, setSmiles] = useState("CC(=O)OC1=CC=CC=C1C(=O)O");
  const [result, setResult] = useState<any>(null), [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  const [pdb,setPdb]=useState("1CRN"),[hasMol,setHasMol]=useState(false),[protein,setProtein]=useState("");
  const canvas = useRef<HTMLCanvasElement>(null), host = useRef<HTMLDivElement>(null), viewer = useRef<any>(null), molblock = useRef("");
  const module = useRef<any>(null), sequence = useRef(0);
  useEffect(() => () => { sequence.current++; viewer.current?.clear(); }, []);
  async function render(input: string, dimensional = false, id = sequence.current) {
    molblock.current="";setHasMol(false);setProtein("");
    if (!module.current) {
      module.current = await loadRDKit();
    }
    if(id!==sequence.current)return;
    const mol = module.current.get_mol(input);
    if (!mol || !mol.is_valid()) { mol?.delete(); throw new Error("Struktur molekul tidak valid."); }
    try { molblock.current = mol.get_molblock();setHasMol(true); if (canvas.current) mol.draw_to_canvas(canvas.current, 520, 300); }
    finally { mol.delete(); }
    const three = await import("3dmol");
    if(id!==sequence.current)return;
    if (host.current) {
      viewer.current ??= three.createViewer(host.current, { backgroundColor: "white" });viewer.current.removeAllModels();
      viewer.current.addModel(molblock.current, "mol"); viewer.current.setStyle({}, { stick: {}, sphere: { scale: 0.22 } }); viewer.current.zoomTo(); viewer.current.render();
    }
    setStatus(dimensional ? "Koordinat 3D dari PubChem. Periksa identitas dan stereokimia." : "Struktur 2D. Tampilan berputar tidak berarti koordinat 3D tervalidasi.");
  }
  async function search() {
    if (busy) return; setBusy(true); const id = ++sequence.current; setResult(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Login terlebih dahulu.");
      const response = await fetch("/api/molecules?name=" + encodeURIComponent(name), { headers: { Authorization: "Bearer " + session.access_token } });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      const structure = await fetch(body.sdf2d, { signal: AbortSignal.timeout(8000) }); if (!structure.ok) throw new Error("Struktur 2D tidak tersedia.");
      const sdf = await structure.text(); if (id !== sequence.current) return;
      await render(sdf,false,id); if(id===sequence.current)setResult(body);
    } catch (e: any) { if(id===sequence.current){setHasMol(false);setStatus(e.message || "Gagal memuat molekul.");} } finally { if(id===sequence.current)setBusy(false); }
  }
  async function loadProtein(){const code=pdb.trim().toUpperCase();if(!/^[0-9][A-Z0-9]{3}$/.test(code)){setStatus("Masukkan ID PDB empat karakter, misalnya 1CRN.");return;}const id=++sequence.current;setBusy(true);setResult(null);setHasMol(false);molblock.current="";
    try{const res=await fetch("https://files.rcsb.org/download/"+code+".pdb",{signal:AbortSignal.timeout(12000)});if(!res.ok||Number(res.headers.get("content-length"))>8_000_000)throw new Error("PDB tidak tersedia atau terlalu besar.");const text=await res.text();if(text.length>8_000_000)throw new Error("PDB maksimal 8 MB.");const three=await import("3dmol");if(id!==sequence.current||!host.current)return;viewer.current??=three.createViewer(host.current,{backgroundColor:"white"});viewer.current.removeAllModels();viewer.current.addModel(text,"pdb");viewer.current.setStyle({},{cartoon:{color:"spectrum"}});viewer.current.zoomTo();viewer.current.render();setProtein(code);setStatus("Struktur eksperimental RCSB PDB; resolusi, metode, dan ligan tersedia di halaman sumber. Bukan simulasi dinamika protein.");canvas.current?.getContext("2d")?.clearRect(0,0,520,300);}catch(e:any){if(id===sequence.current)setStatus(e.message);}finally{if(id===sequence.current)setBusy(false);}}
  return <section className="learningPanel"><h2>Laboratorium molekul</h2><p>Untuk belajar struktur, bukan prediksi keamanan atau rekomendasi penggunaan senyawa.</p>
    <div className="learningRow"><label>Nama senyawa<input value={name} onChange={e => setName(e.target.value)} /></label><button disabled={busy} onClick={() => void search()}>Cari PubChem</button></div>
    <div className="learningRow"><label>SMILES lokal<input value={smiles} onChange={e => {setSmiles(e.target.value);setHasMol(false);}} /></label><button disabled={busy} onClick={async () => { const id=++sequence.current;setBusy(true); setResult(null); try { await render(smiles,false,id); } catch (e: any) { setStatus(e.message); } finally { setBusy(false); } }}>Tampilkan SMILES</button></div>
    <div className="learningRow"><label>ID protein RCSB PDB<input value={pdb} onChange={e=>setPdb(e.target.value)}/></label><button disabled={busy} onClick={()=>void loadProtein()}>Buka protein 3D</button>{protein&&<a href={"https://www.rcsb.org/structure/"+protein} target="_blank" rel="noreferrer">Lihat paper, metode & struktur {protein}</a>}</div>
    <p role="status">{busy ? "Memuat alat kimia…" : status}</p><canvas ref={canvas} width={520} height={300} className="moleculeCanvas" /><div ref={host} className="moleculeViewer" />
    {result && <><p>{result.properties.MolecularFormula} · Mr {result.properties.MolecularWeight} · {result.properties.IUPACName}</p><a href={result.source} target="_blank" rel="noreferrer">Sumber PubChem dan ketentuan data</a>
      <button disabled={busy} onClick={async () => { setBusy(true); try { const res = await fetch(result.sdf3d, { signal: AbortSignal.timeout(8000) }); if (!res.ok) throw new Error("Koordinat 3D tidak tersedia untuk senyawa ini."); await render(await res.text(), true); } catch (e: any) { setStatus(e.message); } finally { setBusy(false); } }}>Muat koordinat 3D</button></>}
    {hasMol && !busy ? <><a className="molDownload" href={"data:chemical/x-mdl-molfile;charset=utf-8," + encodeURIComponent(molblock.current)} download="molekul.mol">Unduh .mol</a>
      <details><summary>Teks MOL — cadangan bila browser memblokir unduhan</summary><p>Salin seluruh teks berikut dan simpan sebagai molekul.mol. Ini koordinat struktur yang sedang ditampilkan.</p><textarea aria-label="Teks MOL" readOnly rows={8} value={molblock.current} /></details></>
      : <button disabled>Unduh .mol</button>}
  </section>;
}
