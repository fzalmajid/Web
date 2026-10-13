-- Dedicated new Neon database only. The runner refuses an unmarked database
-- containing application relations. Neon Auth owns neon_auth; app users are UUIDs.
create schema if not exists private;
create schema if not exists auth;
create extension if not exists vector with schema public;

do $bootstrap$ begin
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin nobypassrls; end if;
  if not exists (select from pg_roles where rolname='anonymous') then create role anonymous nologin nobypassrls; end if;
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin nobypassrls; end if;
  -- Data API installs auth.user_id(). Before it is enabled, accept only the
  -- transaction-local JWT claims set by the app's verified-token database API.
  if to_regprocedure('auth.uid()') is null then
    execute $fn$create function auth.uid() returns uuid language plpgsql stable set search_path='' as $body$
    declare subject text;
    begin
      if to_regprocedure('auth.user_id()') is not null then
        execute 'select auth.user_id()::text' into subject;
      else
        subject := nullif(current_setting('request.jwt.claim.sub',true),'');
        if subject is null then
          subject := nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub';
        end if;
      end if;
      if subject is null or subject !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
      return subject::uuid;
    exception when invalid_text_representation then return null;
    end $body$$fn$;
  end if;
end $bootstrap$;

-- Future migrations must explicitly grant access after installing RLS.
revoke create on schema public from public;
revoke all on schema private from public,authenticated,anonymous,anon;
alter default privileges in schema public revoke all on tables from public,authenticated,anonymous,anon;
alter default privileges in schema public revoke execute on functions from public,authenticated,anonymous,anon;
alter default privileges in schema private revoke all on tables from public,authenticated,anonymous,anon;
alter default privileges in schema private revoke execute on functions from public,authenticated,anonymous,anon;

create table public.study_nodes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  parent_id uuid, title text not null, node_type text not null default 'material'
    check(node_type in ('material','submaterial','database','recording','flashcards','quiz','study','task')),
  description text not null default '', emoji text not null default '📚', card_color text not null default 'default',
  position integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,user_id), foreign key(parent_id,user_id) references public.study_nodes(id,user_id) on delete cascade,
  check(parent_id is distinct from id)
);
create index study_nodes_owner_parent_idx on public.study_nodes(user_id,parent_id,position);

create table public.source_files (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, node_id uuid,
  file_path text not null, file_name text not null, mime_type text not null default 'application/octet-stream', size_bytes bigint not null default 0 check(size_bytes>=0),
  processing_status text not null default 'processing' check(processing_status in ('processing','ready','error')),
  raw_text text, structured_text text, corrections jsonb not null default '[]', error_message text,
  source_kind text not null default 'file' check(source_kind in ('file','link')), source_url text,
  processing_page integer not null default 0, processing_total_pages integer not null default 0,
  processing_chunks integer not null default 0, processing_chars bigint not null default 0,
  ai_copy_mode text check(ai_copy_mode in ('compact','medium','complex')), ai_copy_ratio double precision,
  ai_copy_model text, ai_copy_updated_at timestamptz,
  bibliographic_metadata jsonb not null default '{}', bibliographic_metadata_status text not null default 'unreviewed'
    check(bibliographic_metadata_status in ('unreviewed','auto','verified','manual','conflict')),
  bibliographic_metadata_updated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,user_id), foreign key(node_id,user_id) references public.study_nodes(id,user_id) on delete cascade
);
create index source_files_owner_node_idx on public.source_files(user_id,node_id);
create index source_files_bibliographic_metadata_status_idx on public.source_files(user_id,bibliographic_metadata_status);

create table public.knowledge_entries (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, node_id uuid,
  title text not null default '', category text not null default '', content text not null default '', raw_content text,
  source_type text not null default 'manual' check(source_type in ('manual','file','transcript','generated')),
  source_file_id uuid, source_page_start integer, source_page_end integer,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,user_id), foreign key(node_id,user_id) references public.study_nodes(id,user_id) on delete cascade,
  foreign key(source_file_id,user_id) references public.source_files(id,user_id) on delete cascade,
  body_search_vector tsvector generated always as (to_tsvector('simple'::regconfig,coalesce(nullif(raw_content,''),content,''))) stored
);
create index knowledge_entries_owner_node_idx on public.knowledge_entries(user_id,node_id);
create index knowledge_entries_source_file_idx on public.knowledge_entries(source_file_id);
create index knowledge_entries_body_search_vector_idx on public.knowledge_entries using gin(body_search_vector);

create table public.recordings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, node_id uuid, title text not null default '',
  file_path text not null, mime_type text not null default 'audio/webm', duration_seconds double precision,
  transcript text, raw_transcript text, structured_transcript text, corrections jsonb not null default '[]',
  transcript_segments jsonb not null default '[]', knowledge_entry_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(node_id,user_id) references public.study_nodes(id,user_id) on delete cascade,
  foreign key(knowledge_entry_id,user_id) references public.knowledge_entries(id,user_id) on delete set null (knowledge_entry_id)
);
create index recordings_owner_node_idx on public.recordings(user_id,node_id);

create table public.flashcards (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, material_id uuid, scope_node_id uuid,
  front text not null, back text not null,
  fsrs_due timestamptz not null default now(), fsrs_stability double precision not null default 0,
  fsrs_difficulty double precision not null default 0, fsrs_elapsed_days integer not null default 0,
  fsrs_scheduled_days integer not null default 0, fsrs_learning_steps integer not null default 0,
  fsrs_reps integer not null default 0, fsrs_lapses integer not null default 0, fsrs_state integer not null default 0,
  fsrs_last_review timestamptz, fsrs_updated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,user_id), foreign key(scope_node_id,user_id) references public.study_nodes(id,user_id) on delete cascade
);
create index flashcards_user_due_idx on public.flashcards(user_id,fsrs_due);
create table public.flashcard_reviews (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, flashcard_id uuid not null,
  rating integer not null check(rating between 1 and 4), reviewed_at timestamptz not null default now(),
  due_before timestamptz, due_after timestamptz not null, stability double precision not null default 0,
  difficulty double precision not null default 0, state integer not null default 0,
  scheduled_days integer not null default 0, elapsed_days integer not null default 0,
  foreign key(flashcard_id,user_id) references public.flashcards(id,user_id) on delete cascade
);
create index flashcard_reviews_user_card_time_idx on public.flashcard_reviews(user_id,flashcard_id,reviewed_at desc);
create table public.quizzes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, material_id uuid, scope_node_id uuid,
  question text not null, choices jsonb not null default '[]', correct_answer text not null default '', explanation text not null default '',
  quiz_type text not null default 'mcq' check(quiz_type in ('mcq','essay')),
  grading_mode text not null default 'fixed' check(grading_mode in ('fixed','ai')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(scope_node_id,user_id) references public.study_nodes(id,user_id) on delete cascade
);
create index quizzes_owner_scope_idx on public.quizzes(user_id,scope_node_id);
create table public.study_tasks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, node_id uuid not null,
  task_type text not null check(task_type in ('quiz','todo')), submission_url text not null default '',
  submission_format text not null default 'none' check(submission_format in ('none','pptx','docx','pdf','other')),
  submission_format_other text not null default '', notes text not null default '',
  quiz_items jsonb not null default '[]', todo_items jsonb not null default '[]', responses jsonb not null default '{}',
  completed boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(node_id,user_id), foreign key(node_id,user_id) references public.study_nodes(id,user_id) on delete cascade
);
create table public.study_paths (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, node_id uuid not null,
  source_node_ids uuid[] not null default '{}', source_file_ids uuid[] not null default '{}',
  ai_mode text not null default 'instant', ai_model text, ai_effort text,
  title text not null default '', overview text not null default '', focus_instruction text not null default '',
  teaching_depth text not null default 'medium', quiz_per_chapter boolean not null default true,
  custom_chapter_titles text[] not null default '{}', status text not null default 'processing' check(status in ('processing','ready','error')),
  error_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(node_id,user_id), unique(id,user_id), foreign key(node_id,user_id) references public.study_nodes(id,user_id) on delete cascade
);
create table public.study_units (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, study_path_id uuid not null,
  position integer not null default 0, unit_level text not null default 'chapter' check(unit_level in ('chapter','subchapter')),
  title text not null, teaching_text text not null default '', recall_question text not null default '',
  recall_choices jsonb not null default '[]', recall_correct_answer text not null default '', recall_explanation text not null default '',
  is_unlocked boolean not null default false, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(study_path_id,user_id) references public.study_paths(id,user_id) on delete cascade
);
create index study_units_path_position_idx on public.study_units(study_path_id,position);

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, title text not null default 'Chat baru',
  -- A private chat may use an accepted friend's read-only reference scope.
  scope_node_id uuid references public.study_nodes(id) on delete set null,
  settings jsonb not null default '{}', last_message_at timestamptz not null default now(), pinned_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create index ai_conversations_owner_recent_idx on public.ai_conversations(user_id,last_message_at desc);
create table public.ai_messages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, conversation_id uuid not null,
  role text not null check(role in ('user','assistant')), content text not null, model text,
  sources jsonb not null default '[]', web_sources jsonb not null default '[]', warning text,
  created_at timestamptz not null default now(),
  foreign key(conversation_id,user_id) references public.ai_conversations(id,user_id) on delete cascade
);
create index ai_messages_conversation_time_idx on public.ai_messages(conversation_id,created_at);

create table public.knowledge_vector_chunks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, entry_id uuid not null, node_id uuid, source_file_id uuid,
  source_page_start integer, source_page_end integer, chunk_index integer not null check(chunk_index>=0),
  snippet text not null, model text not null, embedding public.vector(384) not null, entry_updated_at timestamptz not null,
  created_at timestamptz not null default now(), unique(entry_id,model,chunk_index),
  foreign key(entry_id,user_id) references public.knowledge_entries(id,user_id) on delete cascade,
  foreign key(node_id,user_id) references public.study_nodes(id,user_id) on delete cascade,
  foreign key(source_file_id,user_id) references public.source_files(id,user_id) on delete cascade
);
create index knowledge_vectors_owner_model_idx on public.knowledge_vector_chunks(user_id,model);
create table public.knowledge_vector_state (
  entry_id uuid not null, user_id uuid not null, model text not null, entry_updated_at timestamptz not null,
  next_chunk_index integer not null default 0 check(next_chunk_index>=0), complete boolean not null default false,
  indexed_at timestamptz not null default now(), primary key(entry_id,model),
  foreign key(entry_id,user_id) references public.knowledge_entries(id,user_id) on delete cascade
);

create table public.user_profiles (
  user_id uuid primary key, username text not null check(char_length(username) between 3 and 32 and username ~ '^[a-z0-9._]+$'),
  display_name text not null default '' check(char_length(display_name)<=80), bio text not null default '' check(char_length(bio)<=220),
  avatar_url text, avatar_emoji text not null default '📚' check(char_length(avatar_emoji) between 1 and 16),
  avatar_bg_color text not null default '#10231d' check(avatar_bg_color ~ '^#[0-9A-Fa-f]{6}$'),
  onboarding_completed boolean not null default false, auto_accept_friends boolean not null default false,
  last_active_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index user_profiles_username_lower_unique on public.user_profiles(lower(username));
create index user_profiles_last_active_idx on public.user_profiles(last_active_at desc) where last_active_at is not null;
create table public.friend_connections (
  id uuid primary key default gen_random_uuid(), requester_id uuid not null references public.user_profiles(user_id) on delete cascade,
  addressee_id uuid not null references public.user_profiles(user_id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), accepted_at timestamptz,
  check(requester_id<>addressee_id)
);
create unique index friend_connections_pair_unique on public.friend_connections(least(requester_id,addressee_id),greatest(requester_id,addressee_id));
create index friend_connections_requester_idx on public.friend_connections(requester_id,status,updated_at desc);
create index friend_connections_addressee_idx on public.friend_connections(addressee_id,status,updated_at desc);

create table private.ai_daily_usage (
  user_id uuid not null, usage_date date not null, credits_used integer not null default 0 check(credits_used>=0),
  ask_count integer not null default 0, study_count integer not null default 0, transcription_count integer not null default 0,
  file_light_count integer not null default 0, file_heavy_count integer not null default 0,
  input_tokens bigint not null default 0, output_tokens bigint not null default 0, thoughts_tokens bigint not null default 0,
  total_tokens bigint not null default 0, gemini_request_count integer not null default 0, shared_request_count integer not null default 0,
  updated_at timestamptz not null default now(), primary key(user_id,usage_date)
);
create table private.ai_model_daily_usage (
  user_id uuid not null, usage_date date not null, model text not null, requests integer not null default 0,
  input_tokens bigint not null default 0, output_tokens bigint not null default 0, thoughts_tokens bigint not null default 0,
  total_tokens bigint not null default 0, updated_at timestamptz not null default now(), primary key(user_id,usage_date,model)
);

-- All ownership-bearing edits refresh timestamps, including RAW edits, so
-- embedding checkpoints invalidate when source content changes.
create function private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end $$;
do $$ declare table_name text; begin
  foreach table_name in array array['study_nodes','source_files','knowledge_entries','recordings','flashcards','quizzes','study_tasks','study_paths','study_units','ai_conversations','user_profiles','friend_connections'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',table_name);
  end loop;
end $$;

-- No Supabase auth.users triggers, storage schema, or legacy embedding kicker.
-- Neon Auth lifecycle remains managed by Neon; the existing onboarding flow
-- creates and updates the signed-in user's profile.
