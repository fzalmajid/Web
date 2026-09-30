import { createEmptyCard, fsrs, Rating, State, type Card } from "ts-fsrs";

export type FsrsRating = 1 | 2 | 3 | 4;

export type FsrsStored = {
  fsrs_due?: string | null;
  fsrs_stability?: number | null;
  fsrs_difficulty?: number | null;
  fsrs_elapsed_days?: number | null;
  fsrs_scheduled_days?: number | null;
  fsrs_learning_steps?: number | null;
  fsrs_reps?: number | null;
  fsrs_lapses?: number | null;
  fsrs_state?: number | null;
  fsrs_last_review?: string | null;
};

const scheduler = fsrs();

function finite(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toFsrsCard(source: FsrsStored, now = new Date()): Card {
  const due = source.fsrs_due ? new Date(source.fsrs_due) : now;
  const state = finite(source.fsrs_state, State.New) as State;
  if (state === State.New && finite(source.fsrs_reps) === 0 && !source.fsrs_last_review) {
    return createEmptyCard(Number.isFinite(due.getTime()) ? due : now);
  }
  return {
    due: Number.isFinite(due.getTime()) ? due : now,
    stability: finite(source.fsrs_stability),
    difficulty: finite(source.fsrs_difficulty),
    elapsed_days: Math.max(0, Math.round(finite(source.fsrs_elapsed_days))),
    scheduled_days: Math.max(0, Math.round(finite(source.fsrs_scheduled_days))),
    learning_steps: Math.max(0, Math.round(finite(source.fsrs_learning_steps))),
    reps: Math.max(0, Math.round(finite(source.fsrs_reps))),
    lapses: Math.max(0, Math.round(finite(source.fsrs_lapses))),
    state,
    last_review: source.fsrs_last_review ? new Date(source.fsrs_last_review) : undefined,
  };
}

export function fsrsDueAt(source: FsrsStored) {
  const due = source.fsrs_due ? new Date(source.fsrs_due) : new Date(0);
  return Number.isFinite(due.getTime()) ? due : new Date(0);
}

export function fsrsIsDue(source: FsrsStored, now = new Date()) {
  return fsrsDueAt(source).getTime() <= now.getTime();
}

export function applyFsrsRating(source: FsrsStored, rating: FsrsRating, now = new Date()) {
  const card = toFsrsCard(source, now);
  const grade =
    rating === 1 ? Rating.Again :
    rating === 2 ? Rating.Hard :
    rating === 3 ? Rating.Good : Rating.Easy;
  const result = scheduler.next(card, now, grade);
  return {
    card: result.card,
    log: result.log,
    update: {
      fsrs_due: result.card.due.toISOString(),
      fsrs_stability: result.card.stability,
      fsrs_difficulty: result.card.difficulty,
      fsrs_elapsed_days: result.card.elapsed_days,
      fsrs_scheduled_days: result.card.scheduled_days,
      fsrs_learning_steps: result.card.learning_steps,
      fsrs_reps: result.card.reps,
      fsrs_lapses: result.card.lapses,
      fsrs_state: result.card.state,
      fsrs_last_review: result.card.last_review?.toISOString() || now.toISOString(),
      fsrs_updated_at: now.toISOString(),
    },
  };
}

export function fsrsStateLabel(state: number | null | undefined) {
  switch (Number(state)) {
    case State.Learning: return "Belajar";
    case State.Review: return "Review";
    case State.Relearning: return "Belajar ulang";
    default: return "Baru";
  }
}

export function fsrsDueLabel(source: FsrsStored, now = new Date()) {
  const due = fsrsDueAt(source);
  if (due.getTime() <= now.getTime()) return "Siap direview";
  const minutes = Math.ceil((due.getTime() - now.getTime()) / 60000);
  if (minutes < 60) return "Review " + minutes + " menit lagi";
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return "Review " + hours + " jam lagi";
  const days = Math.ceil(hours / 24);
  return "Review " + days + " hari lagi";
}
