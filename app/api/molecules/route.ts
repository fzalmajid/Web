import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { boundedJson } from "@/lib/publicResearch";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (!token || !(await createServerSupabase(token).auth.getUser()).data.user) return NextResponse.json({ error: "Login terlebih dahulu." }, { status: 401 });
  const name = req.nextUrl.searchParams.get("name")?.trim() || "";
  if (!name || name.length > 160) return NextResponse.json({ error: "Nama senyawa tidak valid." }, { status: 400 });
  try {
    const ids = await boundedJson("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" + encodeURIComponent(name) + "/cids/JSON", { next: { revalidate: 86400 } });
    const cid = Number(ids.IdentifierList?.CID?.[0]); if (!Number.isSafeInteger(cid) || cid <= 0) throw new Error("Senyawa tidak ditemukan.");
    const props = await boundedJson(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`, { next: { revalidate: 86400 } });
    return NextResponse.json({ cid, properties: props.PropertyTable?.Properties?.[0] || {}, source: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`, image2d:`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/PNG?record_type=2d`, sdf2d: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=2d`, sdf3d: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d` }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "PubChem belum dapat menemukan senyawa atau sedang membatasi permintaan. Coba nama lain; input SMILES lokal tetap tersedia." }, { status: 503 }); }
}
