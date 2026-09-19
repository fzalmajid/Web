import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { cleanJsonText, geminiGenerate } from "@/lib/gemini";
import { aiModeInstruction, aiQuotaError, consumeAiCredits, normalizeAiMode } from "@/lib/aiQuota";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

function collectSubtreeIds(
  nodes: Array<{ id: string; parent_id: string | null }>,
  rootId: string
) {
  const result = [rootId];
  let cursor = 0;
  while (cursor < result.length) {
    const parent = result[cursor++];
    for (const node of nodes) {
      if (node.parent_id === parent && !result.includes(node.id)) result.push(node.id);
    }
  }
  return result;
}

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const token = bearer(req);
  if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

  const supabase = createServerSupabase(token);
  let studyNodeId = "";

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const body = await req.json();
    studyNodeId = String(body.studyNodeId || "");
    const sourceNodeIds = Array.isArray(body.sourceNodeIds)
      ? Array.from(new Set(body.sourceNodeIds.map((value: unknown) => String(value)).filter(Boolean)))
      : [];
    const aiMode = normalizeAiMode(body.aiMode);

    if (!studyNodeId || !sourceNodeIds.length) {
      return NextResponse.json({ error: "Pilih minimal satu Database untuk Study." }, { status: 400 });
    }
    if (aiMode === "simple") {
      return NextResponse.json(
        { error: "Penyusunan Study terarah membutuhkan Gemini 3.6. Pilih Instant, Medium, atau High." },
        { status: 400 }
      );
    }

    const { data: studyNode, error: studyError } = await supabase
      .from("study_nodes")
      .select("id,parent_id,title,node_type")
      .eq("id", studyNodeId)
      .single();

    if (studyError || !studyNode || studyNode.node_type !== "study") {
      return NextResponse.json({ error: "Study tidak ditemukan." }, { status: 404 });
    }
    if (!studyNode.parent_id) {
      return NextResponse.json({ error: "Study harus dibuat di dalam Materi/Submateri." }, { status: 400 });
    }

    const { data: allNodes, error: nodesError } = await supabase
      .from("study_nodes")
      .select("id,parent_id,title,node_type");

    if (nodesError) throw nodesError;

    const allowedIds = new Set(collectSubtreeIds(allNodes || [], studyNode.parent_id));
    const selectedNodes = (allNodes || []).filter((node: any) => sourceNodeIds.includes(node.id));

    if (
      selectedNodes.length !== sourceNodeIds.length ||
      selectedNodes.some((node: any) => node.node_type !== "database" || !allowedIds.has(node.id))
    ) {
      return NextResponse.json(
        { error: "Ada Database yang tidak berada di dalam cabang materi Study ini." },
        { status: 400 }
      );
    }

    const { data: entries, error: entriesError } = await supabase
      .from("knowledge_entries")
      .select("id,node_id,title,category,content")
      .in("node_id", sourceNodeIds)
      .order("created_at", { ascending: true });

    if (entriesError) throw entriesError;
    if (!entries?.length) {
      return NextResponse.json({ error: "Database yang dipilih belum memiliki isi." }, { status: 400 });
    }

    const modeLimit = aiMode === "high" ? 140000 : aiMode === "medium" ? 100000 : 70000;
    const perEntryLimit = aiMode === "high" ? 12000 : aiMode === "medium" ? 9000 : 6500;
    const titles = new Map(selectedNodes.map((node: any) => [node.id, node.title]));
    const contextParts: string[] = [];
    let used = 0;

    for (const entry of entries) {
      if (used >= modeLimit) break;
      const dbTitle = titles.get(entry.node_id) || "Database";
      const bodyText = String(entry.content || "").slice(0, perEntryLimit);
      const part = `[DATABASE: ${dbTitle} | ${entry.title || "Materi"}]
${bodyText}`;
      contextParts.push(part);
      used += part.length;
    }

    const sourceContext = contextParts.join("\n\n---\n\n");
    if (!sourceContext.trim()) {
      return NextResponse.json({ error: "Tidak ada isi Database yang dapat dipakai." }, { status: 400 });
    }

    const { data: pathRow, error: pathError } = await supabase
      .from("study_paths")
      .upsert(
        {
          user_id: userData.user.id,
          node_id: studyNodeId,
          source_node_ids: sourceNodeIds,
          ai_mode: aiMode,
          title: studyNode.title,
          overview: "",
          status: "processing",
          error_message: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "node_id,user_id" }
      )
      .select("id")
      .single();

    if (pathError) throw pathError;

    const aiUsage = await consumeAiCredits(supabase, "study", aiMode);
    if (!aiUsage.allowed) {
      await supabase
        .from("study_paths")
        .update({ status: "error", error_message: aiQuotaError(aiUsage).error })
        .eq("id", pathRow.id);
      return NextResponse.json(aiQuotaError(aiUsage), { status: 429 });
    }

    const unitRange =
      aiMode === "high"
        ? "6-10"
        : aiMode === "medium"
          ? "5-8"
          : "4-6";

    const raw = await geminiGenerate(
      [{
        text: `NAMA STUDY:
${studyNode.title}

SUMBER DATABASE YANG DIPILIH:
${sourceContext}

Susun jalur belajar dari konsep paling mendasar ke yang lebih kompleks.
${aiModeInstruction(aiMode)}

Keluarkan JSON valid tanpa markdown:
{
  "overview": "gambaran singkat urutan belajar",
  "units": [
    {
      "unit_level": "chapter",
      "title": "...",
      "teaching_text": "...",
      "recall_question": "...",
      "recall_choices": ["A","B","C","D"],
      "recall_correct_answer": "...",
      "recall_explanation": "..."
    }
  ]
}

Aturan wajib:
- Gunakan HANYA SUMBER DATABASE di atas. Jangan gunakan internet atau pengetahuan di luar sumber.
- Tentukan sendiri kompleksitas materi:
  - materi sederhana boleh dipecah per BAB saja (unit_level="chapter");
  - materi kompleks boleh dipecah lebih kecil menjadi SUBBAB (unit_level="subchapter").
- Buat sekitar ${unitRange} unit; boleh lebih sedikit jika materi memang pendek.
- Urutkan prerequisite dahulu sebelum materi lanjutan.
- teaching_text adalah ringkasan pengajaran yang cukup untuk belajar unit itu, bukan sekadar daftar judul.
- Pertahankan istilah penting, definisi, perbandingan, angka, aturan, dan hubungan sebab-akibat dari sumber.
- Jangan mengulang isi yang sama pada banyak unit.
- Setiap unit memiliki tepat 1 recall_question pilihan ganda dengan 4 pilihan.
- recall_question hanya menguji materi yang SUDAH diajarkan pada unit tersebut atau unit sebelumnya.
- recall_correct_answer harus sama persis dengan salah satu recall_choices.
- recall_explanation singkat dan membantu mengingat konsep.
- Jangan bocorkan materi unit-unit berikutnya di unit sebelumnya.`,
      }],
      "Anda menyusun kurikulum belajar bertahap yang ketat pada sumber pengguna. Jangan mengarang fakta."
    );

    const parsed = JSON.parse(cleanJsonText(raw));
    const rawUnits = Array.isArray(parsed.units) ? parsed.units : [];

    const units = rawUnits
      .map((unit: any, index: number) => {
        const choices = Array.isArray(unit.recall_choices)
          ? unit.recall_choices.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 4)
          : [];
        const correct = String(unit.recall_correct_answer || "").trim();
        return {
          user_id: userData.user.id,
          study_path_id: pathRow.id,
          position: index + 1,
          unit_level: unit.unit_level === "subchapter" ? "subchapter" : "chapter",
          title: String(unit.title || `Bagian ${index + 1}`).trim(),
          teaching_text: String(unit.teaching_text || "").trim(),
          recall_question: String(unit.recall_question || "").trim(),
          recall_choices: choices,
          recall_correct_answer: correct,
          recall_explanation: String(unit.recall_explanation || "").trim(),
          is_unlocked: index === 0,
          completed_at: null,
        };
      })
      .filter(
        (unit: any) =>
          unit.title &&
          unit.teaching_text &&
          unit.recall_question &&
          unit.recall_choices.length === 4 &&
          unit.recall_choices.includes(unit.recall_correct_answer)
      );

    if (!units.length) {
      throw new Error("Gemini belum berhasil menyusun unit Study yang valid.");
    }

    const { error: deleteError } = await supabase
      .from("study_units")
      .delete()
      .eq("study_path_id", pathRow.id);
    if (deleteError) throw deleteError;

    const { error: insertError } = await supabase.from("study_units").insert(units);
    if (insertError) throw insertError;

    const overview = String(parsed.overview || "").trim();
    const { error: readyError } = await supabase
      .from("study_paths")
      .update({
        source_node_ids: sourceNodeIds,
        ai_mode: aiMode,
        overview,
        status: "ready",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pathRow.id);
    if (readyError) throw readyError;

    return NextResponse.json({
      pathId: pathRow.id,
      overview,
      unitCount: units.length,
      aiUsage,
    });
  } catch (error: any) {
    if (studyNodeId) {
      await supabase
        .from("study_paths")
        .update({
          status: "error",
          error_message: error.message || "Gagal menyusun Study.",
          updated_at: new Date().toISOString(),
        })
        .eq("node_id", studyNodeId);
    }

    return NextResponse.json(
      { error: error.message || "Gagal menyusun Study." },
      { status: 500 }
    );
  }
}
