create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null default '',
  bio text not null default '',
  avatar_url text,
  auto_accept_friends boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_username_length check (char_length(username) between 3 and 32),
  constraint user_profiles_username_chars check (username ~ '^[a-z0-9._]+$'),
  constraint user_profiles_display_name_length check (char_length(display_name) <= 80),
  constraint user_profiles_bio_length check (char_length(bio) <= 220)
);
create unique index if not exists user_profiles_username_lower_unique on public.user_profiles(lower(username));

create table if not exists public.friend_connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint friend_connections_not_self check (requester_id <> addressee_id)
);
create unique index if not exists friend_connections_pair_unique
  on public.friend_connections(least(requester_id,addressee_id),greatest(requester_id,addressee_id));
create index if not exists friend_connections_requester_idx on public.friend_connections(requester_id,status,updated_at desc);
create index if not exists friend_connections_addressee_idx on public.friend_connections(addressee_id,status,updated_at desc);

alter table public.user_profiles enable row level security;
alter table public.friend_connections enable row level security;

create policy user_profiles_select_authenticated on public.user_profiles for select to authenticated using (true);
create policy user_profiles_insert_own on public.user_profiles for insert to authenticated with check ((select auth.uid())=user_id);
create policy user_profiles_update_own on public.user_profiles for update to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy friend_connections_select_participant on public.friend_connections for select to authenticated
  using ((select auth.uid()) in (requester_id,addressee_id));

create or replace function public.touch_social_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;
drop trigger if exists user_profiles_touch_updated_at on public.user_profiles;
create trigger user_profiles_touch_updated_at before update on public.user_profiles
for each row execute function public.touch_social_updated_at();
drop trigger if exists friend_connections_touch_updated_at on public.friend_connections;
create trigger friend_connections_touch_updated_at before update on public.friend_connections
for each row execute function public.touch_social_updated_at();

create or replace function public.make_profile_for_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare base_name text; safe_username text; display_value text; picture_value text;
begin
  base_name:=lower(regexp_replace(split_part(coalesce(new.email,'user'),'@',1),'[^a-z0-9._]+','','g'));
  if char_length(base_name)<3 then base_name:='user'; end if;
  safe_username:=left(base_name,24)||'_'||substr(replace(new.id::text,'-',''),1,6);
  display_value:=coalesce(nullif(new.raw_user_meta_data->>'full_name',''),nullif(new.raw_user_meta_data->>'name',''),split_part(coalesce(new.email,'Ruang Belajar'),'@',1));
  picture_value:=coalesce(nullif(new.raw_user_meta_data->>'avatar_url',''),nullif(new.raw_user_meta_data->>'picture',''));
  insert into public.user_profiles(user_id,username,display_name,avatar_url)
  values(new.id,safe_username,left(display_value,80),picture_value)
  on conflict(user_id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_create_profile on auth.users;
create trigger on_auth_user_create_profile after insert on auth.users
for each row execute function public.make_profile_for_new_user();

insert into public.user_profiles(user_id,username,display_name,avatar_url)
select u.id,
  left(case when char_length(lower(regexp_replace(split_part(coalesce(u.email,'user'),'@',1),'[^a-z0-9._]+','','g')))>=3
    then lower(regexp_replace(split_part(coalesce(u.email,'user'),'@',1),'[^a-z0-9._]+','','g')) else 'user' end,24)
    ||'_'||substr(replace(u.id::text,'-',''),1,6),
  left(coalesce(nullif(u.raw_user_meta_data->>'full_name',''),nullif(u.raw_user_meta_data->>'name',''),split_part(coalesce(u.email,'Ruang Belajar'),'@',1)),80),
  coalesce(nullif(u.raw_user_meta_data->>'avatar_url',''),nullif(u.raw_user_meta_data->>'picture',''))
from auth.users u on conflict(user_id) do nothing;

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

create policy study_nodes_select_accepted_friend on public.study_nodes for select to authenticated using (
  exists(select 1 from public.friend_connections f where f.status='accepted' and
    ((f.requester_id=(select auth.uid()) and f.addressee_id=study_nodes.user_id) or
     (f.addressee_id=(select auth.uid()) and f.requester_id=study_nodes.user_id)))
);
create policy knowledge_entries_select_accepted_friend on public.knowledge_entries for select to authenticated using (
  exists(select 1 from public.friend_connections f where f.status='accepted' and
    ((f.requester_id=(select auth.uid()) and f.addressee_id=knowledge_entries.user_id) or
     (f.addressee_id=(select auth.uid()) and f.requester_id=knowledge_entries.user_id)))
);
create policy source_files_select_accepted_friend on public.source_files for select to authenticated using (
  processing_status='ready' and exists(select 1 from public.friend_connections f where f.status='accepted' and
    ((f.requester_id=(select auth.uid()) and f.addressee_id=source_files.user_id) or
     (f.addressee_id=(select auth.uid()) and f.requester_id=source_files.user_id)))
);
create policy recordings_select_accepted_friend on public.recordings for select to authenticated using (
  exists(select 1 from public.friend_connections f where f.status='accepted' and
    ((f.requester_id=(select auth.uid()) and f.addressee_id=recordings.user_id) or
     (f.addressee_id=(select auth.uid()) and f.requester_id=recordings.user_id)))
);

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
