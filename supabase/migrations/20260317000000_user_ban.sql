-- Ban / suspend accounts (API enforces on scans; admins bypass for console access)

alter table public.app_users
  add column if not exists is_banned boolean not null default false;

alter table public.app_users
  add column if not exists banned_at timestamptz;

alter table public.app_users
  add column if not exists ban_reason text;

create index if not exists app_users_is_banned_idx on public.app_users (is_banned)
  where is_banned = true;

notify pgrst, 'reload schema';
