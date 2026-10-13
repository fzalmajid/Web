-- Access is installed within the migration transaction before any API grants.
do $$ declare table_name text; begin
  foreach table_name in array array['study_nodes','source_files','knowledge_entries','recordings','flashcards','quizzes','study_tasks','study_paths','study_units','ai_conversations','ai_messages','knowledge_vector_chunks','knowledge_vector_state','flashcard_reviews'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('create policy own_rows on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',table_name);
    execute format('revoke all on table public.%I from public,anon,anonymous,authenticated',table_name);
    execute format('grant select,insert,update,delete on table public.%I to authenticated',table_name);
  end loop;
end $$;

alter table public.user_profiles enable row level security;
create policy profiles_authenticated_read on public.user_profiles for select to authenticated using ((select auth.uid()) is not null);
create policy profiles_own_insert on public.user_profiles for insert to authenticated with check ((select auth.uid())=user_id);
create policy profiles_own_update on public.user_profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.user_profiles from public,anon,anonymous,authenticated;
grant select,insert,update on public.user_profiles to authenticated;

alter table public.friend_connections enable row level security;
create policy friends_participant_read on public.friend_connections for select to authenticated
  using ((select auth.uid()) in(requester_id,addressee_id));
revoke all on public.friend_connections from public,anon,anonymous,authenticated;
grant select on public.friend_connections to authenticated;

create policy study_nodes_accepted_friend_read on public.study_nodes for select to authenticated using (
  exists(select 1 from public.friend_connections f where f.status='accepted' and
    ((f.requester_id=(select auth.uid()) and f.addressee_id=study_nodes.user_id) or
     (f.addressee_id=(select auth.uid()) and f.requester_id=study_nodes.user_id)))
);
create policy source_files_accepted_friend_read on public.source_files for select to authenticated using (
  processing_status='ready' and exists(select 1 from public.friend_connections f where f.status='accepted' and
    ((f.requester_id=(select auth.uid()) and f.addressee_id=source_files.user_id) or
     (f.addressee_id=(select auth.uid()) and f.requester_id=source_files.user_id)))
);
create policy knowledge_entries_accepted_friend_read on public.knowledge_entries for select to authenticated using (
  exists(select 1 from public.friend_connections f where f.status='accepted' and
    ((f.requester_id=(select auth.uid()) and f.addressee_id=knowledge_entries.user_id) or
     (f.addressee_id=(select auth.uid()) and f.requester_id=knowledge_entries.user_id)))
  and (source_file_id is null or exists(select 1 from public.source_files sf where sf.id=knowledge_entries.source_file_id and sf.processing_status='ready'))
);
create policy recordings_accepted_friend_read on public.recordings for select to authenticated using (
  exists(select 1 from public.friend_connections f where f.status='accepted' and
    ((f.requester_id=(select auth.uid()) and f.addressee_id=recordings.user_id) or
     (f.addressee_id=(select auth.uid()) and f.requester_id=recordings.user_id)))
);

-- Reviews are immutable history, written by the atomic review RPC or offline
-- sync. A review's owner/card relationship is also a composite foreign key.
revoke update on public.flashcard_reviews from authenticated;
drop policy own_rows on public.flashcard_reviews;
create policy reviews_own_select on public.flashcard_reviews for select to authenticated using ((select auth.uid())=user_id);
create policy reviews_own_insert on public.flashcard_reviews for insert to authenticated with check ((select auth.uid())=user_id);
create policy reviews_own_delete on public.flashcard_reviews for delete to authenticated using ((select auth.uid())=user_id);
alter table private.ai_daily_usage enable row level security;
alter table private.ai_model_daily_usage enable row level security;
revoke all on all tables in schema private from public,anon,anonymous,authenticated;
revoke all on all functions in schema private from public,anon,anonymous,authenticated;
revoke all on schema private from public,anon,anonymous,authenticated;

-- No ambient execute privileges on the app's RPCs. Extension-owned vector
-- functions retain their extension permissions; only explicit app RPCs open.
do $$ declare function_name regprocedure; begin
  for function_name in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
  loop execute format('revoke all on function %s from public,anon,anonymous,authenticated',function_name); end loop;
end $$;
grant usage on schema public,auth to authenticated;
revoke all on function auth.uid() from public,anon,anonymous;
grant execute on function auth.uid() to authenticated;
grant execute on function public.consume_ai_credits(text,text),public.get_ai_usage_today(),
  public.record_ai_model_usage(text,bigint,bigint,bigint,bigint),public.get_ai_model_usage_today(),
  public.get_scope_knowledge(uuid,integer),public.get_selected_knowledge(integer,uuid[],uuid[]),
  public.search_knowledge(text,integer,uuid),public.search_knowledge_selected(text,integer,uuid[],uuid[]),
  public.lookup_source_bibliography(uuid[]),
  public.count_pending_knowledge_embeddings(text),public.count_pending_knowledge_embeddings_scoped(text,uuid,uuid[],uuid[],boolean),
  public.pending_knowledge_embeddings(text,integer),public.pending_knowledge_embeddings_priority(text,integer,uuid[],uuid[]),
  public.match_knowledge_vectors(double precision[],text,uuid,uuid[],uuid[],boolean,double precision,integer),
  public.send_friend_request(uuid),public.respond_friend_request(uuid,boolean),public.remove_friend(uuid),public.cancel_friend_request(uuid),
  public.profile_social_stats(uuid),public.search_shared_reference(uuid,text,integer,uuid,uuid[],uuid[],boolean),
  public.get_shared_reference(uuid,integer,uuid,uuid[],uuid[],boolean),
  public.sync_learning_review(uuid,uuid,timestamptz,integer,timestamptz,jsonb)
to authenticated;

-- Retain the pool functions' existing auth guard and daily transaction lock.
-- They need definer access because usage tables have no client permissions.
alter function public.consume_ai_credits(text,text) security definer;
alter function public.get_ai_usage_today() security definer;

-- Avoid two simultaneous requests for the same unordered friendship pair.
-- All status changes are server-controlled RPCs, never direct client writes.
create or replace function public.send_friend_request(p_target_user_id uuid)
returns table(connection_id uuid,connection_status text)
language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); existing public.friend_connections%rowtype; auto_accept boolean:=false;
begin
  if me is null then raise exception 'Login diperlukan'; end if;
  if p_target_user_id is null or p_target_user_id=me then raise exception 'Akun tujuan tidak valid'; end if;
  if not exists(select 1 from public.user_profiles p where p.user_id=me) then raise exception 'Lengkapi profil terlebih dahulu'; end if;
  if not exists(select 1 from public.user_profiles p where p.user_id=p_target_user_id) then raise exception 'Profil tidak ditemukan'; end if;
  perform pg_advisory_xact_lock(hashtext('ruang-belajar-friends:'||least(me,p_target_user_id)::text||':'||greatest(me,p_target_user_id)::text));
  select coalesce(p.auto_accept_friends,false) into auto_accept from public.user_profiles p where p.user_id=p_target_user_id;
  select * into existing from public.friend_connections f
    where least(f.requester_id,f.addressee_id)=least(me,p_target_user_id) and greatest(f.requester_id,f.addressee_id)=greatest(me,p_target_user_id) for update;
  if existing.id is not null then
    if existing.status='accepted' then return query select existing.id,'accepted'::text; return; end if;
    if existing.status='pending' and existing.requester_id=p_target_user_id and existing.addressee_id=me then
      update public.friend_connections set status='accepted',accepted_at=now(),updated_at=now() where id=existing.id;
      return query select existing.id,'accepted'::text; return;
    end if;
    update public.friend_connections set requester_id=me,addressee_id=p_target_user_id,
      status=case when auto_accept then 'accepted' else 'pending' end,
      accepted_at=case when auto_accept then now() else null end,updated_at=now() where id=existing.id;
    return query select existing.id,case when auto_accept then 'accepted'::text else 'pending'::text end; return;
  end if;
  insert into public.friend_connections(requester_id,addressee_id,status,accepted_at)
    values(me,p_target_user_id,case when auto_accept then 'accepted' else 'pending' end,case when auto_accept then now() else null end)
    returning id,status into connection_id,connection_status;
  return next;
end $$;
