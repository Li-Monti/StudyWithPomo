-- ============================================================
-- PomoPal — Initial Schema
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  username    text not null unique,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, username)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  );
  -- Default timer config
  insert into public.timer_configs (user_id)
  values (new.id)
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- TIMER CONFIGS
-- ============================================================
create table public.timer_configs (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  work_min             int not null default 25,
  short_break_min      int not null default 5,
  long_break_min       int not null default 15,
  pomodoros_per_cycle  int not null default 4
);

-- ============================================================
-- PROJECTS
-- ============================================================
create table public.projects (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  type        text not null check (type in ('hobby', 'academic')),
  color       text not null default '#6366f1',
  goal_hours  numeric,
  exam_date   date,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

create index idx_projects_user on public.projects(user_id);

-- ============================================================
-- TASKS
-- ============================================================
create table public.tasks (
  id           uuid primary key default uuid_generate_v4(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);

create index idx_tasks_project on public.tasks(project_id);

-- ============================================================
-- ACTIVE SESSIONS (one per user — persists timer in DB)
-- ============================================================
create table public.active_sessions (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null unique references public.profiles(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  task_id      uuid references public.tasks(id) on delete set null,
  started_at   timestamptz not null,
  ends_at      timestamptz not null,
  session_type text not null check (session_type in ('work', 'short_break', 'long_break'))
);

-- ============================================================
-- SESSIONS (immutable log)
-- ============================================================
create table public.sessions (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  project_id       uuid references public.projects(id) on delete set null,
  task_id          uuid references public.tasks(id) on delete set null,
  started_at       timestamptz not null,
  ended_at         timestamptz not null,
  duration_seconds int not null,
  session_type     text not null check (session_type in ('work', 'short_break', 'long_break'))
);

create index idx_sessions_user_started on public.sessions(user_id, started_at desc);
create index idx_sessions_project on public.sessions(project_id);

-- ============================================================
-- FRIENDSHIPS
-- ============================================================
create table public.friendships (
  id           uuid primary key default uuid_generate_v4(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at   timestamptz not null default now(),
  unique(requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create index idx_friendships_requester on public.friendships(requester_id);
create index idx_friendships_addressee on public.friendships(addressee_id);

-- ============================================================
-- STUDY GROUPS
-- ============================================================
create table public.study_groups (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.study_group_members (
  group_id  uuid not null references public.study_groups(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index idx_sgm_user on public.study_group_members(user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- profiles
alter table public.profiles enable row level security;
create policy "profiles: owner" on public.profiles
  using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles: read by username" on public.profiles
  for select using (true);

-- timer_configs
alter table public.timer_configs enable row level security;
create policy "timer_configs: owner" on public.timer_configs
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- projects
alter table public.projects enable row level security;
create policy "projects: owner" on public.projects
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- tasks
alter table public.tasks enable row level security;
create policy "tasks: owner" on public.tasks
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- active_sessions
alter table public.active_sessions enable row level security;
create policy "active_sessions: owner" on public.active_sessions
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- sessions
alter table public.sessions enable row level security;
create policy "sessions: owner read/insert" on public.sessions
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- friendships
alter table public.friendships enable row level security;
create policy "friendships: read own" on public.friendships
  for select using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy "friendships: insert as requester" on public.friendships
  for insert with check (requester_id = auth.uid());
create policy "friendships: update as addressee" on public.friendships
  for update using (addressee_id = auth.uid());
create policy "friendships: delete own" on public.friendships
  for delete using (requester_id = auth.uid() or addressee_id = auth.uid());

-- study_groups
alter table public.study_groups enable row level security;
create policy "study_groups: members can read" on public.study_groups
  for select using (
    id in (select group_id from public.study_group_members where user_id = auth.uid())
  );
create policy "study_groups: anyone can create" on public.study_groups
  for insert with check (created_by = auth.uid());

-- study_group_members
alter table public.study_group_members enable row level security;
create policy "sgm: members can read" on public.study_group_members
  for select using (
    group_id in (select group_id from public.study_group_members where user_id = auth.uid())
  );
create policy "sgm: self join" on public.study_group_members
  for insert with check (user_id = auth.uid());
create policy "sgm: self leave" on public.study_group_members
  for delete using (user_id = auth.uid());

-- Enable Realtime for leaderboard
alter publication supabase_realtime add table public.sessions;
