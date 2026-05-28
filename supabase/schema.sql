create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  business_name text,
  website text,
  created_at timestamptz not null default now()
);

create table if not exists public.anonymous_sessions (
  id uuid primary key default gen_random_uuid(),
  session_key text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  request_type text not null,
  status text not null default 'new',
  summary text,
  source_url text,
  subscription_intent boolean not null default false,
  selected_plan text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.service_requests add column if not exists subscription_intent boolean not null default false;
alter table public.service_requests add column if not exists selected_plan text;
alter table public.service_requests add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.service_requests alter column lead_id drop not null;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  anonymous_session_id uuid references public.anonymous_sessions(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  service_request_id uuid references public.service_requests(id) on delete set null,
  request_type text,
  status text not null default 'captured',
  title text,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.conversations add column if not exists anonymous_session_id uuid references public.anonymous_sessions(id) on delete set null;
alter table public.conversations add column if not exists archived_at timestamptz;
alter table public.conversations add column if not exists deleted_at timestamptz;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  status text not null default 'new',
  footage_url text,
  prompt text not null,
  intake_data jsonb not null default '{}'::jsonb,
  brand_assets jsonb not null default '{}'::jsonb,
  phone text,
  admin_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  score numeric,
  description text,
  duration_seconds integer,
  thumbnail_url text,
  download_url text,
  preview_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.downloads (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  user_id uuid references auth.users(id) on delete set null,
  clip_id uuid references public.clips(id) on delete set null,
  watermarked boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.style_kits (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  adjustments jsonb not null default '{}'::jsonb,
  brand_assets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'ai', 'admin')),
  content text not null,
  created_at timestamptz not null default now(),
  check (conversation_id is not null or project_id is not null)
);

alter table public.messages add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
alter table public.messages add column if not exists detected_intent text;
alter table public.messages alter column project_id drop not null;
alter table public.messages drop constraint if exists messages_role_check;
alter table public.messages add constraint messages_role_check check (role in ('user', 'assistant', 'system', 'ai', 'admin'));

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_email_idx on public.leads (lower(email));
create index if not exists service_requests_lead_id_idx on public.service_requests (lead_id);
create index if not exists service_requests_created_at_idx on public.service_requests (created_at desc);
create index if not exists anonymous_sessions_session_key_idx on public.anonymous_sessions (session_key);
create index if not exists conversations_lead_id_idx on public.conversations (lead_id);
create index if not exists conversations_anonymous_session_id_idx on public.conversations (anonymous_session_id);
create index if not exists conversations_service_request_id_idx on public.conversations (service_request_id);
create index if not exists projects_created_at_idx on public.projects (created_at desc);
create index if not exists projects_user_email_idx on public.projects (lower(user_email));
create index if not exists clips_project_id_idx on public.clips (project_id);
create index if not exists messages_project_id_created_at_idx on public.messages (project_id, created_at);
create index if not exists messages_conversation_id_created_at_idx on public.messages (conversation_id, created_at);

alter table public.leads enable row level security;
alter table public.anonymous_sessions enable row level security;
alter table public.service_requests enable row level security;
alter table public.conversations enable row level security;
alter table public.projects enable row level security;
alter table public.clips enable row level security;
alter table public.downloads enable row level security;
alter table public.style_kits enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Anyone can submit leads" on public.leads;
create policy "Anyone can submit leads"
on public.leads for insert
to anon, authenticated
with check (email is not null and name is not null);

drop policy if exists "Anyone can create anonymous sessions" on public.anonymous_sessions;
create policy "Anyone can create anonymous sessions"
on public.anonymous_sessions for insert
to anon, authenticated
with check (session_key is not null);

drop policy if exists "Anyone can update anonymous sessions" on public.anonymous_sessions;
create policy "Anyone can update anonymous sessions"
on public.anonymous_sessions for update
to anon, authenticated
using (true)
with check (session_key is not null);

drop policy if exists "Anyone can submit service requests" on public.service_requests;
create policy "Anyone can submit service requests"
on public.service_requests for insert
to anon, authenticated
with check (request_type is not null);

drop policy if exists "Anyone can submit conversations" on public.conversations;
create policy "Anyone can submit conversations"
on public.conversations for insert
to anon, authenticated
with check (true);

drop policy if exists "Anyone can submit conversation messages" on public.messages;
create policy "Anyone can submit conversation messages"
on public.messages for insert
to anon, authenticated
with check (content is not null and role is not null);

drop policy if exists "Anyone can submit projects" on public.projects;
create policy "Anyone can submit projects"
on public.projects for insert
to anon, authenticated
with check (user_email is not null and prompt is not null);

drop policy if exists "Users can read own projects" on public.projects;
create policy "Users can read own projects"
on public.projects for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can update own projects" on public.projects;
create policy "Users can update own projects"
on public.projects for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own clips" on public.clips;
create policy "Users can read own clips"
on public.clips for select
to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = clips.project_id
      and projects.user_id = auth.uid()
  )
);

drop policy if exists "Anyone can record downloads" on public.downloads;
create policy "Anyone can record downloads"
on public.downloads for insert
to anon, authenticated
with check (user_email is not null);

drop policy if exists "Users can read own downloads" on public.downloads;
create policy "Users can read own downloads"
on public.downloads for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can manage own style kits" on public.style_kits;
create policy "Users can manage own style kits"
on public.style_kits for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own messages" on public.messages;
create policy "Users can read own messages"
on public.messages for select
to authenticated
using (
  exists (
    select 1 from public.projects
    where projects.id = messages.project_id
      and projects.user_id = auth.uid()
  )
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'fallback',
  status text not null default 'queued',
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists notification_events_created_at_idx on public.notification_events (created_at desc);
create index if not exists notification_events_event_type_idx on public.notification_events (event_type);

alter table public.notification_events enable row level security;

drop policy if exists "Anyone can save notification fallbacks" on public.notification_events;
create policy "Anyone can save notification fallbacks"
on public.notification_events for insert
to anon, authenticated
with check (event_type is not null);
