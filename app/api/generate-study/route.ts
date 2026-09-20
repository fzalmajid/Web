import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { geminiGenerateDetailed, parseJsonSafely, WHATSAPP_FORMAT_INSTRUCTION } from "@/lib/gemini";
import { buildKnowledgeContext, getScopeKnowledge } from "@/lib/knowledge";
import { modelPlanForSelection, selectionFromHeaders } from "@/lib/aiModels";
import { geminiUserAuthFromHeaders } from "@/lib/geminiUserAuth";
import { aiModeInstruction, aiQuotaError, checkAiCredits, finalizeAiCredits, normalizeAiMode, recordAiTokenUsage } from "@/lib/aiQuota";

function bearer(req: NextRequest) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

export async function POST(req: NextRequest) {
  try {
    const token = bearer(req);
    if (!token) return NextResponse.json({ error: "Belum login." }, { status: 401 });

    const body = await req.json();
    const sourceNodeId = String(body.sourceNodeId || body.scopeNodeId || "");
    const targetNodeId = String(body.targetNodeId || sourceNodeId || "");
    const mode = body.mode === "flashcards" || body.mode === "quiz" ? body.mode : "both";
    const aiMode = normalizeAiMode(body.aiMode);
    const instruction = String(body.instruction || "").trim().slice(0, 2000);
    const allowedSourceKinds = new Set(["ai", "database", "web"]);
    const sourceKinds = Array.isArray(body.sourceKinds)
      ? Array.from(new Set(body.sourceKinds.map((value: unknown) => String(value)).filter((value: string) => allowedSourceKinds.has(value))))
      : ["database"];
    const activeSourceKinds = sourceKinds.length ? sourceKinds : ["database"];
    const useAiKnowledge = activeSourceKinds.includes("ai");
    const useDatabase = activeSourceKinds.includes("database");
    const useWeb = activeSourceKinds.includes("web");
    const allowedQuizKinds = new Set(["mcq-fixed", "essay-fixed", "mcq-ai", "essay-ai"]);
    const quizKinds = Array.isArray(body.quizKinds)
      ? Array.from(
          new Set(
            body.quizKinds
              .map((value: unknown) => String(value))
              .filter((value: string) => allowedQuizKinds.has(value))
          )
        ).slice(0, 4)
      : ["mcq-fixed"];
    const rawCount = Number(body.count || 0);
    const requestedCount =
      Number.isFinite(rawCount) && rawCount > 0
        ? Math.max(1, Math.min(20, Math.round(rawCount)))
        : 0;
    const aiSelection = selectionFromHeaders(req.headers, "general", aiMode);
    const geminiAuth = geminiUserAuthFromHeaders(req.headers);
    const ownGemini = geminiAuth.ownGemini;

    if (aiMode === "simple") {
      return NextResponse.json({ error: "Local diproses secara Local di perangkat dan tidak memanggil Gemini." }, { status: 400 });
    }

    if (!sourceNodeId || !targetNodeId) {
      return NextResponse.json({ error: "Scope materi belum dipilih." }, { status: 400 });
    }

    const supabase = createServerSupabase(token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Sesi tidak valid." }, { status: 401 });
    }

    const { data: target, error: targetError } = await supabase
      .from("study_nodes")
      .select("id,node_type")
      .eq("id", targetNodeId)
      .single();
    if (targetError || !target) {
      return NextResponse.json({ error: "Cabang tujuan tidak ditemukan." }, { status: 404 });
    }

    const sourceLimit = aiMode === "high" ? 60 : aiMode === "medium" ? 48 : 32;
    const sources = useDatabase ? await getScopeKnowledge(supabase, sourceNodeId, sourceLimit) : [];
    if (useDatabase && !sources.length) {
      return NextResponse.json({ error: "Database aktif, tetapi sumber materi ini masih kosong." }, { status: 400 });
    }

    const context = useDatabase
      ? buildKnowledgeContext(sources, aiMode === "high" ? 46000 : aiMode === "medium" ? 36000 : 24000)
      : "";

    const sourcePolicy = [
      "SUMBER AKTIF: " + activeSourceKinds.join(", "),
      useDatabase
        ? "- Database AKTIF: gunakan RAW/ORIGINAL di bawah sebagai sumber utama."
        : "- Database TIDAK AKTIF: abaikan database sebagai sumber fakta.",
      useAiKnowledge
        ? "- AI AKTIF: pengetahuan internal model boleh dipakai."
        : "- AI TIDAK AKTIF: jangan gunakan pengetahuan internal model sebagai sumber fakta.",
      useWeb
        ? "- Web AKTIF: pencarian web boleh dipakai."
        : "- Web TIDAK AKTIF: jangan memakai web.",
    ].join("\n");

    const preflight = ownGemini ? null : await checkAiCredits(supabase, "study", aiMode);
    if (preflight && !preflight.allowed) {
      return NextResponse.json(aiQuotaError(preflight), { status: 429 });
    }

    const defaultCounts =
      aiMode === "high"
        ? { cards: 8, quiz: 5 }
        : aiMode === "medium"
          ? { cards: 6, quiz: 4 }
          : { cards: 4, quiz: 3 };
    const counts = {
      cards: mode === "flashcards" && requestedCount ? requestedCount : defaultCounts.cards,
      quiz: mode === "quiz" && requestedCount ? requestedCount : defaultCounts.quiz,
    };
    const requested = mode === "flashcards"
      ? "Buat flashcards saja. quizzes harus berupa array kosong."
      : mode === "quiz"
        ? "Buat quizzes saja. flashcards harus berupa array kosong."
        : "Buat flashcards dan quizzes.";

    const quizKindInstruction =
      mode === "quiz"
        ? [
            "Jenis soal yang dipilih user: " + quizKinds.join(", ") + ".",
            "Arti kode:",
            "- mcq-fixed = pilihan ganda, jawaban benar disimpan dan dinilai langsung.",
            "- essay-fixed = essay dengan jawaban acuan, dinilai langsung terhadap jawaban acuan.",
            "- mcq-ai = pilihan ganda, benar/salah dinilai AI saat user menekan selesai.",
            "- essay-ai = essay bebas, benar/salah dinilai AI saat user menekan selesai.",
            "Bagi jumlah soal seimbang di antara jenis yang dipilih. Jangan membuat jenis lain.",
          ].join("\n")
        : "";

    const geminiResult = await geminiGenerateDetailed([{
      text: `KONFIGURASI SUMBER:
${sourcePolicy}

DATABASE RAW/ORIGINAL:
${context || "(Database tidak aktif.)"}

INSTRUKSI USER:
${instruction || "(Tidak ada instruksi tambahan.)"}

${requested}\n${quizKindInstruction}\n${aiModeInstruction(aiMode)}\n\nKeluarkan JSON valid tanpa markdown:
{
  "flashcards":[{"front":"...","back":"..."}],
  "quizzes":[{"kind":"mcq-fixed|essay-fixed|mcq-ai|essay-ai","question":"...","choices":["A","B","C","D"],"correct_answer":"...","explanation":"..."}]
}

Aturan quiz:
- mcq-fixed: choices minimal 2 (utamakan 4), correct_answer wajib sama persis dengan salah satu choices.
- essay-fixed: choices harus [], correct_answer wajib berisi jawaban acuan ringkas berbasis RAW.
- mcq-ai: choices minimal 2 (utamakan 4), correct_answer boleh kosong karena penilaian dilakukan AI saat submit.
- essay-ai: choices harus [], correct_answer boleh kosong.
- Jangan mengubah fungsi penilaian: fixed tetap fixed, AI tetap dinilai AI saat user selesai.

Buat ${mode === "flashcards" ? counts.cards + " flashcard" : mode === "quiz" ? counts.quiz + " soal" : counts.cards + " flashcard dan " + counts.quiz + " soal"}. Patuhi sumber AI / Database / Web yang diaktifkan user. Jika Database aktif, pertahankan isi RAW/ORIGINAL dan jangan menggantinya dengan versi tertata. Ikuti INSTRUKSI USER selama sesuai dengan sumber aktif.\n${WHATSAPP_FORMAT_INSTRUCTION}`,
    }], "Patuhi sumber AI / Database / Web yang diaktifkan user. Jangan memakai sumber yang dinonaktifkan.", {
      models: modelPlanForSelection(aiSelection.model, aiMode, "standard"),
      effort: aiSelection.effort,
      responseMimeType: "application/json",
      maxOutputTokens: aiMode === "high" ? 16384 : 12288,
      googleSearch: useWeb,
      apiKey: geminiAuth.apiKey,
      accessToken: geminiAuth.accessToken,
      projectId: geminiAuth.projectId,
    });
    await recordAiTokenUsage(supabase, geminiResult.usage, geminiResult.model, geminiAuth.provider);
    const raw = geminiResult.text;

    const parsed = parseJsonSafely(raw);
    const uid = userData.user.id;

    const flashcards = mode === "quiz" ? [] : Array.isArray(parsed.flashcards)
      ? parsed.flashcards.slice(0, counts.cards).map((x: any) => ({
          front: String(x.front || "").trim(),
          back: String(x.back || "").trim(),
        })).filter((x: any) => x.front && x.back)
      : [];

    const quizzes = mode === "flashcards" ? [] : Array.isArray(parsed.quizzes)
      ? parsed.quizzes.slice(0, counts.quiz).map((x: any, index: number) => {
          const requestedKind = quizKinds[index % Math.max(1, quizKinds.length)] || "mcq-fixed";
          const rawKind = String(x.kind || "").trim();
          const kind = quizKinds.includes(rawKind) ? rawKind : requestedKind;
          const isMcq = kind === "mcq-fixed" || kind === "mcq-ai";
          const isAi = kind === "mcq-ai" || kind === "essay-ai";
          const choices = isMcq && Array.isArray(x.choices)
            ? x.choices.slice(0, 4).map((v: any) => String(v).trim()).filter(Boolean)
            : [];
          const correctAnswer = String(x.correct_answer || "").trim();
          return {
            kind,
            quiz_type: isMcq ? "mcq" as const : "essay" as const,
            grading_mode: isAi ? "ai" as const : "fixed" as const,
            question: String(x.question || "").trim(),
            choices,
            correct_answer: isAi ? "" : correctAnswer,
            explanation: String(x.explanation || "").trim(),
          };
        }).filter((x: any) => {
          if (!x.question) return false;
          if (x.quiz_type === "mcq") {
            if (x.choices.length < 2) return false;
            return x.grading_mode === "ai" || x.choices.includes(x.correct_answer);
          }
          return x.grading_mode === "ai" || Boolean(x.correct_answer);
        })
      : [];

    if (flashcards.length) {
      const { error } = await supabase.from("flashcards").insert(
        flashcards.map((x:any) => ({
          user_id: uid,
          material_id: null,
          scope_node_id: targetNodeId,
          front: x.front,
          back: x.back,
        }))
      );
      if (error) throw error;
    }

    if (quizzes.length) {
      const { error } = await supabase.from("quizzes").insert(
        quizzes.map((x:any) => ({
          user_id: uid,
          material_id: null,
          scope_node_id: targetNodeId,
          question: x.question,
          choices: x.choices,
          correct_answer: x.correct_answer,
          explanation: x.explanation,
          quiz_type: x.quiz_type,
          grading_mode: x.grading_mode,
        }))
      );
      if (error) throw error;
    }

    const aiUsage = ownGemini ? null : await finalizeAiCredits(supabase, "study", aiMode);
    return NextResponse.json({
      flashcards: flashcards.length,
      quizzes: quizzes.length,
      aiUsage,
      model: geminiResult.model,
      provider: geminiAuth.provider,
    });
  } catch (error: any) {
    const status = Number(error?.statusCode || 500);
    console.error("[API_GENERATE_STUDY_ERROR]", { name: error?.name, code: error?.code, status });
    return NextResponse.json(
      { error: error?.message || "Gagal membuat latihan." },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}
