-- Applied to Supabase for Ruang Belajar on 2026-09-24.
-- Source: pg_get_functiondef from the live project; keep SQL in GitHub.
-- Important: SECURITY INVOKER and auth.uid() preserve RLS.

-- 2026-09-25: precompute the expensive full-text vector once. Some imported
-- OCR entries exceed one million characters; rebuilding to_tsvector during
-- every ranked search caused PostgREST statement_timeout (SQLSTATE 57014).
ALTER TABLE public.knowledge_entries
  ADD COLUMN IF NOT EXISTS body_search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(nullif(raw_content, ''::text), content, ''::text)
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS knowledge_entries_body_search_vector_idx
  ON public.knowledge_entries USING gin (body_search_vector);


CREATE OR REPLACE FUNCTION public.count_pending_knowledge_embeddings_scoped(p_model text, p_scope_node_id uuid DEFAULT NULL::uuid, p_source_node_ids uuid[] DEFAULT '{}'::uuid[], p_source_file_ids uuid[] DEFAULT '{}'::uuid[], p_use_selected boolean DEFAULT false)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with recursive
scope_tree(id) as (
 select n.id from public.study_nodes n
 where n.user_id=(select auth.uid()) and n.id=p_scope_node_id
 union
 select n.id from public.study_nodes n
 join scope_tree st on n.parent_id=st.id
 where n.user_id=(select auth.uid())
),
selected_tree(id) as (
 select n.id from public.study_nodes n
 where n.user_id=(select auth.uid())
 and n.id=any(coalesce(p_source_node_ids,'{}'::uuid[]))
 union
 select n.id from public.study_nodes n
 join selected_tree st on n.parent_id=st.id
 where n.user_id=(select auth.uid())
)
select count(*)::integer
from public.knowledge_entries e
left join public.knowledge_vector_state s
 on s.entry_id=e.id and s.model=p_model and s.user_id=(select auth.uid())
where e.user_id=(select auth.uid())
 and e.source_type is distinct from 'transcript'
 and (e.source_file_id is null or exists (
   select 1 from public.source_files sf where sf.id=e.source_file_id
     and sf.user_id=(select auth.uid()) and sf.processing_status='ready'
 ))
 and length(coalesce(nullif(e.raw_content,''),e.content,''))>=80
 and (
   (p_use_selected and (
      e.node_id in (select id from selected_tree)
      or e.source_file_id=any(coalesce(p_source_file_ids,'{}'::uuid[]))
   ))
   or (not p_use_selected and (
      p_scope_node_id is null or e.node_id in (select id from scope_tree)
   ))
 )
 and (s.entry_id is null or s.entry_updated_at is distinct from e.updated_at or not s.complete)
$function$;

CREATE OR REPLACE FUNCTION public.search_knowledge(search_query text, result_limit integer DEFAULT 8, scope_node_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, node_id uuid, title text, category text, content text, source_type text, score integer, source_file_id uuid, source_page_start integer, source_page_end integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with recursive

scope_tree(id) as (
 select n.id from public.study_nodes n
 where n.user_id=(select auth.uid()) and n.id=scope_node_id
 union select n.id from public.study_nodes n
 join scope_tree st on n.parent_id=st.id
 where n.user_id=(select auth.uid())
),
raw_tokens(token) as (
 select distinct token from regexp_split_to_table(
  lower(regexp_replace(coalesce(search_query,''),'[^[:alnum:]_]+',' ','g')),
  '[[:space:]]+'
 ) token
 where length(token)>=3 and token not in (
  'yang','dan','atau','dari','untuk','dengan','tentang','secara','detail',
  'apa','ada','nya','berapa','halaman','sebutin','sebutkan','dikutip','kutip',
  'monografi','materi','database','folder','file','dokumen','sumber',
  'ini','itu','pada','dalam','saya','aku','mau','ingin','tolong','carikan','cari','temukan',
  'jelasin','jelaskan','the','and','for','with','from','about','page','find','show','search','explain','describe'
 ) limit 20
),
synonym_map(source,synonym) as (
 values
 ('paracetamol','parasetamol'),('paracetamol','acetaminophen'),('paracetamol','acetaminofen'),
 ('parasetamol','paracetamol'),('parasetamol','acetaminophen'),
 ('acetaminophen','paracetamol'),('acetaminophen','parasetamol'),
 ('eksipien','excipient'),('eksipien','excipients'),('excipient','eksipien'),
 ('sediaan','dosage'),('sediaan','formulation'),('formulasi','formulation'),
 ('obat','drug'),('drug','obat'),('pelarut','solvent'),('solvent','pelarut'),
 ('pengawet','preservative'),('preservative','pengawet'),('pengikat','binder'),
 ('binder','pengikat'),('pengisi','diluent'),('pengisi','filler'),('diluent','pengisi'),
 ('pelicin','lubricant'),('lubricant','pelicin'),('penghancur','disintegrant'),
 ('disintegrant','penghancur')
),
tokens as (
 select token from raw_tokens
 union select sm.synonym from raw_tokens rt join synonym_map sm on sm.source=rt.token
),
q as (
 select case when count(*)=0 then null::tsquery else
  to_tsquery('simple',string_agg(regexp_replace(token,'[^[:alnum:]_]','','g')||':*',' | '))
 end as search_terms
 from (select distinct token from tokens where length(token)>=3) t
),
matched as materialized (
 select k.id,k.node_id,k.title,k.category,k.content,k.source_type,
 k.source_file_id,k.source_page_start,k.source_page_end,k.updated_at,
 coalesce(k.source_file_id::text,'entry:'||k.id::text) file_key,
 q.search_terms,
 k.body_search_vector document_vector
 from public.knowledge_entries k cross join q
 where k.user_id=(select auth.uid()) and (scope_node_id is null or k.node_id in (select id from scope_tree))
 and q.search_terms is not null
 and k.body_search_vector @@ q.search_terms
),
scored as (
 select m.*,
 (round(ts_rank_cd(m.document_vector,m.search_terms,32)*100000)::integer
 + least(round(ts_rank_cd(
  setweight(to_tsvector('simple',coalesce(m.title,'')),'D') ||
  setweight(to_tsvector('simple',coalesce(m.category,'')),'D'),
  m.search_terms,32)*500)::integer,120)) score
 from matched m
),
ranked as (
 select s.*,row_number() over(partition by s.file_key
  order by s.score desc,s.source_page_start nulls last,s.updated_at desc) chunk_rank
 from scored s
)
select r.id,r.node_id,r.title,r.category,r.content,r.source_type,r.score,
 r.source_file_id,r.source_page_start,r.source_page_end
from ranked r where r.chunk_rank<=6
order by r.score desc,r.source_page_start nulls last,r.updated_at desc
limit greatest(1,least(coalesce(result_limit,8),80));
$function$;

CREATE OR REPLACE FUNCTION public.search_knowledge_selected(search_query text, result_limit integer DEFAULT 12, source_node_ids uuid[] DEFAULT '{}'::uuid[], source_file_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(id uuid, node_id uuid, title text, category text, content text, source_type text, score integer, source_file_id uuid, source_page_start integer, source_page_end integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with recursive

selected_tree(id) as (
 select n.id from public.study_nodes n
 where n.user_id=(select auth.uid())
 and n.id=any(coalesce(source_node_ids,'{}'::uuid[]))
 union select n.id from public.study_nodes n
 join selected_tree st on n.parent_id=st.id
 where n.user_id=(select auth.uid())
),
raw_tokens(token) as (
 select distinct token from regexp_split_to_table(
  lower(regexp_replace(coalesce(search_query,''),'[^[:alnum:]_]+',' ','g')),
  '[[:space:]]+'
 ) token
 where length(token)>=3 and token not in (
  'yang','dan','atau','dari','untuk','dengan','tentang','secara','detail',
  'apa','ada','nya','berapa','halaman','sebutin','sebutkan','dikutip','kutip',
  'monografi','materi','database','folder','file','dokumen','sumber',
  'ini','itu','pada','dalam','saya','aku','mau','ingin','tolong','carikan','cari','temukan',
  'jelasin','jelaskan','the','and','for','with','from','about','page','find','show','search','explain','describe'
 ) limit 20
),
synonym_map(source,synonym) as (
 values
 ('paracetamol','parasetamol'),('paracetamol','acetaminophen'),('paracetamol','acetaminofen'),
 ('parasetamol','paracetamol'),('parasetamol','acetaminophen'),
 ('acetaminophen','paracetamol'),('acetaminophen','parasetamol'),
 ('eksipien','excipient'),('eksipien','excipients'),('excipient','eksipien'),
 ('sediaan','dosage'),('sediaan','formulation'),('formulasi','formulation'),
 ('obat','drug'),('drug','obat'),('pelarut','solvent'),('solvent','pelarut'),
 ('pengawet','preservative'),('preservative','pengawet'),('pengikat','binder'),
 ('binder','pengikat'),('pengisi','diluent'),('pengisi','filler'),('diluent','pengisi'),
 ('pelicin','lubricant'),('lubricant','pelicin'),('penghancur','disintegrant'),
 ('disintegrant','penghancur')
),
tokens as (
 select token from raw_tokens
 union select sm.synonym from raw_tokens rt join synonym_map sm on sm.source=rt.token
),
q as (
 select case when count(*)=0 then null::tsquery else
  to_tsquery('simple',string_agg(regexp_replace(token,'[^[:alnum:]_]','','g')||':*',' | '))
 end as search_terms
 from (select distinct token from tokens where length(token)>=3) t
),
matched as materialized (
 select k.id,k.node_id,k.title,k.category,k.content,k.source_type,
 k.source_file_id,k.source_page_start,k.source_page_end,k.updated_at,
 coalesce(k.source_file_id::text,'entry:'||k.id::text) file_key,
 q.search_terms,
 k.body_search_vector document_vector
 from public.knowledge_entries k cross join q
 where k.user_id=(select auth.uid()) and (k.node_id in (select id from selected_tree)
 or k.source_file_id=any(coalesce(source_file_ids,'{}'::uuid[])))
 and q.search_terms is not null
 and k.body_search_vector @@ q.search_terms
),
scored as (
 select m.*,
 (round(ts_rank_cd(m.document_vector,m.search_terms,32)*100000)::integer
 + least(round(ts_rank_cd(
  setweight(to_tsvector('simple',coalesce(m.title,'')),'D') ||
  setweight(to_tsvector('simple',coalesce(m.category,'')),'D'),
  m.search_terms,32)*500)::integer,120)) score
 from matched m
),
ranked as (
 select s.*,row_number() over(partition by s.file_key
  order by s.score desc,s.source_page_start nulls last,s.updated_at desc) chunk_rank
 from scored s
)
select r.id,r.node_id,r.title,r.category,r.content,r.source_type,r.score,
 r.source_file_id,r.source_page_start,r.source_page_end
from ranked r where r.chunk_rank<=6
order by r.score desc,r.source_page_start nulls last,r.updated_at desc
limit greatest(1,least(coalesce(result_limit,8),100));
$function$;

revoke all on function public.count_pending_knowledge_embeddings_scoped(text,uuid,uuid[],uuid[],boolean) from public,anon;
grant execute on function public.count_pending_knowledge_embeddings_scoped(text,uuid,uuid[],uuid[],boolean) to authenticated;
-- Published-work identity hints for hybrid retrieval, deployed on the active Supabase project.
-- Keeps raw cover bytes in PostgreSQL: only short cover excerpts go to Next.js.
-- Do not create this function as SECURITY DEFINER; it must honor users' RLS.
create or replace function public.lookup_source_bibliography(p_source_file_ids uuid[])
returns table(source_file_id uuid, file_name text, front_matter text, size_bytes bigint)
language sql stable security invoker set search_path = ''
as $$
  select f.id, f.file_name,
    coalesce((
      select string_agg(left(coalesce(x.raw_content,x.content,''),950),' ' order by x.source_page_start)
      from (
        select e.raw_content,e.content,e.source_page_start
        from public.knowledge_entries e
        where e.source_file_id=f.id and e.user_id=(select auth.uid())
          and e.source_page_start between 1 and 10
        order by e.source_page_start
        limit 6
      ) x
    ),''), f.size_bytes
  from public.source_files f
  where f.user_id=(select auth.uid())
    and f.id=any(coalesce(p_source_file_ids,'{}'::uuid[]))
$$;
revoke all on function public.lookup_source_bibliography(uuid[]) from public, anon;
grant execute on function public.lookup_source_bibliography(uuid[]) to authenticated;
create or replace function public.count_pending_knowledge_embeddings(p_model text)
returns integer
language sql
stable
set search_path = ''
as $function$
  select count(*)::integer
  from public.knowledge_entries e
  left join public.knowledge_vector_state s
    on s.entry_id=e.id
   and s.model=p_model
   and s.user_id=(select auth.uid())
  left join public.source_files sf
    on sf.id=e.source_file_id
   and sf.user_id=(select auth.uid())
  where e.user_id=(select auth.uid())
    and e.source_type is distinct from 'transcript'
    and length(coalesce(nullif(e.raw_content,''),e.content,'')) >= 80
    and (e.source_file_id is null or sf.processing_status='ready')
    and (
      s.entry_id is null
      or s.entry_updated_at is distinct from e.updated_at
      or not s.complete
    );
$function$;

create or replace function public.pending_knowledge_embeddings(
  p_model text,
  p_limit integer default 4
)
returns table(
  entry_id uuid,
  user_id uuid,
  node_id uuid,
  source_file_id uuid,
  source_page_start integer,
  source_page_end integer,
  title text,
  raw_text text,
  entry_updated_at timestamptz,
  next_chunk_index integer
)
language sql
stable
set search_path = ''
as $function$
  select
    e.id,e.user_id,e.node_id,e.source_file_id,e.source_page_start,e.source_page_end,e.title,
    coalesce(nullif(e.raw_content,''),e.content,''),e.updated_at,
    case when s.entry_updated_at=e.updated_at then s.next_chunk_index else 0 end
  from public.knowledge_entries e
  left join public.knowledge_vector_state s
    on s.entry_id=e.id and s.model=p_model and s.user_id=(select auth.uid())
  left join public.source_files sf
    on sf.id=e.source_file_id and sf.user_id=(select auth.uid())
  where e.user_id=(select auth.uid())
    and e.source_type is distinct from 'transcript'
    and length(coalesce(nullif(e.raw_content,''),e.content,'')) >= 80
    and (e.source_file_id is null or sf.processing_status='ready')
    and (s.entry_id is null or s.entry_updated_at is distinct from e.updated_at or not s.complete)
  order by e.updated_at desc,e.id
  limit greatest(1,least(coalesce(p_limit,4),8));
$function$;

create or replace function public.pending_knowledge_embeddings_priority(
  p_model text,
  p_limit integer default 8,
  p_source_node_ids uuid[] default '{}'::uuid[],
  p_source_file_ids uuid[] default '{}'::uuid[]
)
returns table(
  entry_id uuid,
  user_id uuid,
  node_id uuid,
  source_file_id uuid,
  source_page_start integer,
  source_page_end integer,
  title text,
  raw_text text,
  entry_updated_at timestamptz,
  next_chunk_index integer
)
language sql
stable
set search_path = ''
as $function$
with recursive selected_tree(id) as (
  select n.id from public.study_nodes n
  where n.user_id=(select auth.uid())
    and n.id=any(coalesce(p_source_node_ids,'{}'::uuid[]))
  union
  select n.id from public.study_nodes n
  join selected_tree st on n.parent_id=st.id
  where n.user_id=(select auth.uid())
),
pending as (
  select
    e.id entry_id,e.user_id,e.node_id,e.source_file_id,e.source_page_start,e.source_page_end,e.title,
    coalesce(nullif(e.raw_content,''),e.content,'') raw_text,e.updated_at entry_updated_at,
    case when s.entry_updated_at=e.updated_at then s.next_chunk_index else 0 end next_chunk_index,
    case when (
      e.node_id in (select id from selected_tree)
      or e.source_file_id=any(coalesce(p_source_file_ids,'{}'::uuid[]))
    ) then 0 else 1 end priority_rank
  from public.knowledge_entries e
  left join public.knowledge_vector_state s
    on s.entry_id=e.id and s.model=p_model and s.user_id=(select auth.uid())
  left join public.source_files sf
    on sf.id=e.source_file_id and sf.user_id=(select auth.uid())
  where e.user_id=(select auth.uid())
    and e.source_type is distinct from 'transcript'
    and length(coalesce(nullif(e.raw_content,''),e.content,'')) >= 80
    and (e.source_file_id is null or sf.processing_status='ready')
    and (s.entry_id is null or s.entry_updated_at is distinct from e.updated_at or not s.complete)
)
select p.entry_id,p.user_id,p.node_id,p.source_file_id,p.source_page_start,p.source_page_end,
       p.title,p.raw_text,p.entry_updated_at,p.next_chunk_index
from pending p
order by p.priority_rank,p.entry_updated_at desc,p.entry_id
limit greatest(1,least(coalesce(p_limit,8),8));
$function$;
-- Shared daily pool, preserving counters, authentication, privileges and pool locking.
-- limit/fair_share retain the full pool size for legacy clients; used stays personal.
CREATE OR REPLACE FUNCTION public.consume_ai_credits(action_name text, ai_mode text DEFAULT 'instant'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Jakarta')::date;
  v_pool_total integer := 400;
  v_mode text := lower(coalesce(ai_mode,'instant'));
  v_cost integer;
  v_ask integer:=0; v_study integer:=0; v_transcription integer:=0;
  v_file_light integer:=0; v_file_heavy integer:=0;
  v_user_used integer:=0; v_user_shared_requests integer:=0;
  v_total_used integer:=0; v_active_accounts integer:=0;
  v_prospective_active integer:=1; v_fair_share integer:=0;
  v_user_remaining integer:=0; v_pool_remaining integer:=0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_mode not in ('instant','medium','high') then v_mode:='instant'; end if;

  case action_name
    when 'ask' then
      v_cost:=case v_mode when 'instant' then 1 when 'medium' then 2 else 4 end;
      v_ask:=1;
    when 'ask_web' then
      v_cost:=case v_mode when 'instant' then 3 when 'medium' then 5 else 8 end;
      v_ask:=1;
    when 'study' then
      v_cost:=case v_mode when 'instant' then 2 when 'medium' then 4 else 6 end;
      v_study:=1;
    when 'grade_essay' then
      -- Essay grading is a lighter request. Cost ~= study / 1.7, rounded to integer credits.
      v_cost:=case v_mode when 'instant' then 1 when 'medium' then 2 else 3 end;
      v_study:=1;
    when 'transcription' then
      v_cost:=case v_mode when 'instant' then 5 when 'medium' then 7 else 10 end;
      v_transcription:=1;
    when 'file_light' then
      v_cost:=case v_mode when 'instant' then 2 when 'medium' then 3 else 5 end;
      v_file_light:=1;
    when 'file_heavy' then
      v_cost:=case v_mode when 'instant' then 5 when 'medium' then 7 else 10 end;
      v_file_heavy:=1;
    else
      raise exception 'Invalid AI action';
  end case;

  perform pg_advisory_xact_lock(hashtext('ruang-belajar-ai-pool:'||v_day::text));

  select s.active_accounts,s.total_used into v_active_accounts,v_total_used
  from private.ai_pool_state(v_day) s;

  select coalesce(credits_used,0),coalesce(shared_request_count,0)
    into v_user_used,v_user_shared_requests
  from private.ai_daily_usage
  where user_id=v_uid and usage_date=v_day;

  if not found then v_user_used:=0; v_user_shared_requests:=0; end if;

  v_prospective_active :=
    greatest(1, v_active_accounts + case when v_user_shared_requests>0 then 0 else 1 end);
  v_fair_share := v_pool_total;
  v_user_remaining := greatest(v_fair_share-v_user_used,0);
  v_pool_remaining := greatest(v_pool_total-v_total_used,0);

  if v_cost>v_pool_remaining then
    return jsonb_build_object(
      'allowed',false,'mode',v_mode,'cost',v_cost,'used',v_user_used,
      'limit',v_fair_share,'remaining',v_pool_remaining,
      'fair_share',v_fair_share,'active_accounts',v_prospective_active,
      'quota_policy','shared_pool', 'pool_total',v_pool_total,'pool_used',v_total_used,
      'pool_remaining',v_pool_remaining,'reset_timezone','Asia/Jakarta'
    );
  end if;

  insert into private.ai_daily_usage as u (
    user_id,usage_date,credits_used,ask_count,study_count,transcription_count,
    file_light_count,file_heavy_count,updated_at
  )
  values (
    v_uid,v_day,v_cost,v_ask,v_study,v_transcription,v_file_light,v_file_heavy,now()
  )
  on conflict (user_id,usage_date)
  do update set
    credits_used=u.credits_used+excluded.credits_used,
    ask_count=u.ask_count+excluded.ask_count,
    study_count=u.study_count+excluded.study_count,
    transcription_count=u.transcription_count+excluded.transcription_count,
    file_light_count=u.file_light_count+excluded.file_light_count,
    file_heavy_count=u.file_heavy_count+excluded.file_heavy_count,
    updated_at=now();

  v_user_used:=v_user_used+v_cost;
  select s.active_accounts,s.total_used into v_active_accounts,v_total_used
  from private.ai_pool_state(v_day) s;
  v_fair_share:=v_pool_total;
  v_user_remaining:=greatest(v_fair_share-v_user_used,0);
  v_pool_remaining:=greatest(v_pool_total-v_total_used,0);

  return jsonb_build_object(
    'allowed',true,'mode',v_mode,'cost',v_cost,'used',v_user_used,
    'limit',v_fair_share,'remaining',v_pool_remaining,
    'fair_share',v_fair_share,'active_accounts',greatest(v_active_accounts,1),
    'quota_policy','shared_pool', 'pool_total',v_pool_total,'pool_used',v_total_used,
    'pool_remaining',v_pool_remaining,'reset_timezone','Asia/Jakarta'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_ai_usage_today()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Jakarta')::date;
  v_pool_total integer := 400;
  v_user_used integer := 0;
  v_active_accounts integer := 0;
  v_total_used integer := 0;
  v_effective_active integer := 1;
  v_fair_share integer := 400;

  v_ask integer := 0;
  v_study integer := 0;
  v_transcription integer := 0;
  v_file_light integer := 0;
  v_file_heavy integer := 0;

  v_input_tokens bigint := 0;
  v_output_tokens bigint := 0;
  v_thoughts_tokens bigint := 0;
  v_total_tokens bigint := 0;
  v_gemini_requests integer := 0;
  v_shared_requests integer := 0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select s.active_accounts, s.total_used
    into v_active_accounts, v_total_used
  from private.ai_pool_state(v_day) s;

  select
    coalesce(credits_used,0),
    coalesce(ask_count,0),
    coalesce(study_count,0),
    coalesce(transcription_count,0),
    coalesce(file_light_count,0),
    coalesce(file_heavy_count,0),
    coalesce(input_tokens,0),
    coalesce(output_tokens,0),
    coalesce(thoughts_tokens,0),
    coalesce(total_tokens,0),
    coalesce(gemini_request_count,0),
    coalesce(shared_request_count,0)
  into
    v_user_used,
    v_ask,
    v_study,
    v_transcription,
    v_file_light,
    v_file_heavy,
    v_input_tokens,
    v_output_tokens,
    v_thoughts_tokens,
    v_total_tokens,
    v_gemini_requests,
    v_shared_requests
  from private.ai_daily_usage
  where user_id=v_uid and usage_date=v_day;

  if not found then
    v_user_used:=0; v_ask:=0; v_study:=0; v_transcription:=0;
    v_file_light:=0; v_file_heavy:=0; v_input_tokens:=0; v_output_tokens:=0;
    v_thoughts_tokens:=0; v_total_tokens:=0; v_gemini_requests:=0; v_shared_requests:=0;
  end if;

  -- One shared application pool; active accounts are informational only.
  v_effective_active :=
    greatest(1, v_active_accounts + case when v_shared_requests > 0 then 0 else 1 end);
  v_fair_share := v_pool_total;

  return jsonb_build_object(
    'used', v_user_used,
    'limit', v_fair_share,
    'remaining', greatest(v_pool_total-v_total_used,0),
    'fair_share', v_fair_share,
    'active_accounts', v_effective_active,
    'actual_active_accounts', v_active_accounts,
    'quota_policy','shared_pool', 'pool_total', v_pool_total,
    'pool_used', v_total_used,
    'pool_remaining', greatest(v_pool_total-v_total_used,0),
    'ask_count', v_ask,
    'study_count', v_study,
    'transcription_count', v_transcription,
    'file_light_count', v_file_light,
    'file_heavy_count', v_file_heavy,
    'input_tokens', v_input_tokens,
    'output_tokens', v_output_tokens,
    'thoughts_tokens', v_thoughts_tokens,
    'total_tokens', v_total_tokens,
    'gemini_request_count', v_gemini_requests,
    'shared_request_count', v_shared_requests,
    'reset_timezone', 'Asia/Jakarta'
  );
end;
$function$;

ALTER FUNCTION public.consume_ai_credits(text,text) SECURITY DEFINER;
ALTER FUNCTION public.get_ai_usage_today() SECURITY DEFINER;

