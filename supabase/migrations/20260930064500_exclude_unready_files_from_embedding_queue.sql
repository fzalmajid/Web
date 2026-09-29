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
