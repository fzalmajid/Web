import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import { ChatRequestGate } from "../lib/chatRequest";
import { normalizeAiExperienceMode } from "../lib/aiOrchestration";
import { pageFunctions } from "./page-functions";
const page=readFileSync("app/page.tsx","utf8");
test("online chat defaults to AI plus private Reference plus Web",()=>{
  assert.match(page,/useState<AiSourceKind\[\]>\(\["ai", "database", "web"\]\)/);
  const mode=page.slice(page.indexOf("function changeExperienceMode("),page.indexOf("function changeExperienceMode(")+1000);
  assert.match(mode,/if \(aiExperienceMode === "simple"\)\s*\{\s*setSelectedSources\(\["ai", "database", "web"\]\)/);
});
test("New Chat cancels busy work, clears session sources, and preserves Simple defaults",()=>{
  for (const mode of ["instant", "simple"]) {
    const gate = new ChatRequestGate();
    const old = gate.begin()!;
    const state: Record<string, any> = { chat: "old", sourceNodeIds: ["old-node"], sourceFileIds: ["old-file"], attachment: {}, link: {}, loading: true };
    const loadVersion = { current: 4 };
    const { startNewChat } = pageFunctions(["startNewChat"], {
      busy: true, aiExperienceMode: mode, chatLoadVersionRef: loadVersion,
      cancelChatRequest: () => gate.cancel(), closeChatRoom: () => { state.chat = null; },
      setChatLoading: (value: boolean) => { state.loading = value; },
      setSelectedSourceNodeIds: (value: string[]) => { state.sourceNodeIds = structuredClone(value); },
      setSelectedSourceFileIds: (value: string[]) => { state.sourceFileIds = structuredClone(value); },
      setPendingAttachment: (value: any) => { state.attachment = value; },
      setPendingLink: (value: any) => { state.link = value; },
      setSelectedSources: (value: string[]) => { state.sources = structuredClone(value); },
      questionInputRef: { current: null },
    });
    startNewChat();
    assert.equal(old.signal.aborted, true);
    assert.equal(gate.isCurrent(old), false);
    assert.equal(gate.finish(old), false);
    assert.ok(gate.begin(), "The fresh conversation must accept a request");
    assert.equal(loadVersion.current, 5, "Pending history loads must be invalidated");
    assert.equal(state.chat, null);
    assert.equal(state.loading, false);
    assert.deepEqual(state.sourceNodeIds, []);
    assert.deepEqual(state.sourceFileIds, []);
    assert.equal(state.attachment, null);
    assert.equal(state.link, null);
    assert.deepEqual(state.sources, mode === "simple" ? ["database"] : ["ai", "database", "web"]);
  }
});

test("opening saved chat restores its own source kinds and selections instead of new-chat defaults", async () => {
  const state: Record<string, any> = { filters: [] };
  const noop = () => {};
  const query: Record<string, any> = { select: () => query, eq: (key: string, value: string) => { state.filters.push([key, value]); return query; }, order: async () => ({ data: [], error: null }) };
  const { loadStoredChat } = pageFunctions(["loadStoredChat"], {
    supabase: { from: () => query }, session: { user: { id: "current-user" } },
    chatLoadVersionRef: { current: 1 },
    activateChat: (id: string) => { state.chat = id; }, setSavedChats: noop,
    setChatMessages: noop, onActiveChatChange: noop, setModelRecovery: noop,
    setQuestion: noop, setChatRequestError: noop, setOpen: noop,
    setSelectedSources: (value: string[]) => { state.sources = structuredClone(value); },
    setSelectedSourceNodeIds: (value: string[]) => { state.nodeIds = structuredClone(value); },
    setSelectedSourceFileIds: (value: string[]) => { state.fileIds = structuredClone(value); },
    setAiSelection: (value: any) => { state.selection = structuredClone(value); },
    setAiExperienceMode: (value: string) => { state.mode = value; }, normalizeAiExperienceMode,
  });
  await loadStoredChat({ id: "saved", settings: { sources: ["database", "web"], sourceNodeIds: ["node"], sourceFileIds: ["file"], aiSelection: { model: "local" }, aiExperienceMode: "simple" } });
  assert.deepEqual(state.filters, [["conversation_id", "saved"], ["user_id", "current-user"]]);
  assert.equal(state.chat, "saved");
  assert.deepEqual(state.sources, ["database", "web"]);
  assert.deepEqual(state.nodeIds, ["node"]);
  assert.deepEqual(state.fileIds, ["file"]);
  assert.deepEqual(state.selection, { model: "local" });
  assert.equal(state.mode, "simple");
});
