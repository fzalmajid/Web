-- Additive: existing rows and clients remain compatible.
alter table public.recordings add column if not exists transcript_segments jsonb not null default '[]'::jsonb;

-- Atomic, idempotent FSRS updates. Never overwrite a review from another device.
create or replace function public.sync_learning_review(
  p_id uuid, p_card uuid, p_expected timestamptz, p_rating integer,
  p_at timestamptz, p_update jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  c public.flashcards%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_id is null or p_rating is null or p_rating not between 1 and 4 or p_at is null or p_at > now() + interval '5 minutes' or p_update is null or jsonb_typeof(p_update) <> 'object' then
    raise exception 'Invalid review';
  end if;
  select * into c from public.flashcards where id = p_card and user_id = auth.uid() for update;
  if not found then raise exception 'Card unavailable'; end if;
  if exists (select 1 from public.flashcard_reviews where id = p_id and user_id = auth.uid() and flashcard_id = p_card) then return 'duplicate'; end if;
  if c.fsrs_last_review is distinct from p_expected or p_at < coalesce(c.fsrs_last_review, '-infinity'::timestamptz) then return 'conflict'; end if;
  if not (p_update ?& array['fsrs_due','fsrs_stability','fsrs_difficulty','fsrs_elapsed_days','fsrs_scheduled_days','fsrs_learning_steps','fsrs_reps','fsrs_lapses','fsrs_state','fsrs_last_review']) then raise exception 'Incomplete schedule'; end if;
  if exists(select 1 from jsonb_each(p_update) where value='null'::jsonb) then raise exception 'Null schedule'; end if;
  if (p_update->>'fsrs_last_review')::timestamptz is distinct from p_at or
     not ((p_update->>'fsrs_stability')::float8 between 0 and 1000000) or
     not ((p_update->>'fsrs_difficulty')::float8 between 0 and 10) or
     not ((p_update->>'fsrs_state')::int between 0 and 3) or
     not ((p_update->>'fsrs_reps')::int between 1 and 1000000) or
     not ((p_update->>'fsrs_lapses')::int between 0 and 1000000) or
     not ((p_update->>'fsrs_elapsed_days')::int between 0 and 1000000) or
     not ((p_update->>'fsrs_scheduled_days')::int between 0 and 1000000) or
     not ((p_update->>'fsrs_learning_steps')::int between 0 and 1000000) or
     not ((p_update->>'fsrs_due')::timestamptz between p_at and p_at + interval '10000 years') then
    raise exception 'Invalid schedule';
  end if;
  update public.flashcards set
    fsrs_due = (p_update->>'fsrs_due')::timestamptz,
    fsrs_stability = (p_update->>'fsrs_stability')::float8,
    fsrs_difficulty = (p_update->>'fsrs_difficulty')::float8,
    fsrs_elapsed_days = (p_update->>'fsrs_elapsed_days')::int,
    fsrs_scheduled_days = (p_update->>'fsrs_scheduled_days')::int,
    fsrs_learning_steps = (p_update->>'fsrs_learning_steps')::int,
    fsrs_reps = (p_update->>'fsrs_reps')::int,
    fsrs_lapses = (p_update->>'fsrs_lapses')::int,
    fsrs_state = (p_update->>'fsrs_state')::int,
    fsrs_last_review = p_at, fsrs_updated_at = now()
  where id = p_card and user_id = auth.uid();
  insert into public.flashcard_reviews (id,user_id,flashcard_id,rating,reviewed_at,due_before,due_after,stability,difficulty,state,scheduled_days,elapsed_days)
  values (p_id,auth.uid(),p_card,p_rating,p_at,c.fsrs_due,(p_update->>'fsrs_due')::timestamptz,(p_update->>'fsrs_stability')::float8,(p_update->>'fsrs_difficulty')::float8,(p_update->>'fsrs_state')::int,(p_update->>'fsrs_scheduled_days')::int,(p_update->>'fsrs_elapsed_days')::int);
  return 'ok';
end $$;
revoke all on function public.sync_learning_review(uuid,uuid,timestamptz,integer,timestamptz,jsonb) from public, anon;
grant execute on function public.sync_learning_review(uuid,uuid,timestamptz,integer,timestamptz,jsonb) to authenticated;
