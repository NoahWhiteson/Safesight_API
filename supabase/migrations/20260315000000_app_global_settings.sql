create table if not exists public.app_global_settings (
  id integer primary key default 1 check (id = 1),
  maintenance_mode boolean not null default false,
  maintenance_message text not null default 'Safesight is temporarily unavailable for maintenance.',
  profile_diagnostics_enabled boolean not null default false,
  announcements text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.app_global_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.app_global_settings enable row level security;
grant all on table public.app_global_settings to service_role;

notify pgrst, 'reload schema';
