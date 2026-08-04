create extension if not exists "pgcrypto";

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  username text not null default 'USER',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  owner_id text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  path text not null,
  mime_type text not null default 'text/plain',
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  route text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
);

create index if not exists idx_messages_session_created on public.messages(session_id, created_at);
create index if not exists idx_sessions_owner on public.sessions(owner_id);
create index if not exists idx_docs_owner on public.app_documents(owner_id);
create index if not exists idx_rate_limits_owner_route on public.rate_limits(owner_id, route);

alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.app_documents enable row level security;
alter table public.rate_limits enable row level security;

drop policy if exists sessions_select_own on public.sessions;
create policy sessions_select_own on public.sessions
for select using (owner_id = auth.uid()::text);

drop policy if exists sessions_write_own on public.sessions;
create policy sessions_write_own on public.sessions
for all using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
for select using (owner_id = auth.uid()::text);

drop policy if exists messages_write_own on public.messages;
create policy messages_write_own on public.messages
for all using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

drop policy if exists docs_select_own on public.app_documents;
create policy docs_select_own on public.app_documents
for select using (owner_id = auth.uid()::text);

drop policy if exists docs_write_own on public.app_documents;
create policy docs_write_own on public.app_documents
for all using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

drop policy if exists limits_select_own on public.rate_limits;
create policy limits_select_own on public.rate_limits
for select using (owner_id = auth.uid()::text);

drop policy if exists limits_write_own on public.rate_limits;
create policy limits_write_own on public.rate_limits
for all using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
