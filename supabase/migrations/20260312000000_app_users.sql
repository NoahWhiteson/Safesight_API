-- Safesight app profile + quotas (one row per auth.users id)
create table if not exists public.app_users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  photo_scans_used integer not null default 0 check (photo_scans_used >= 0),
  video_scans_used integer not null default 0 check (video_scans_used >= 0),
  quota_month_key text not null default to_char(now() at time zone 'utc', 'YYYY-MM'),
  name text,
  dwelling_raw text,
  hazard_raws jsonb not null default '[]'::jsonb,
  scan_aggressiveness double precision not null default 0.55,
  onboarding_complete boolean not null default false,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_users_email_idx on public.app_users (lower(email));

alter table public.app_users enable row level security;

create policy "Users read own row"
  on public.app_users for select
  using (auth.uid() = id);

create policy "Users update own row"
  on public.app_users for update
  using (auth.uid() = id);

grant all on table public.app_users to service_role;

notify pgrst, 'reload schema';
