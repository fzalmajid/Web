"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { normalizeDoi } from "@/lib/referenceMetadata";
import { publicUrl } from "@/lib/researchLinks";

export default function PaperExplorer({ doi: initial = "" }: { doi?: string }) {
  const [doi, setDoi] = useState(initial), [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0), graph = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  useEffect(() => () => { sequence.current++; cyRef.current?.destroy(); }, []);
  async function lookup(value = doi, connections = false) {
    const normalized = normalizeDoi(value);
    if (!normalized) { setError("Masukkan DOI yang valid."); return; }
    const id = ++sequence.current; setBusy(true); setError(""); setResult(null);
    cyRef.current?.destroy(); cyRef.current = null;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("Login terlebih dahulu.");
      const response = await fetch("/api/papers?doi=" + encodeURIComponent(normalized) + (connections ? "&graph=1" : ""), { headers: { Authorization: "Bearer " + data.session.access_token } });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      if (id !== sequence.current) return;
      setDoi(normalized); setResult(body);
    } catch (e: any) { if (id === sequence.current) setError(e.message || "Gagal mencari paper."); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  async function showGraph() {
    if (!graph.current || !result?.connections) return;
    const id = sequence.current;
    const { default: cytoscape } = await import("cytoscape");
    if (id !== sequence.current || !graph.current) return;
    cyRef.current?.destroy();
    cyRef.current = cytoscape({ container: graph.current, elements: [
      { data: { id: result.paper.doi, label: "Paper utama" } },
      ...Array.from(new Set<string>(result.connections.edges.map((edge: any) => edge.doi))).map(doi => ({ data: { id: doi, label: doi } })),
      ...result.connections.edges.map((edge: any, index: number) => ({ data: { id: "edge-" + index, source: edge.direction === "references" ? result.paper.doi : edge.doi, target: edge.direction === "references" ? edge.doi : result.paper.doi } })),
    ], layout: { name: "cose", animate: false }, style: [
      { selector: "node", style: { label: "data(label)", "font-size": 10, "background-color": "#568b78" } },
      { selector: "edge", style: { "target-arrow-shape": "triangle", "curve-style": "bezier", "line-color": "#aab6bd", "target-arrow-color": "#aab6bd" } },
    ] });
    cyRef.current.on("tap", "node", (event: any) => { const next = event.target.id(); if (next !== result.paper.doi) void lookup(next); });
  }
  return <section className="learningPanel" aria-label="Paper dan akses terbuka">
    <form onSubmit={e => { e.preventDefault(); void lookup(); }} className="learningRow">
      <label>DOI paper<input value={doi} onChange={e => setDoi(e.target.value)} placeholder="10.xxxx/... atau tautan DOI" /></label>
      <button disabled={busy}>Cari PDF legal</button>
      <button type="button" disabled={busy} onClick={() => void lookup(doi, true)}>Jelajahi sitasi</button>
    </form>
    {busy && <p role="status">Mencari sumber publik…</p>}{error && <p role="alert">{error}</p>}
    {result && <><h3>{result.paper.title}</h3><div className="learningRow">
      <a href={"https://doi.org/" + result.paper.doi} target="_blank" rel="noreferrer">Buka paper</a>
      {publicUrl(result.paper.pdf) && <a href={result.paper.pdf} target="_blank" rel="noreferrer">PDF open-access</a>}
      {publicUrl(result.paper.landing) && <a href={result.paper.landing} target="_blank" rel="noreferrer">Halaman sumber</a>}
    </div><p>Lisensi: {result.paper.license} · Penyedia: {result.paper.provider}</p><p>{result.paper.warning}</p>
    {result.connections && <><p>Hubungan sitasi bukan bukti dukungan atau kualitas. Maksimal 30 paper per arah. {result.connections.partial && "Sebagian layanan tidak tersedia; daftar dapat tidak lengkap."}</p>
      <button onClick={() => void showGraph()}>Tampilkan peta interaktif</button><div ref={graph} className="citationGraph" />
      {!result.connections.edges.length && <p>Belum ada hubungan sitasi yang dapat ditampilkan.</p>}
      {result.connections.edges.map((edge: any) => <div className="learningRow" key={edge.direction + edge.doi}><span>{edge.direction === "references" ? "Dirujuk" : "Mengutip"}</span><a href={edge.url} target="_blank" rel="noreferrer">{edge.doi}</a><button onClick={() => void lookup(edge.doi)}>Cari PDF</button></div>)}
    </> }</>}
  </section>;
}
