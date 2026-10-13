create table if not exists public.support_threads (
  user_id uuid primary key references public.app_users (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table public.support_messages
  drop constraint if exists support_messages_sender_role_check;

alter table public.support_messages
  add constraint support_messages_sender_role_check
  check (sender_role in ('user', 'admin', 'system'));

alter table public.support_threads enable row level security;
grant all on table public.support_threads to service_role;

notify pgrst, 'reload schema';
