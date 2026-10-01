"use client";
import { useEffect, useRef, useState } from "react";
import { parseCsv, fitLinear, invertCalibration } from "@/lib/dataLab";

export default function DataLab() {
  const [text, setText] = useState("konsentrasi,respons\n1,0.061\n2,0.109\n3,0.161\n4,0.209\n5,0.261");
  const [data, setData] = useState<ReturnType<typeof parseCsv> | null>(null), [fit, setFit] = useState<ReturnType<typeof fitLinear> | null>(null);
  const [x, setX] = useState(0), [y, setY] = useState(1), [unit, setUnit] = useState("mg/L"), [response, setResponse] = useState("0.26"), [dilution, setDilution] = useState("1");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [sample, setSample] = useState<any>(null);
  const host = useRef<HTMLDivElement>(null), chart = useRef<any>(null), generation = useRef(0);
  useEffect(() => () => { generation.current++; chart.current?.dispose(); }, []);
  useEffect(()=>{generation.current++;setFit(null);setSample(null);chart.current?.clear();},[text,x,y,unit]);
  useEffect(()=>{setSample(null);},[response,dilution]);
  async function draw() {
    const id = ++generation.current; setBusy(true); setFit(null); setSample(null); setMessage("");
    try {
      const table = parseCsv(text); setData(table);
      if (x === y) throw new Error("Pilih kolom X dan Y yang berbeda.");
      const points: [number, number][] = table.rows.map(row => {
        if (!row[x]?.trim() || !row[y]?.trim()) throw new Error("Data kosong harus diperbaiki; tidak dianggap nol.");
        return [Number(row[x]), Number(row[y])];
      });
      const fitted = fitLinear(points);
      const echarts = await import("echarts");
      if (id !== generation.current || !host.current) return;
      chart.current?.dispose(); chart.current = echarts.init(host.current, undefined, { renderer: "svg" });
      chart.current.setOption({ tooltip: { trigger: "item", renderMode: "richText" }, xAxis: { name: table.headers[x] + " (" + unit + ")", type: "value" }, yAxis: { name: table.headers[y], type: "value" }, series: [
        { type: "scatter", data: points, name: "Data asli" },
        { type: "line", data: [[fitted.min, fitted.slope * fitted.min + fitted.intercept], [fitted.max, fitted.slope * fitted.max + fitted.intercept]], name: "Regresi linear", symbol: "none" },
      ] });
      setFit(fitted); setMessage("Grafik dihitung dari data, bukan dibuat oleh AI.");
    } catch (e: any) { setMessage(e.message || "Data tidak dapat dianalisis."); }
    finally { setBusy(false); }
  }
  async function queryTable() {
    if (busy) return; setBusy(true); let db: any, connection: any, worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    try {
      parseCsv(text);
      const duckdb = await import("@duckdb/duckdb-wasm");
      const bundle = await duckdb.selectBundle({ mvp: { mainModule: "/learning-assets/duckdb-mvp.wasm", mainWorker: "/learning-assets/duckdb-browser-mvp.worker.js" }, eh: { mainModule: "/learning-assets/duckdb-eh.wasm", mainWorker: "/learning-assets/duckdb-browser-eh.worker.js" } });
      worker = new Worker(new URL(bundle.mainWorker!, location.origin)); db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
      const task = async () => {
        await db.instantiate(new URL(bundle.mainModule, location.origin).href);
        await db.registerFileText("study.csv", text); connection = await db.connect();
        return connection.query("SELECT count(*) AS rows FROM read_csv_auto('study.csv', header=true)");
      };
      const result: any = await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Batas waktu pemuatan 30 detik terlampaui")), 30_000); })]);
      setMessage("DuckDB membaca " + String(result.toArray()[0].rows) + " baris secara lokal.");
    } catch (e: any) { setMessage("DuckDB tidak tersedia: " + e.message + ". Grafik lokal tetap dapat digunakan."); }
    finally { clearTimeout(timer); worker?.terminate(); setBusy(false); }
  }
  return <section className="learningPanel"><h2>Laboratorium data</h2><p>Contoh awal hanya data latihan. Masukkan standar dan respons pengukuranmu sendiri.</p>
    <label>CSV (header, pemisah koma; desimal memakai titik)<textarea rows={7} value={text} onChange={e => setText(e.target.value)} /></label>
    <input aria-label="Unggah CSV" type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 5_000_000) { setMessage("CSV maksimal 5 MB."); return; } setText(await file.text()); setFit(null); setData(null); }} />
    <button onClick={() => { try { setData(parseCsv(text)); setFit(null); } catch (e: any) { setMessage(e.message); } }}>Baca kolom</button>
    <div className="learningRow"><label>X<select value={x} onChange={e => setX(Number(e.target.value))}>{(data?.headers || ["Kolom 1", "Kolom 2"]).map((v, i) => <option key={i} value={i}>{v}</option>)}</select></label>
      <label>Y<select value={y} onChange={e => setY(Number(e.target.value))}>{(data?.headers || ["Kolom 1", "Kolom 2"]).map((v, i) => <option key={i} value={i}>{v}</option>)}</select></label>
      <label>Satuan X<input value={unit} onChange={e => setUnit(e.target.value)} /></label><button disabled={busy} onClick={() => void draw()}>Buat grafik + regresi</button><button disabled={busy} onClick={() => void queryTable()}>Baca tabel dengan DuckDB</button></div>
    <p role="status">{busy ? "Memproses lokal…" : message}</p><div ref={host} className="dataChart" />
    {fit && <><p>Y = {fit.slope.toPrecision(6)} × X + {fit.intercept.toPrecision(6)} · R² = {fit.r2?.toPrecision(6) ?? "tidak terdefinisi"} · SD residual = {fit.residualSd.toPrecision(6)}</p>
      <p>Residual: {fit.residuals.slice(0, 30).map(v => v.toPrecision(4)).join(", ")}{fit.residuals.length > 30 && " …"}. Periksa pola dan satuan; R² tinggi bukan validasi metode.</p>
      <div className="learningRow"><label>Respons sampel<input value={response} onChange={e => setResponse(e.target.value)} /></label><label>Faktor pengenceran<input value={dilution} onChange={e => setDilution(e.target.value)} /></label><button onClick={() => { try { if (!response.trim() || !dilution.trim()) throw new Error("Isi respons dan pengenceran."); setSample(invertCalibration(fit, Number(response), Number(dilution))); } catch (e: any) { setMessage(e.message); } }}>Hitung sampel</button></div>
      {sample && <p>Perkiraan {sample.measured.toPrecision(6)} {unit}; setelah faktor pengenceran: {sample.corrected.toPrecision(6)} {unit}. {sample.extrapolated && "PERINGATAN: di luar rentang standar; jangan dianggap hasil tervalidasi."}</p>}
      <button onClick={() => { const a = document.createElement("a"); a.href = chart.current.getDataURL({ type: "svg" }); a.download = "grafik-kalibrasi.svg"; a.click(); }}>Unduh grafik SVG</button>
    </>}
  </section>;
}
