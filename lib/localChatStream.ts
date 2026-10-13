import { consumeSse } from "./chatStream";

/** OpenAI-compatible chat streams also carry tool calls, including split arguments. */
export async function readLocalChatStream(response: Response, onDelta: (text: string) => void, signal?: AbortSignal) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return response.json();
  let content = "";
  let finishReason = "";
  let done = false;
  const tools = new Map<number, any>();
  await consumeSse(response, ({ data }) => {
    if (data.trim() === "[DONE]") { done = true; return; }
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error(String(chunk.error.message || chunk.error));
    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    if (typeof delta?.content === "string") {
      content += delta.content;
      onDelta(delta.content);
    }
    for (const tool of delta?.tool_calls || []) {
      const index = Number(tool.index || 0);
      const current = tools.get(index) || { id: "", type: "function", function: { name: "", arguments: "" } };
      if (tool.id) current.id = tool.id;
      current.function.name += tool.function?.name || "";
      current.function.arguments += tool.function?.arguments || "";
      tools.set(index, current);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  }, signal);
  if (!done && !finishReason) throw new Error("Koneksi Local AI terputus sebelum jawaban selesai.");
  return { choices: [{ message: { role: "assistant", content, tool_calls: [...tools.values()] }, finish_reason: finishReason }] };
}
