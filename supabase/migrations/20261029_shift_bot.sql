-- Telegram bot support for availability collection.
create table if not exists public.shift_bot_sessions (
  telegram_user_id bigint primary key,
  chat_id bigint not null,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.shift_bot_managers (
  telegram_user_id bigint primary key,
  chat_id bigint not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.shift_bot_sessions enable row level security;
alter table public.shift_bot_managers enable row level security;
-- These tables are accessed only by the Edge Function using the service role.
revoke all on public.shift_bot_sessions from anon, authenticated;
revoke all on public.shift_bot_managers from anon, authenticated;

create index if not exists shift_bot_managers_enabled_idx on public.shift_bot_managers(enabled);
