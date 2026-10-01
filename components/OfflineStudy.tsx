"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { clearLearningCache, learningStore, type CachedCard } from "@/lib/learningStore";
import { queueOfflineReview, syncOfflineReviews } from "@/lib/offlineReview";
import { fsrsDueLabel, type FsrsRating } from "@/lib/fsrsScheduling";
import { parseOcclusion } from "./ImageOcclusion";
export default function OfflineStudy() {
  const [account, setAccount] = useState(""), [cards, setCards] = useState<CachedCard[]>([]), [notes, setNotes] = useState<{ id: string; title: string; text: string }[]>([]);
  const [saved, setSaved] = useState(""), [message, setMessage] = useState(""), [flipped, setFlipped] = useState(false), [busy, setBusy] = useState(false);
  async function load() {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) { setAccount(""); setCards([]); setNotes([]); return; }
    setAccount(session.user.id);
    const data = await learningStore.snapshots.get(session.user.id);
    setCards(data?.cards || []); setNotes(data?.notes || []); setSaved(data?.savedAt || "");
  }
  useEffect(() => { void load().catch(e => setMessage(e.message)); }, []);
  async function prepare() {
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Login terlebih dahulu.");
      const [cards, notes] = await Promise.all([
        supabase.from("flashcards").select("*").eq("user_id", session.user.id).limit(2000),
        supabase.from("knowledge_entries").select("id,title,content").eq("user_id", session.user.id).eq("source_type", "manual").limit(300),
      ]);
      if (cards.error || notes.error) throw new Error(cards.error?.message || notes.error?.message);
      const data = { account: session.user.id, savedAt: new Date().toISOString(), cards: cards.data || [], notes: (notes.data || []).map(row => ({ id: row.id, title: row.title, text: row.content || "" })) };
      if (JSON.stringify(data).length > 5_000_000) throw new Error("Pilihan offline terlalu besar (maksimal 5 MB). Kurangi catatan atau kartu dahulu.");
      if (await learningStore.reviews.where("account").equals(session.user.id).count()) throw new Error("Sinkronkan atau tangani review tertunda sebelum memperbarui snapshot.");
      await learningStore.snapshots.put(data); await load();
      localStorage.setItem("rb-offline-enabled","1");
      if ("serviceWorker" in navigator) await navigator.serviceWorker.register("/learning-sw.js", { scope: "/" });
      setMessage("Snapshot disimpan di perangkat ini. Buka /offline satu kali saat online untuk menyiapkan halaman dan berkas tampilannya. Gambar kartu belum tersedia offline; review gambar hanya saat online.");
    } catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
  }
  const card = cards.find(item => !parseOcclusion(item.front));
  return <section className="learningPanel"><h2>Belajar offline</h2><p>Opt-in, hanya catatan manual dan maksimal 2.000 kartu milik akun sendiri. Tidak menyimpan token, audio, PDF, atau jawaban API dalam cache layanan. Data lokal dapat dibaca pengguna perangkat ini.</p>
    <div className="learningRow"><button disabled={busy} onClick={() => void prepare()}>Siapkan offline</button><a href="/offline">Buka halaman offline</a><button disabled={busy} onClick={async () => { setBusy(true); try { const result = await syncOfflineReviews(); setMessage(`${result.synced} review tersinkron; ${result.conflicts} konflik tidak ditimpa. Jika ada konflik, buka kartu terbaru online; hapus cache hanya setelah memutuskan membuang antrean lokal.`); await load(); } catch (e: any) { setMessage(e.message); } finally { setBusy(false); } }}>Sinkronkan review</button>
    <button disabled={busy} onClick={async () => { if (!confirm("Hapus semua catatan, anotasi, bookmark dan antrean review lokal di perangkat ini? Data cloud tidak dihapus.")) return; await clearLearningCache(); await load(); setMessage("Cache lokal dihapus; data cloud tetap ada."); }}>Hapus cache lokal</button></div>
    <p role="status">{message}</p>{saved && <p>Snapshot: {new Date(saved).toLocaleString("id-ID")}</p>}
    {!account && <p><a href="/">Login untuk menggunakan data akunmu.</a></p>}
    {card && <><button className="offlineCard" onClick={() => setFlipped(!flipped)}>{flipped ? card.back : card.front}</button><p>{fsrsDueLabel(card)}</p>
    {flipped && <div className="learningRow">{["Lupa", "Sulit", "Baik", "Mudah"].map((label, i) => <button key={label} disabled={busy} onClick={async () => { setBusy(true); try { await queueOfflineReview(account, card, (i + 1) as FsrsRating); const updated=(await learningStore.snapshots.get(account))!.cards.find(item=>item.id===card.id)!; setCards(items=>[...items.filter(item=>item.id!==card.id),updated]); setFlipped(false); setMessage("Review masuk antrean lokal; belum tersinkron ke cloud."); } catch (e: any) { setMessage(e.message); } finally { setBusy(false); } }}>{label}</button>)}</div>}</>}
    <p>{cards.length} kartu; kartu gambar tidak ditampilkan tanpa akses gambar online.</p>{notes.map(note => <details key={note.id}><summary>{note.title}</summary><p style={{ whiteSpace: "pre-wrap" }}>{note.text}</p></details>)}
  </section>;
}
