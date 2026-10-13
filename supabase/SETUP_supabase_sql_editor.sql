-- Paste this entire file into Supabase → SQL → New query → Run once.
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT).

-- 1) Global admin toggles (maintenance, diagnostics on all devices)
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

-- 2) Profile photo URL on user row
alter table public.app_users
  add column if not exists avatar_url text;

-- 2b) Ban / suspend
alter table public.app_users
  add column if not exists is_banned boolean not null default false;

alter table public.app_users
  add column if not exists banned_at timestamptz;

alter table public.app_users
  add column if not exists ban_reason text;

create index if not exists app_users_is_banned_idx on public.app_users (is_banned)
  where is_banned = true;

-- 3) Storage bucket (name must match API: SafesightUserIcons)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'SafesightUserIcons',
  'SafesightUserIcons',
  true,
  524288,
  array['image/jpeg']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read for profile icons (uploads go through API + service role only)
drop policy if exists "Public read SafesightUserIcons" on storage.objects;
create policy "Public read SafesightUserIcons"
  on storage.objects for select
  using (bucket_id = 'SafesightUserIcons');

-- 4) In-app support chat (API service role only)
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users (id) on delete cascade,
  sender_role text not null check (sender_role in ('user', 'admin')),
  body text not null check (char_length(body) >= 1 and char_length(body) <= 4000),
  created_at timestamptz not null default now(),
  read_by_user_at timestamptz,
  read_by_admin_at timestamptz
);

create index if not exists support_messages_user_created_idx
  on public.support_messages (user_id, created_at desc);

alter table public.support_messages enable row level security;
grant all on table public.support_messages to service_role;

notify pgrst, 'reload schema';
