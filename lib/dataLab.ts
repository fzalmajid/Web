export function parseCsv(text: string) {
  if (text.length > 5_000_000) throw new Error("CSV maksimal 5 MB untuk grafik lokal.");
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ""; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); if (row.some(v => v.trim())) rows.push(row); row = []; field = "";
    } else field += c;
    if (rows.length > 20000 || row.length > 50) throw new Error("Batasi CSV hingga 20.000 baris dan 50 kolom.");
  }
  if (quoted) throw new Error("Tanda kutip CSV belum ditutup.");
  row.push(field); if (row.some(v => v.trim())) rows.push(row);
  if (rows.length < 3) throw new Error("CSV perlu header dan sedikitnya dua baris data.");
  const headers = rows.shift()!.map(v => v.trim().replace(/^\uFEFF/, ""));
  if (headers.length > 50 || rows.some(r => r.length !== headers.length)) throw new Error("Jumlah kolom tidak konsisten.");
  return { headers, rows };
}
export function fitLinear(points: [number, number][]) {
  if (points.length < 3 || points.some(p => !p.every(Number.isFinite))) throw new Error("Perlu minimal tiga pasangan angka valid.");
  const n = points.length, mx = points.reduce((s, p) => s + p[0], 0) / n, my = points.reduce((s, p) => s + p[1], 0) / n;
  const xx = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  if (xx === 0) throw new Error("Nilai X tidak boleh semuanya sama.");
  const slope = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / xx, intercept = my - slope * mx;
  const residuals = points.map(p => p[1] - (slope * p[0] + intercept));
  const ss = residuals.reduce((s, r) => s + r * r, 0), yy = points.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  if (![slope,intercept,ss,yy].every(Number.isFinite)) throw new Error("Besaran angka melampaui rentang komputasi. Periksa satuan/data.");
  return { slope, intercept, r2: yy ? 1 - ss / yy : null, residuals, residualSd: Math.sqrt(ss / (n - 2)), min: Math.min(...points.map(p => p[0])), max: Math.max(...points.map(p => p[0])) };
}
export function invertCalibration(fit: ReturnType<typeof fitLinear>, response: number, dilution = 1) {
  if (!Number.isFinite(response) || !Number.isFinite(dilution) || dilution <= 0 || Math.abs(fit.slope) < 1e-12) throw new Error("Respons, faktor pengenceran, atau kemiringan tidak valid.");
  const measured = (response - fit.intercept) / fit.slope;
  if (![measured, measured*dilution].every(Number.isFinite)) throw new Error("Hasil melampaui rentang komputasi.");
  return { measured, corrected: measured * dilution, extrapolated: measured < fit.min || measured > fit.max };
}
