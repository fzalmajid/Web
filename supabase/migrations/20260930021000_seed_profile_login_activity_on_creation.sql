create or replace function public.make_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  local_part text;
  base_name text;
  safe_username text;
  picture_value text;
begin
  local_part := split_part(coalesce(new.email, 'akun'), '@', 1);
  base_name := lower(regexp_replace(local_part, '[^a-z0-9._]+', '', 'g'));
  if char_length(base_name) < 3 then base_name := 'akun'; end if;

  if exists (
    select 1 from public.user_profiles p where lower(p.username) = lower(base_name)
  ) then
    safe_username := left(base_name, 24) || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  else
    safe_username := left(base_name, 32);
  end if;

  picture_value := coalesce(
    nullif(new.raw_user_meta_data->>'avatar_url',''),
    nullif(new.raw_user_meta_data->>'picture','')
  );

  insert into public.user_profiles(
    user_id,
    username,
    display_name,
    avatar_url,
    last_active_at
  )
  values (
    new.id,
    safe_username,
    left(local_part,80),
    picture_value,
    new.last_sign_in_at
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.make_profile_for_new_user() from public, anon, authenticated;
