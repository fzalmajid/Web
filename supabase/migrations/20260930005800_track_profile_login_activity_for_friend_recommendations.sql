alter table public.user_profiles
  add column if not exists last_active_at timestamptz;

update public.user_profiles p
set last_active_at = u.last_sign_in_at
from auth.users u
where p.user_id = u.id
  and u.last_sign_in_at is not null
  and (p.last_active_at is null or p.last_active_at < u.last_sign_in_at);

create index if not exists user_profiles_last_active_idx
  on public.user_profiles (last_active_at desc)
  where last_active_at is not null;
