import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { geminiGenerateDetailed, parseJsonSafely, WHATSAPP_FORMAT_INSTRUCTION } from "@/lib/gemini";
import { modelPlanForSelection, selectionFromHeaders } from "@/lib/aiModels";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";
import { aiModeInstruction, aiQuotaError, checkAiCredits, finalizeAiCredits, normalizeAiMode, recordAiTokenUsage } from "@/lib/aiQuota";

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
    const sourceNodeIds: string[] = Array.isArray(body.sourceNodeIds)
      ? Array.from(
          new Set<string>(
            body.sourceNodeIds
              .map((value: unknown) => String(value))
              .filter((value: string) => Boolean(value))
          )
        )
      : [];
    const aiMode = normalizeAiMode(body.aiMode);
    const aiSelection = selectionFromHeaders(req.headers, "general", aiMode);
    const geminiAuth = geminiUserAuthFromHeaders(req.headers);
    const ownGemini = geminiAuth.ownGemini;
    const studyInstruction = String(body.studyInstruction || "").trim().slice(0, 2000);
    const allowedSourceKinds = new Set(["ai", "database", "web"]);
    const sourceKinds = Array.isArray(body.sourceKinds)
      ? Array.from(new Set(body.sourceKinds.map((value: unknown) => String(value)).filter((value: string) => allowedSourceKinds.has(value))))
      : ["database"];
    const activeSourceKinds = sourceKinds.length ? sourceKinds : ["database"];
    const useAiKnowledge = activeSourceKinds.includes("ai");
    const useDatabase = activeSourceKinds.includes("database");
    const useWeb = activeSourceKinds.includes("web");

    if (!studyNodeId) {
      return NextResponse.json({ error: "Study belum dipilih." }, { status: 400 });
    }
    if (useDatabase && !sourceNodeIds.length) {
      return NextResponse.json({ error: "Database aktif. Pilih minimal satu folder sumber untuk Study." }, { status: 400 });
    }
    if (aiMode === "simple") {
      return NextResponse.json(
        { error: "Penyusunan Study terarah membutuhkan model Gemini." },
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
    const selectedNodes = useDatabase
      ? (allNodes || []).filter((node: any) => sourceNodeIds.includes(node.id))
      : [];

    if (
      useDatabase &&
      (
        selectedNodes.length !== sourceNodeIds.length ||
        selectedNodes.some(
          (node: any) =>
            !["material", "submaterial", "database"].includes(node.node_type) ||
            !allowedIds.has(node.id)
        )
      )
    ) {
      return NextResponse.json(
        { error: "Ada folder sumber yang tidak berada di dalam cabang materi Study ini." },
        { status: 400 }
      );
    }

    const sourceScopeIds = useDatabase
      ? Array.from(
          new Set(
            sourceNodeIds.flatMap((sourceId) =>
              collectSubtreeIds(allNodes || [], sourceId)
            )
          )
        )
      : [];

    let entries: any[] = [];
    if (useDatabase) {
      const { data: entryRows, error: entriesError } = await supabase
        .from("knowledge_entries")
        .select("id,node_id,title,category,content,raw_content,source_type")
        .in("node_id", sourceScopeIds)
        .order("created_at", { ascending: true });

      if (entriesError) throw entriesError;
      entries = entryRows || [];
      if (!entries.length) {
        return NextResponse.json({ error: "Folder yang dipilih belum memiliki sumber RAW yang dapat dipakai." }, { status: 400 });
      }
    }

    const modeLimit = aiMode === "high" ? 140000 : aiMode === "medium" ? 100000 : 70000;
    const perEntryLimit = aiMode === "high" ? 12000 : aiMode === "medium" ? 9000 : 6500;
    const titles = new Map((allNodes || []).map((node: any) => [node.id, node.title]));
    const contextParts: string[] = [];
    let used = 0;

    for (const entry of entries) {
      if (used >= modeLimit) break;
      if (entry.source_type === "transcript") continue;
      const folderTitle = titles.get(entry.node_id) || "Folder";
      const bodyText = String(entry.raw_content || entry.content || "").slice(0, perEntryLimit);
      const part = `[FOLDER RAW: ${folderTitle} | ${entry.title || "Materi"}]
${bodyText}`;
      contextParts.push(part);
      used += part.length;
    }

    const sourceContext = contextParts.join("\n\n---\n\n");
    if (useDatabase && !sourceContext.trim()) {
      return NextResponse.json({ error: "Tidak ada isi folder RAW yang dapat dipakai." }, { status: 400 });
    }

    const sourcePolicy = [
      "SUMBER AKTIF: " + activeSourceKinds.join(", "),
      useDatabase
        ? "- Database AKTIF: gunakan RAW/ORIGINAL folder di bawah sebagai sumber utama dan jangan menggantinya dengan versi tertata."
        : "- Database TIDAK AKTIF: abaikan isi folder sebagai sumber fakta.",
      useAiKnowledge
        ? "- AI AKTIF: pengetahuan internal model boleh dipakai untuk melengkapi penjelasan."
        : "- AI TIDAK AKTIF: jangan gunakan pengetahuan internal model sebagai sumber fakta.",
      useWeb
        ? "- Web AKTIF: pencarian web boleh dipakai untuk informasi tambahan/relevan."
        : "- Web TIDAK AKTIF: jangan mencari atau memakai sumber web.",
    ].join("\n");

    const { data: pathRow, error: pathError } = await supabase
      .from("study_paths")
      .upsert(
        {
          user_id: userData.user.id,
          node_id: studyNodeId,
          source_node_ids: sourceNodeIds,
          ai_mode: aiMode,
          ai_model: aiSelection.model,
          ai_effort: aiSelection.effort,
          title: studyNode.title,
          overview: "",
          focus_instruction: studyInstruction,
          status: "processing",
          error_message: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "node_id,user_id" }
      )
      .select("id")
      .single();

    if (pathError) throw pathError;

    const preflight = ownGemini ? null : await checkAiCredits(supabase, "study", aiMode);
    if (preflight && !preflight.allowed) {
      await supabase
        .from("study_paths")
        .update({ status: "error", error_message: aiQuotaError(preflight).error })
        .eq("id", pathRow.id);
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    const unitRange =
      aiMode === "high"
        ? "6-10"
        : aiMode === "medium"
          ? "5-8"
          : "4-6";

    const geminiResult = await geminiGenerateDetailed(
      [{
        text: `NAMA STUDY:
${studyNode.title}

KONFIGURASI SUMBER:
${sourcePolicy}

DATABASE RAW/ORIGINAL:
${sourceContext || "(Database tidak aktif.)"}

INSTRUKSI KHUSUS USER:
${studyInstruction || "(Tidak ada. Pelajari seluruh materi relevan dari folder yang dipilih.)"}

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
- Patuhi KONFIGURASI SUMBER di atas. Jangan memakai sumber yang tidak diaktifkan user.
- Jika INSTRUKSI KHUSUS USER tidak kosong, jadikan instruksi itu sebagai fokus/scope utama Study.
- Jika instruksi user meminta fokus tertentu (misalnya hanya CPOB 2024), prioritaskan hanya materi yang sesuai fokus itu. Materi di luar fokus boleh disebut hanya bila benar-benar diperlukan sebagai konteks atau perbandingan agar fokus utama dipahami.
- Jika INSTRUKSI KHUSUS USER kosong, pelajari seluruh materi relevan dari folder terpilih secara proporsional.
- Jangan mengabaikan instruksi user selama masih dapat dipenuhi dari folder yang dipilih.
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
- Jangan bocorkan materi unit-unit berikutnya di unit sebelumnya.\n- ${WHATSAPP_FORMAT_INSTRUCTION}`,
      }],
      "Anda menyusun kurikulum belajar bertahap. Patuhi sumber AI / Database / Web yang diaktifkan user dan jangan memakai sumber yang dinonaktifkan.",
      {
      models: modelPlanForSelection(aiSelection.model, aiMode, "standard"),
      effort: aiSelection.effort,
      responseMimeType: "application/json",
      maxOutputTokens: aiMode === "high" ? 24576 : aiMode === "medium" ? 18432 : 14336,
      googleSearch: useWeb,
      apiKey: geminiAuth.apiKey,
      accessToken: geminiAuth.accessToken,
      projectId: geminiAuth.projectId,
    }
    );
    await recordAiTokenUsage(supabase, geminiResult.usage, geminiResult.model, geminiAuth.provider);
    const raw = geminiResult.text;

    let parsed: any;
    try {
      parsed = parseJsonSafely(raw);
    } catch {
      const repair = await geminiGenerateDetailed(
        [{
          text: `Perbaiki output JSON berikut menjadi JSON valid.
Pertahankan semua unit yang lengkap.
Jika unit terakhir terpotong/tidak lengkap, buang hanya unit terakhir itu.
Jangan menambahkan fakta atau unit baru.
Keluarkan JSON valid saja, tanpa markdown.

OUTPUT RUSAK:
${raw.slice(0, 50000)}`,
        }],
        "Anda hanya memperbaiki sintaks JSON tanpa menambah isi baru.",
        {
          models: modelPlanForSelection(aiSelection.model, aiMode, "standard"),
          effort: "low",
          responseMimeType: "application/json",
          maxOutputTokens: 16384,
          apiKey: geminiAuth.apiKey,
          accessToken: geminiAuth.accessToken,
          projectId: geminiAuth.projectId,
        }
      );
      await recordAiTokenUsage(supabase, repair.usage, repair.model, geminiAuth.provider);
      try {
        parsed = parseJsonSafely(repair.text);
      } catch {
        throw new Error("AI belum berhasil menghasilkan struktur Study yang lengkap. Coba lagi; folder dan pilihan Study tetap tersimpan.");
      }
    }

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
        ai_model: aiSelection.model,
        ai_effort: aiSelection.effort,
        overview,
        focus_instruction: studyInstruction,
        status: "ready",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pathRow.id);
    if (readyError) throw readyError;

    const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, "study", aiMode);

    return NextResponse.json({
      pathId: pathRow.id,
      overview,
      unitCount: units.length,
      aiUsage,
      model: geminiResult.model,
      provider: geminiAuth.provider,
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    console.error("[API_BUILD_STUDY_ERROR]", { name: error?.name, code: error?.code, status });

    if (studyNodeId) {
      await supabase
        .from("study_paths")
        .update({
          status: "error",
          error_message: error?.message || "Gagal menyusun Study.",
          updated_at: new Date().toISOString(),
        })
        .eq("node_id", studyNodeId);
    }

    return NextResponse.json(
      { error: error?.message || "Gagal menyusun Study." },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}
