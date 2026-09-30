alter table public.user_profiles
  add column if not exists avatar_emoji text not null default '📚',
  add column if not exists onboarding_completed boolean not null default false;

alter table public.user_profiles
  drop constraint if exists user_profiles_avatar_emoji_length_check;

alter table public.user_profiles
  add constraint user_profiles_avatar_emoji_length_check
  check (char_length(avatar_emoji) between 1 and 16);

update public.user_profiles
set
  avatar_emoji = coalesce(nullif(avatar_emoji,''), '📚'),
  onboarding_completed = false
where onboarding_completed is distinct from false;

grant select, update on table public.user_profiles to authenticated;
