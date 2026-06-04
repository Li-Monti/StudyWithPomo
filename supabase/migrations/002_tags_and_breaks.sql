-- ============================================================
-- PomoPal — Tags + Break Pause Support
-- ============================================================

-- Tags (predefined + user-created)
create table public.tags (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references public.profiles(id) on delete cascade,
  name       text not null,
  color      text not null default '#6366f1',
  is_default bool not null default false,
  created_at timestamptz not null default now()
);

-- System default tags (user_id is null)
insert into public.tags (name, color, is_default) values
  ('Estudio', '#3b82f6', true),
  ('Deporte', '#22c55e', true),
  ('Ocio',    '#f59e0b', true),
  ('Trabajo', '#8b5cf6', true);

-- Add tag_id to sessions log
alter table public.sessions        add column tag_id uuid references public.tags(id) on delete set null;

-- Add tag_id + pause support to active_sessions
alter table public.active_sessions add column tag_id              uuid references public.tags(id) on delete set null;
alter table public.active_sessions add column paused_remaining_ms int;

-- Add default_tag_id to projects
alter table public.projects        add column default_tag_id uuid references public.tags(id) on delete set null;

-- Index for tag-based stats filtering
create index idx_sessions_tag on public.sessions(tag_id);

-- RLS for tags
alter table public.tags enable row level security;

create policy "tags: read default or own" on public.tags
  for select using (is_default = true or user_id = auth.uid());

create policy "tags: insert own" on public.tags
  for insert with check (user_id = auth.uid() and is_default = false);

create policy "tags: update own" on public.tags
  for update using (user_id = auth.uid() and is_default = false);

create policy "tags: delete own" on public.tags
  for delete using (user_id = auth.uid() and is_default = false);
