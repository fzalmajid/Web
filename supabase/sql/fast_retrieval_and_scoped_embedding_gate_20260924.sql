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
