export type SseEvent = { event: string; data: string };
export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "result"; data: Record<string, any> }
  | ({ type: "error"; error: string; status?: number } & Record<string, any>);

/** Incremental SSE framing, including CRLF and UTF-8 split across network reads. */
export function createSseParser() {
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  const dispatch = (events: SseEvent[]) => {
    if (data.length) events.push({ event, data: data.join("\n") });
    event = "message";
    data = [];
  };
  const line = (value: string, events: SseEvent[]) => {
    if (!value) return dispatch(events);
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? "" : value.slice(colon + 1);
    if (content.startsWith(" ")) content = content.slice(1);
    if (field === "data") data.push(content);
    if (field === "event") event = content || "message";
  };
  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) throw new Error("SSE event terlalu besar.");
      const events: SseEvent[] = [];
      while (true) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match || (match[0] === "\r" && match.index === buffer.length - 1)) break;
        line(buffer.slice(0, match.index), events);
        buffer = buffer.slice(match.index + match[0].length);
      }
      return events;
    },
    finish(): SseEvent[] {
      const events: SseEvent[] = [];
      if (buffer) line(buffer.replace(/\r$/, ""), events);
      buffer = "";
      dispatch(events);
      return events;
    },
  };
}

export function combinedAbortSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function consumeSse(
  response: Response,
  onEvent: (event: SseEvent) => void | Promise<void>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!response.body) throw new Error("Stream tidak tersedia.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) await onEvent(event);
    }
    for (const event of parser.push(decoder.decode())) await onEvent(event);
    for (const event of parser.finish()) await onEvent(event);
  } finally {
    signal?.removeEventListener("abort", cancel);
    // Stop the upstream body on a parser/provider error as well as cancellation.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class ChatStreamError extends Error {
  data: Record<string, any>;
  status: number;
  constructor(data: Record<string, any>, status = 500) {
    super(String(data.error || "Chat belum dapat dijawab."));
    this.name = "ChatStreamError";
    this.data = data;
    this.status = status;
  }
}

/** The final result replaces streamed drafts after citation repair or a fallback. */
export async function readChatStream(
  response: Response,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  signal?.throwIfAborted();
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = await response.json().catch(() => ({}));
    signal?.throwIfAborted();
    if (!response.ok) throw new ChatStreamError(data, response.status);
    return data;
  }
  let result: Record<string, any> | undefined;
  await consumeSse(response, ({ data }) => {
    const event = JSON.parse(data) as ChatStreamEvent;
    if (event.type === "delta" && typeof event.text === "string") onDelta(event.text);
    else if (event.type === "result") result = event.data;
    else if (event.type === "error") throw new ChatStreamError(event, event.status || 500);
  }, signal);
  if (!result) throw new ChatStreamError({ error: "Koneksi terputus sebelum jawaban selesai.", code: "CHAT_STREAM_INCOMPLETE" }, 502);
  return result;
}

/** Wrap the existing JSON handler without changing its validation/error contract. */
export function createChatStreamResponse(
  run: (onDelta: (text: string) => void, signal: AbortSignal) => Promise<Response>,
  requestSignal?: AbortSignal,
): Response {
  const abort = new AbortController();
  const signal = requestSignal ? AbortSignal.any([requestSignal, abort.signal]) : abort.signal;
  const encoder = new TextEncoder();
  let finish = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let ended = false;
      const emit = (event: ChatStreamEvent) => {
        if (!ended && !signal.aborted) controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
      };
      const heartbeat = setInterval(() => {
        if (!ended && !signal.aborted) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15000);
      finish = () => {
        if (ended) return;
        ended = true;
        clearInterval(heartbeat);
        signal.removeEventListener("abort", finish);
        try { controller.close(); } catch { /* The consumer may already have cancelled. */ }
      };
      signal.addEventListener("abort", finish, { once: true });
      void (async () => {
        try {
          signal.throwIfAborted();
          const response = await run(text => { if (text) emit({ type: "delta", text }); }, signal);
          signal.throwIfAborted();
          const data = await response.json();
          if (response.ok) emit({ type: "result", data });
          else emit({ ...data, type: "error", error: String(data.error || "Chat belum dapat dijawab."), status: response.status });
        } catch (error: any) {
          if (!signal.aborted) emit({ type: "error", error: "Koneksi chat terputus. Silakan coba kembali.", code: "CHAT_STREAM_ERROR", status: 502 });
        } finally {
          finish();
        }
      })();
    },
    cancel() { abort.abort(); finish(); },
  });
  return new Response(body, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-store, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
