import Dexie, { type Table } from "dexie";
import type { FsrsStored, FsrsRating } from "./fsrsScheduling";
export type CachedCard = FsrsStored & { id: string; front: string; back: string; scope_node_id?: string | null };
export type ReviewQueueItem = { id: string; account: string; cardId: string; expected: string | null; rating: FsrsRating; reviewedAt: string; update: Record<string, number | string>; conflict?: boolean };
export type PdfNote = { key: string; account: string; file: string; page: number; x: number; y: number; w: number; h: number; note: string };
class LearningStore extends Dexie {
  snapshots!: Table<{ account: string; savedAt: string; cards: CachedCard[]; notes: { id: string; title: string; text: string }[] }, string>;
  reviews!: Table<ReviewQueueItem, string>;
  annotations!: Table<PdfNote, string>;
  bookmarks!: Table<{ key: string; account: string; recording: string; seconds: number; title: string }, string>;
  books!: Table<{ key: string; account: string; cfi: string }, string>;
  constructor() {
    super("rb-learning-private-v1");
    this.version(1).stores({ snapshots: "account", reviews: "id,account,cardId", annotations: "key,account,[account+file]", bookmarks: "key,account,[account+recording]", books: "key,account" });
  }
}
export const learningStore = new LearningStore();
export async function clearLearningCache() {
  await learningStore.transaction("rw", learningStore.tables, async () => { for (const table of learningStore.tables) await table.clear(); });
}
