import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pageFunctions } from "./page-functions";
import { ChatRequestGate } from "../lib/chatRequest";
import { readChatStream } from "../lib/chatStream";
import { defaultSelection, legacyModeForSelection, modelProvider } from "../lib/aiModels";

test("learning tool navigation visibly distinguishes the active module and keyboard focus", () => {
  const css = readFileSync(join(process.cwd(), "app/learning-tools.css"), "utf8");
  const page = readFileSync(join(process.cwd(), "components/LearningWorkspace.tsx"), "utf8");
  assert.ok(page.includes("aria-pressed={tab===id}"));
  assert.match(css, /nav button\[aria-pressed="true"\]\{[^}]*background:[^}]*color:/);
  assert.match(css, /nav button\{min-height:44px\}/);
  assert.match(css, /:focus-visible\{outline:3px/);
});

test("Web fallback preserves the user's Web selection in both normal and debug retry flows", async () => {
  for (const flow of ["ask", "retryFailedAskWithModel"]) for (const fallback of [true, false]) {
    const state: Record<string, any> = { sources: ["ai", "database", "web"], requests: [], answers: [], errors: [], models: [], userWrites: 0 };
    const gate = new ChatRequestGate();
    const noop = () => {};
    const selection = defaultSelection("gemini-3.5-flash-lite", "chat");
    const functions = pageFunctions(["ask", "retryFailedAskWithModel", "submitCloudAsk"], {
      question: "Halo", selectedSources: state.sources, chatLoading: false,
      processedChatRequestRef: { current: 1 }, chatRequestVersion: 1,
      chatRequestGateRef: { current: gate }, chatLoadVersionRef: { current: 1 },
      activeChatId: "chat", activeChatIdRef: { current: "chat" },
      savedChats: [{ id: "chat", scope_node_id: null, settings: { referenceOwnerId: "owner" } }],
      chatMessages: [], scopeNodeId: null, referenceOwnerId: "owner", readOnlyReference: false,
      aiSelection: selection, aiExperienceMode: "instant", aiMode: "instant", debugModel: flow !== "ask",
      selectedSourceNodeIds: [], selectedSourceFileIds: [], pendingAttachment: null, pendingLink: null, pendingVoice: null,
      modelRecovery: { conversationId: "chat", requestBody: { question: "Halo", sources: state.sources } },
      session: {}, aiRequestHeaders: (_session: any, value: any) => { state.models.push(value.model); return {}; },
      readChatStream, defaultSelection, legacyModeForSelection, modelProvider,
      showModelRecovery: () => false, firstUrl: () => "", wantsDatabaseSave: () => false, citationRequestFields: () => ({}),
      questionInputRef: { current: null },
      setBusy: noop, setOpen: noop, setStreamingText: noop, setModelRecovery: noop,
      setAiSelection: noop, setChatMessages: noop, setQuestion: noop, setAnswer: noop,
      setAnswerModel: noop, setSources: noop, setWebSources: noop, setWarning: noop,
      setChatRequestError: (error: string) => { if (error) state.errors.push(error); },
      setSelectedSources: (sources: string[]) => { state.sources = structuredClone(sources); },
      saveStoredMessage: async () => { state.userWrites++; return { id: "user-message", role: "user", content: "Halo" }; },
      finishChatAnswerForConversation: async (...args: any[]) => { state.answers.push(args); },
      fetch: async (_url: string, init: RequestInit) => {
        state.requests.push(JSON.parse(String(init.body)));
        assert.ok(init.signal);
        return Response.json({ answer: "Jawaban", selectedSources: ["ai", "database"], webFallback: fallback });
      },
    });
    if (flow === "ask") await functions.ask({ preventDefault: noop });
    else await functions.retryFailedAskWithModel("gemini-3.5-flash");
    assert.deepEqual(state.errors, [], `${flow} must reach the shared response handler`);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0].stream, true);
    assert.deepEqual(state.requests[0].sources, ["ai", "database", "web"]);
    assert.deepEqual(state.models, [flow === "ask" ? selection.model : "gemini-3.5-flash"]);
    assert.equal(state.userWrites, flow === "ask" ? 1 : 0, "Retry must reuse the saved question without another user message");
    assert.equal(state.answers.length, 1);
    assert.equal(state.answers[0][0], "chat", "Both flows must finish in their original conversation");
    assert.equal(state.answers[0][1], "Jawaban");
    assert.deepEqual(state.sources, fallback ? ["ai", "database", "web"] : ["ai", "database"], `${flow}: only a non-fallback result may update source selection`);
  }
});

test("Record status reports actual VAD and no-speech results instead of claiming an unavailable integration", () => {
  const page = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
  assert.match(page, /localVad = result\.usedVad/);
  assert.match(page, /localNoSpeech = Boolean\(result\.noSpeech\)/);
  assert.ok(page.includes("audio utuh, pemisahan ucapan belum tersedia"));
  assert.ok(page.includes("Tidak ada ucapan terdeteksi; audio tetap bisa didengar ulang."));
});

test("media search is contextual in chat, not a duplicate composer form", () => {
  const page = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
  assert.ok(!page.includes("extraWebPanel"));
  assert.ok(!page.includes("<OpenMedia"));assert.ok(page.includes("<ChatImages question="));
  const css = readFileSync(join(process.cwd(), "app/layout-alignment.css"), "utf8");
  assert.match(css, /\.askWebPanel\{\s*grid-column:1\/-1/);
  assert.match(css, /\.askTopControls\{[^}]*display:flex!important;[^}]*flex-wrap:nowrap!important/);
  assert.match(css, /\.aiExperienceChoices\{flex-shrink:0\}/);
});

test("responsive chat respects the actual composer height and narrow viewport", () => {
  const css = readFileSync(join(process.cwd(), "app/layout-alignment.css"), "utf8");
  assert.match(css, /100dvh - var\(--rb-ai-answer-bottom,100px\) - var\(--rb-topbar-h,60px\)/);
  assert.match(css, /@media \(max-width:1023px\)\{\s*html,body,\.appShell\{min-width:0!important\}/);
  assert.match(css, /\.aiExperienceChoices button:focus-visible/);
});
