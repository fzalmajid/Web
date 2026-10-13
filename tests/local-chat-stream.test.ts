import test from "node:test";
import assert from "node:assert/strict";
import { readLocalChatStream } from "../lib/localChatStream";

function response(events: unknown[]) {
  return new Response(events.map(event => "data: " + (typeof event === "string" ? event : JSON.stringify(event)) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
}
test("local chat streams visible text and reassembles MCP tool arguments", async () => {
  const deltas: string[] = [];
  const result = await readLocalChatStream(response([
    { choices: [{ delta: { content: "Cek ", tool_calls: [{ index: 0, id: "call-1", function: { name: "lookup", arguments: '{"q":' } }] } }] },
    { choices: [{ delta: { content: "materi", tool_calls: [{ index: 0, function: { arguments: '"farmasi"}' } }] }, finish_reason: "tool_calls" }] },
    "[DONE]",
  ]), text => deltas.push(text));
  assert.deepEqual(deltas, ["Cek ", "materi"]);
  assert.equal(result.choices[0].message.content, "Cek materi");
  assert.deepEqual(JSON.parse(result.choices[0].message.tool_calls[0].function.arguments), { q: "farmasi" });
  assert.equal(result.choices[0].message.tool_calls[0].id, "call-1");
});
test("an interrupted local stream is an error and buffered compatible endpoints still work", async () => {
  await assert.rejects(readLocalChatStream(response([{ choices: [{ delta: { content: "partial" } }] }]), () => {}), /terputus/);
  const buffered = { choices: [{ message: { content: "answer" } }] };
  assert.deepEqual(await readLocalChatStream(Response.json(buffered), () => {}), buffered);
});
