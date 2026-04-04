create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists app_config_updated_at_idx on public.app_config (updated_at desc);
