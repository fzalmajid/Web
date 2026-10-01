export type TranscriptSegment = { text: string; timestamp: [number, number] };
export type SpeechTimeMap = { compactStart: number; compactEnd: number; originalStart: number; originalEnd: number };
export function remapTranscript(chunks: any, map: SpeechTimeMap[], duration: number): TranscriptSegment[] {
  if (!Array.isArray(chunks)) return [];
  function original(second: number, end: boolean) {
    if (!map.length) return Math.max(0, Math.min(duration, second));
    const row = map.find(row => end ? second <= row.compactEnd : second < row.compactEnd) || map[map.length - 1];
    return Math.max(0, Math.min(duration, row.originalEnd, row.originalStart + Math.max(0, second - row.compactStart)));
  }
  return chunks.flatMap(chunk => {
    if (typeof chunk?.text !== "string" || !Array.isArray(chunk.timestamp) || !Number.isFinite(chunk.timestamp[0])) return [];
    const [start, end] = chunk.timestamp;
    if (!Number.isFinite(end) || end < start) return []; // Never invent missing timestamps.
    return [{ text: chunk.text.trim(), timestamp: [original(start, false), original(end, true)] as [number, number] }];
  }).filter(chunk => chunk.text && chunk.timestamp[1] >= chunk.timestamp[0]);
}
