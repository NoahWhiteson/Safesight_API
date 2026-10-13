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
