create or replace function public.send_friend_request(p_target_user_id uuid)
returns table(connection_id uuid,connection_status text)
language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); existing public.friend_connections%rowtype; auto_accept boolean:=false;
begin
  if me is null then raise exception 'Login diperlukan'; end if;
  if p_target_user_id is null or p_target_user_id=me then raise exception 'Akun tujuan tidak valid'; end if;
  if not exists(select 1 from public.user_profiles p where p.user_id=p_target_user_id) then raise exception 'Profil tidak ditemukan'; end if;
  select coalesce(p.auto_accept_friends,false) into auto_accept from public.user_profiles p where p.user_id=p_target_user_id;
  select * into existing from public.friend_connections f
  where least(f.requester_id,f.addressee_id)=least(me,p_target_user_id)
    and greatest(f.requester_id,f.addressee_id)=greatest(me,p_target_user_id) limit 1;
  if existing.id is not null then
    if existing.status='accepted' then return query select existing.id,'accepted'::text; return; end if;
    if existing.status='pending' and existing.requester_id=p_target_user_id and existing.addressee_id=me then
      update public.friend_connections set status='accepted',accepted_at=now(),updated_at=now() where id=existing.id;
      return query select existing.id,'accepted'::text; return;
    end if;
    update public.friend_connections
    set requester_id=me,addressee_id=p_target_user_id,
        status=case when auto_accept then 'accepted' else 'pending' end,
        accepted_at=case when auto_accept then now() else null end,updated_at=now()
    where id=existing.id;
    return query select existing.id,case when auto_accept then 'accepted'::text else 'pending'::text end; return;
  end if;
  insert into public.friend_connections(requester_id,addressee_id,status,accepted_at)
  values(me,p_target_user_id,case when auto_accept then 'accepted' else 'pending' end,case when auto_accept then now() else null end)
  returning id,status into connection_id,connection_status;
  return next;
end; $$;

create or replace function public.respond_friend_request(p_connection_id uuid,p_accept boolean)
returns text language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); current_row public.friend_connections%rowtype;
begin
  if me is null then raise exception 'Login diperlukan'; end if;
  select * into current_row from public.friend_connections where id=p_connection_id for update;
  if current_row.id is null or current_row.addressee_id<>me or current_row.status<>'pending' then
    raise exception 'Permintaan teman tidak tersedia';
  end if;
  update public.friend_connections
  set status=case when p_accept then 'accepted' else 'declined' end,
      accepted_at=case when p_accept then now() else null end,updated_at=now()
  where id=p_connection_id;
  return case when p_accept then 'accepted' else 'declined' end;
end; $$;

create or replace function public.remove_friend(p_other_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); removed integer;
begin
  if me is null then raise exception 'Login diperlukan'; end if;
  delete from public.friend_connections where status='accepted'
    and ((requester_id=me and addressee_id=p_other_user_id) or (requester_id=p_other_user_id and addressee_id=me));
  get diagnostics removed=row_count; return removed>0;
end; $$;

create or replace function public.cancel_friend_request(p_other_user_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); removed integer;
begin
  if me is null then raise exception 'Login diperlukan'; end if;
  delete from public.friend_connections where status='pending' and requester_id=me and addressee_id=p_other_user_id;
  get diagnostics removed=row_count; return removed>0;
end; $$;

revoke all on function public.send_friend_request(uuid) from public,anon;
revoke all on function public.respond_friend_request(uuid,boolean) from public,anon;
revoke all on function public.remove_friend(uuid) from public,anon;
revoke all on function public.cancel_friend_request(uuid) from public,anon;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid,boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;

create or replace function public.profile_social_stats(p_user_id uuid)
returns table(study_rooms bigint,friends bigint)
language sql stable security definer set search_path=public as $$
  select
    (select count(*) from public.study_nodes n where n.user_id=p_user_id and n.parent_id is null and n.node_type in ('material','submaterial','database')),
    (select count(*) from public.friend_connections f where f.status='accepted' and p_user_id in(f.requester_id,f.addressee_id));
$$;
revoke all on function public.profile_social_stats(uuid) from public,anon;
grant execute on function public.profile_social_stats(uuid) to authenticated;

create or replace function public.search_shared_reference(
  p_owner_user_id uuid,search_query text,result_limit integer default 80,scope_node_id uuid default null,
  source_node_ids uuid[] default '{}'::uuid[],source_file_ids uuid[] default '{}'::uuid[],use_selected boolean default false
)
returns table(id uuid,node_id uuid,title text,category text,content text,source_type text,score integer,source_file_id uuid,source_page_start integer,source_page_end integer)
language sql stable set search_path='' as $function$
with recursive
permitted(ok) as (
  select p_owner_user_id=(select auth.uid()) or exists(
    select 1 from public.friend_connections f where f.status='accepted' and
    ((f.requester_id=(select auth.uid()) and f.addressee_id=p_owner_user_id) or
     (f.addressee_id=(select auth.uid()) and f.requester_id=p_owner_user_id))
  )
),
scope_tree(id) as (
  select n.id from public.study_nodes n,permitted p where p.ok and n.user_id=p_owner_user_id and n.id=scope_node_id
  union select n.id from public.study_nodes n join scope_tree st on n.parent_id=st.id where n.user_id=p_owner_user_id
),
selected_tree(id) as (
  select n.id from public.study_nodes n,permitted p where p.ok and n.user_id=p_owner_user_id and n.id=any(coalesce(source_node_ids,'{}'::uuid[]))
  union select n.id from public.study_nodes n join selected_tree st on n.parent_id=st.id where n.user_id=p_owner_user_id
),
raw_tokens(token) as (
  select distinct token from regexp_split_to_table(lower(regexp_replace(coalesce(search_query,''),'[^[:alnum:]_]+',' ','g')),'[[:space:]]+') token
  where length(token)>=3 and token not in (
    'yang','dan','atau','dari','untuk','dengan','tentang','secara','detail','apa','ada','nya','berapa','halaman','sebutin','sebutkan','dikutip','kutip',
    'monografi','materi','database','reference','folder','file','dokumen','sumber','ini','itu','pada','dalam','saya','aku','mau','ingin','tolong','carikan','cari','temukan',
    'jelasin','jelaskan','the','and','for','with','from','about','page','find','show','search','explain','describe'
  ) limit 24
),
synonym_map(source,synonym) as (
  values ('paracetamol','parasetamol'),('paracetamol','acetaminophen'),('paracetamol','acetaminofen'),
    ('parasetamol','paracetamol'),('parasetamol','acetaminophen'),('acetaminophen','paracetamol'),('acetaminophen','parasetamol'),
    ('eksipien','excipient'),('eksipien','excipients'),('excipient','eksipien'),('sediaan','dosage'),('sediaan','formulation'),
    ('formulasi','formulation'),('obat','drug'),('drug','obat'),('pelarut','solvent'),('solvent','pelarut'),('pengikat','binder'),
    ('binder','pengikat'),('pengisi','diluent'),('diluent','pengisi'),('pelicin','lubricant'),('lubricant','pelicin'),
    ('penghancur','disintegrant'),('disintegrant','penghancur')
),
tokens as (select token from raw_tokens union select sm.synonym from raw_tokens rt join synonym_map sm on sm.source=rt.token),
q as (
  select case when count(*)=0 then null::tsquery else to_tsquery('simple',string_agg(regexp_replace(token,'[^[:alnum:]_]','','g')||':*',' | ')) end search_terms
  from (select distinct token from tokens where length(token)>=3)t
),
matched as materialized (
  select k.id,k.node_id,k.title,k.category,k.content,k.source_type,k.source_file_id,k.source_page_start,k.source_page_end,k.updated_at,
    coalesce(k.source_file_id::text,'entry:'||k.id::text) file_key,q.search_terms,k.body_search_vector document_vector
  from public.knowledge_entries k cross join q cross join permitted p
  where p.ok and k.user_id=p_owner_user_id and q.search_terms is not null and k.body_search_vector@@q.search_terms
    and ((use_selected and (k.node_id in(select id from selected_tree) or k.source_file_id=any(coalesce(source_file_ids,'{}'::uuid[]))))
      or (not use_selected and (scope_node_id is null or k.node_id in(select id from scope_tree))))
),
scored as (
  select m.*,round(ts_rank_cd(m.document_vector,m.search_terms,32)*100000)::integer score from matched m
),
ranked as (
  select s.*,row_number() over(partition by s.file_key order by s.score desc,s.source_page_start nulls last,s.updated_at desc) chunk_rank from scored s
)
select r.id,r.node_id,r.title,r.category,r.content,r.source_type,r.score,r.source_file_id,r.source_page_start,r.source_page_end
from ranked r where r.chunk_rank<=6 order by r.score desc,r.source_page_start nulls last,r.updated_at desc
limit greatest(1,least(coalesce(result_limit,80),100));
$function$;
revoke all on function public.search_shared_reference(uuid,text,integer,uuid,uuid[],uuid[],boolean) from anon;
grant execute on function public.search_shared_reference(uuid,text,integer,uuid,uuid[],uuid[],boolean) to authenticated;
create or replace function public.get_shared_reference(
  p_owner_user_id uuid,result_limit integer default 60,scope_node_id uuid default null,
  source_node_ids uuid[] default '{}'::uuid[],source_file_ids uuid[] default '{}'::uuid[],use_selected boolean default false
)
returns table(id uuid,node_id uuid,title text,category text,content text,source_type text,score integer,source_file_id uuid,source_page_start integer,source_page_end integer)
language sql stable set search_path='' as $function$
with recursive
permitted(ok) as (
  select p_owner_user_id=(select auth.uid()) or exists(
    select 1 from public.friend_connections f where f.status='accepted' and
    ((f.requester_id=(select auth.uid()) and f.addressee_id=p_owner_user_id) or
     (f.addressee_id=(select auth.uid()) and f.requester_id=p_owner_user_id))
  )
),
scope_tree(id) as (
  select n.id from public.study_nodes n,permitted p where p.ok and n.user_id=p_owner_user_id and n.id=scope_node_id
  union select n.id from public.study_nodes n join scope_tree st on n.parent_id=st.id where n.user_id=p_owner_user_id
),
selected_tree(id) as (
  select n.id from public.study_nodes n,permitted p where p.ok and n.user_id=p_owner_user_id and n.id=any(coalesce(source_node_ids,'{}'::uuid[]))
  union select n.id from public.study_nodes n join selected_tree st on n.parent_id=st.id where n.user_id=p_owner_user_id
)
select k.id,k.node_id,k.title,k.category,k.content,k.source_type,1::integer,k.source_file_id,k.source_page_start,k.source_page_end
from public.knowledge_entries k cross join permitted p
where p.ok and k.user_id=p_owner_user_id
  and ((use_selected and (k.node_id in(select id from selected_tree) or k.source_file_id=any(coalesce(source_file_ids,'{}'::uuid[]))))
    or (not use_selected and (scope_node_id is null or k.node_id in(select id from scope_tree))))
order by k.updated_at desc,k.source_page_start nulls last
limit greatest(1,least(coalesce(result_limit,60),100));
$function$;
revoke all on function public.get_shared_reference(uuid,integer,uuid,uuid[],uuid[],boolean) from anon;
grant execute on function public.get_shared_reference(uuid,integer,uuid,uuid[],uuid[],boolean) to authenticated;
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

