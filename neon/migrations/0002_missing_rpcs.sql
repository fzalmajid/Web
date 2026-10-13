-- Reconstructed RPCs missing from the historical baseline SQL in this repo.
create function private.ai_pool_state(p_day date)
returns table(active_accounts integer,total_used integer)
language sql stable set search_path='' as $$
  select count(*) filter(where shared_request_count>0 or credits_used>0)::integer,
    coalesce(sum(credits_used),0)::integer from private.ai_daily_usage where usage_date=p_day;
$$;

create function public.record_ai_model_usage(model_name text,input_tokens bigint default 0,output_tokens bigint default 0,thoughts_tokens bigint default 0,total_tokens bigint default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); day date:=(now() at time zone 'Asia/Jakarta')::date;
  v_model text:=left(coalesce(nullif(model_name,''),'unknown'),200);
  v_input bigint:=greatest(coalesce(input_tokens,0),0); v_output bigint:=greatest(coalesce(output_tokens,0),0);
  v_thoughts bigint:=greatest(coalesce(thoughts_tokens,0),0); v_total bigint;
  v_shared integer:=case when model_name like 'shared-api-key|%' or model_name like 'shared-openai-api-key|%' then 1 else 0 end;
  v_gemini integer:=case when model_name like '%|gemini-%' then 1 else 0 end;
begin
  if me is null then raise exception 'Authentication required'; end if;
  if v_input>10000000 or v_output>10000000 or v_thoughts>10000000 or coalesce(total_tokens,0)>30000000 then raise exception 'Invalid token usage'; end if;
  v_total:=greatest(coalesce(total_tokens,0),v_input+v_output+v_thoughts);
  perform pg_advisory_xact_lock(hashtext('ruang-belajar-ai-pool:'||day::text));
  insert into private.ai_model_daily_usage as u(user_id,usage_date,model,requests,input_tokens,output_tokens,thoughts_tokens,total_tokens)
  values(me,day,v_model,1,v_input,v_output,v_thoughts,v_total)
  on conflict(user_id,usage_date,model) do update set
    requests=u.requests+1,input_tokens=u.input_tokens+excluded.input_tokens,
    output_tokens=u.output_tokens+excluded.output_tokens,thoughts_tokens=u.thoughts_tokens+excluded.thoughts_tokens,
    total_tokens=u.total_tokens+excluded.total_tokens,updated_at=now();
  insert into private.ai_daily_usage as u(user_id,usage_date,input_tokens,output_tokens,thoughts_tokens,total_tokens,gemini_request_count,shared_request_count)
  values(me,day,v_input,v_output,v_thoughts,v_total,v_gemini,v_shared)
  on conflict(user_id,usage_date) do update set input_tokens=u.input_tokens+excluded.input_tokens,
    output_tokens=u.output_tokens+excluded.output_tokens,thoughts_tokens=u.thoughts_tokens+excluded.thoughts_tokens,
    total_tokens=u.total_tokens+excluded.total_tokens,gemini_request_count=u.gemini_request_count+excluded.gemini_request_count,
    shared_request_count=u.shared_request_count+excluded.shared_request_count,updated_at=now();
  return jsonb_build_object('recorded',true,'model',v_model,'total_tokens',v_total);
end $$;

create function public.get_ai_model_usage_today()
returns table(model text,requests integer,input_tokens bigint,output_tokens bigint,thoughts_tokens bigint,total_tokens bigint)
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return query select u.model,u.requests,u.input_tokens,u.output_tokens,u.thoughts_tokens,u.total_tokens
    from private.ai_model_daily_usage u where u.user_id=auth.uid()
      and u.usage_date=(now() at time zone 'Asia/Jakarta')::date order by u.total_tokens desc;
end $$;

create function public.get_scope_knowledge(scope_node_id uuid default null,result_limit integer default 40)
returns table(id uuid,node_id uuid,title text,category text,content text,source_type text,score integer,source_file_id uuid,source_page_start integer,source_page_end integer)
language sql stable security invoker set search_path='' as $$
with recursive scope_tree(id) as (
  select n.id from public.study_nodes n where n.user_id=auth.uid() and n.id=scope_node_id
  union select n.id from public.study_nodes n join scope_tree s on n.parent_id=s.id where n.user_id=auth.uid()
)
select k.id,k.node_id,k.title,k.category,k.content,k.source_type,1,k.source_file_id,k.source_page_start,k.source_page_end
from public.knowledge_entries k where k.user_id=auth.uid() and (scope_node_id is null or k.node_id in(select id from scope_tree))
order by k.updated_at desc,k.source_page_start nulls last limit greatest(1,least(coalesce(result_limit,40),120));
$$;

create function public.get_selected_knowledge(result_limit integer default 40,source_node_ids uuid[] default '{}',source_file_ids uuid[] default '{}')
returns table(id uuid,node_id uuid,title text,category text,content text,source_type text,score integer,source_file_id uuid,source_page_start integer,source_page_end integer)
language sql stable security invoker set search_path='' as $$
with recursive selected_tree(id) as (
  select n.id from public.study_nodes n where n.user_id=auth.uid() and n.id=any(coalesce(source_node_ids,'{}'))
  union select n.id from public.study_nodes n join selected_tree s on n.parent_id=s.id where n.user_id=auth.uid()
)
select k.id,k.node_id,k.title,k.category,k.content,k.source_type,1,k.source_file_id,k.source_page_start,k.source_page_end
from public.knowledge_entries k where k.user_id=auth.uid()
  and (k.node_id in(select id from selected_tree) or k.source_file_id=any(coalesce(source_file_ids,'{}')))
order by k.updated_at desc,k.source_page_start nulls last limit greatest(1,least(coalesce(result_limit,40),120));
$$;

create function public.match_knowledge_vectors(p_vector double precision[],p_model text,p_scope_node_id uuid default null,
  p_source_node_ids uuid[] default '{}',p_source_file_ids uuid[] default '{}',p_use_selected boolean default false,
  p_min_similarity double precision default 0.75,p_limit integer default 80)
returns table(id uuid,node_id uuid,title text,category text,content text,source_type text,score integer,source_file_id uuid,source_page_start integer,source_page_end integer)
language sql stable security invoker set search_path='' as $$
with recursive scope_tree(id) as (
  select n.id from public.study_nodes n where n.user_id=auth.uid() and n.id=p_scope_node_id
  union select n.id from public.study_nodes n join scope_tree s on n.parent_id=s.id where n.user_id=auth.uid()
), selected_tree(id) as (
  select n.id from public.study_nodes n where n.user_id=auth.uid() and n.id=any(coalesce(p_source_node_ids,'{}'))
  union select n.id from public.study_nodes n join selected_tree s on n.parent_id=s.id where n.user_id=auth.uid()
), ranked as (
  select k.id,k.node_id,k.title,k.category,c.snippet content,k.source_type,k.source_file_id,
    coalesce(c.source_page_start,k.source_page_start) source_page_start,coalesce(c.source_page_end,k.source_page_end) source_page_end,
    1-(c.embedding operator(public.<=>) p_vector::public.vector(384)) similarity,
    row_number() over(partition by k.id order by c.embedding operator(public.<=>) p_vector::public.vector(384)) chunk_rank
  from public.knowledge_vector_chunks c join public.knowledge_entries k on k.id=c.entry_id and k.user_id=c.user_id
  left join public.source_files f on f.id=k.source_file_id and f.user_id=k.user_id
  where c.user_id=auth.uid() and c.model=p_model and c.entry_updated_at=k.updated_at
    and array_length(p_vector,1)=384 and (k.source_file_id is null or f.processing_status='ready')
    and ((p_use_selected and (k.node_id in(select id from selected_tree) or k.source_file_id=any(coalesce(p_source_file_ids,'{}'))))
      or (not p_use_selected and (p_scope_node_id is null or k.node_id in(select id from scope_tree))))
)
select r.id,r.node_id,r.title,r.category,r.content,r.source_type,round(r.similarity*100000)::integer,
  r.source_file_id,r.source_page_start,r.source_page_end
from ranked r where r.chunk_rank<=6 and r.similarity>=greatest(0,least(coalesce(p_min_similarity,0.75),1))
order by r.similarity desc limit greatest(1,least(coalesce(p_limit,80),120));
$$;
