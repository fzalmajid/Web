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
