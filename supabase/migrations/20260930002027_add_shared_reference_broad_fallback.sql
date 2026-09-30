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
