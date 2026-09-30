-- FSRS spaced-repetition state for Ruang Belajar flashcards.
-- Existing cards start due immediately and are learned progressively after the
-- user rates them. User ownership remains enforced by the existing flashcards RLS.

alter table public.flashcards
  add column if not exists fsrs_due timestamptz not null default now(),
  add column if not exists fsrs_stability double precision not null default 0,
  add column if not exists fsrs_difficulty double precision not null default 0,
  add column if not exists fsrs_elapsed_days integer not null default 0,
  add column if not exists fsrs_scheduled_days integer not null default 0,
  add column if not exists fsrs_learning_steps integer not null default 0,
  add column if not exists fsrs_reps integer not null default 0,
  add column if not exists fsrs_lapses integer not null default 0,
  add column if not exists fsrs_state integer not null default 0,
  add column if not exists fsrs_last_review timestamptz,
  add column if not exists fsrs_updated_at timestamptz;

create index if not exists flashcards_user_due_idx
  on public.flashcards (user_id, fsrs_due);

create table if not exists public.flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  rating integer not null check (rating between 1 and 4),
  reviewed_at timestamptz not null default now(),
  due_before timestamptz,
  due_after timestamptz not null,
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  state integer not null default 0,
  scheduled_days integer not null default 0,
  elapsed_days integer not null default 0
);

create index if not exists flashcard_reviews_user_card_time_idx
  on public.flashcard_reviews (user_id, flashcard_id, reviewed_at desc);

alter table public.flashcard_reviews enable row level security;

drop policy if exists flashcard_reviews_select_own on public.flashcard_reviews;
create policy flashcard_reviews_select_own
  on public.flashcard_reviews
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists flashcard_reviews_insert_own on public.flashcard_reviews;
create policy flashcard_reviews_insert_own
  on public.flashcard_reviews
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.flashcards f
      where f.id = flashcard_id
        and f.user_id = (select auth.uid())
    )
  );

drop policy if exists flashcard_reviews_delete_own on public.flashcard_reviews;
create policy flashcard_reviews_delete_own
  on public.flashcard_reviews
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.flashcard_reviews from public, anon;
grant select, insert, delete on table public.flashcard_reviews to authenticated;
