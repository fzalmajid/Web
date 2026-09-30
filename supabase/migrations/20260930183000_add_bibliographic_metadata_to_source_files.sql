alter table public.source_files
  add column if not exists bibliographic_metadata jsonb not null default '{}'::jsonb,
  add column if not exists bibliographic_metadata_status text not null default 'unreviewed',
  add column if not exists bibliographic_metadata_updated_at timestamptz;

alter table public.source_files
  drop constraint if exists source_files_bibliographic_metadata_status_check;

alter table public.source_files
  add constraint source_files_bibliographic_metadata_status_check
  check (bibliographic_metadata_status in ('unreviewed','auto','verified','manual','conflict'));

create index if not exists source_files_bibliographic_metadata_status_idx
  on public.source_files(user_id,bibliographic_metadata_status);
