revoke all on function public.search_shared_reference(uuid,text,integer,uuid,uuid[],uuid[],boolean) from public;
revoke all on function public.search_shared_reference(uuid,text,integer,uuid,uuid[],uuid[],boolean) from anon;
grant execute on function public.search_shared_reference(uuid,text,integer,uuid,uuid[],uuid[],boolean) to authenticated;

revoke all on function public.get_shared_reference(uuid,integer,uuid,uuid[],uuid[],boolean) from public;
revoke all on function public.get_shared_reference(uuid,integer,uuid,uuid[],uuid[],boolean) from anon;
grant execute on function public.get_shared_reference(uuid,integer,uuid,uuid[],uuid[],boolean) to authenticated;
