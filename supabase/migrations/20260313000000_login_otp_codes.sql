-- Server-side email OTP (hashed). Run in Supabase SQL editor if not applied via CLI.

create table if not exists public.login_otp_codes (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.login_otp_codes enable row level security;

grant all on table public.login_otp_codes to service_role;

-- No anon/authenticated policies: API uses service role only.
