create or replace function public.sync_profile_login_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.last_sign_in_at is not null then
    update public.user_profiles
    set last_active_at = new.last_sign_in_at,
        updated_at = greatest(coalesce(updated_at, new.last_sign_in_at), new.last_sign_in_at)
    where user_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_profile_login_activity() from public, anon, authenticated;

drop trigger if exists on_auth_user_sign_in_profile_activity on auth.users;
create trigger on_auth_user_sign_in_profile_activity
after update of last_sign_in_at on auth.users
for each row
when (new.last_sign_in_at is distinct from old.last_sign_in_at and new.last_sign_in_at is not null)
execute function public.sync_profile_login_activity();

update public.user_profiles p
set last_active_at = u.last_sign_in_at,
    updated_at = greatest(coalesce(p.updated_at, u.last_sign_in_at), u.last_sign_in_at)
from auth.users u
where p.user_id = u.id
  and u.last_sign_in_at is not null
  and (p.last_active_at is null or p.last_active_at < u.last_sign_in_at);
