alter table public.app_users
  add column if not exists avatar_url text;

notify pgrst, 'reload schema';
