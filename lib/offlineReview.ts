import { supabase } from "./supabase";
import { applyFsrsRating, type FsrsRating } from "./fsrsScheduling";
import { learningStore, type CachedCard } from "./learningStore";
export async function queueOfflineReview(account: string, card: CachedCard, rating: FsrsRating) {
  const now = new Date(), scheduled = applyFsrsRating(card, rating, now);
  await learningStore.transaction("rw", learningStore.snapshots, learningStore.reviews, async () => {
    const snapshot = await learningStore.snapshots.get(account);
    if (!snapshot || !snapshot.cards.some(item => item.id === card.id)) throw new Error("Kartu belum disimpan untuk offline.");
    await learningStore.reviews.add({ id: crypto.randomUUID(), account, cardId: card.id, expected: card.fsrs_last_review || null, rating, reviewedAt: now.toISOString(), update: scheduled.update });
    snapshot.cards = snapshot.cards.map(item => item.id === card.id ? { ...item, ...scheduled.update } : item);
    await learningStore.snapshots.put(snapshot);
  });
}
export async function syncOfflineReviews() {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Login kembali untuk menyinkronkan review.");
  const queue = (await learningStore.reviews.where("account").equals(session.user.id).toArray()).sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
  let synced = 0, conflicts = 0;
  const blocked = new Set<string>();
  for (const row of queue) {
    if (blocked.has(row.cardId) || row.conflict) { conflicts++; blocked.add(row.cardId); continue; }
    const { data, error } = await supabase.rpc("sync_learning_review", { p_id: row.id, p_card: row.cardId, p_expected: row.expected, p_rating: row.rating, p_at: row.reviewedAt, p_update: row.update });
    if (error) throw new Error("Sinkronisasi belum selesai. Antrean tetap aman: " + error.message);
    if (data === "conflict") { await learningStore.reviews.update(row.id, { conflict: true }); conflicts++; blocked.add(row.cardId); }
    else if (data === "ok" || data === "duplicate") { await learningStore.reviews.delete(row.id); synced++; }
    else throw new Error("Respons sinkronisasi tidak dikenal; antrean dipertahankan.");
  }
  return { synced, conflicts };
}
