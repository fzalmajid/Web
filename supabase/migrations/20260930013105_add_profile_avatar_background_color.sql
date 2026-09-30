alter table public.user_profiles
  add column if not exists avatar_bg_color text not null default '#10231d';

alter table public.user_profiles
  drop constraint if exists user_profiles_avatar_bg_color_check;

alter table public.user_profiles
  add constraint user_profiles_avatar_bg_color_check
  check (avatar_bg_color ~ '^#[0-9A-Fa-f]{6}$');

update public.user_profiles
set avatar_bg_color = '#10231d'
where avatar_bg_color is null
   or avatar_bg_color !~ '^#[0-9A-Fa-f]{6}$';
