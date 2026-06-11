-- Privacy, closed groups, effective timer tracking, and append-only sessions.

-- Profiles are private by default. User search goes through a narrow RPC.
create or replace function public.search_profiles(p_query text)
returns table (
  id uuid,
  username text,
  avatar_url text
)
language sql
security definer
set search_path = public, auth
as $$
  select p.id, p.username, p.avatar_url
  from public.profiles p
  where length(trim(coalesce(p_query, ''))) >= 2
    and p.id <> auth.uid()
    and p.username ilike trim(p_query) || '%'
  order by p.username
  limit 8;
$$;

drop policy if exists "profiles: read by username" on public.profiles;
drop policy if exists "profiles: owner" on public.profiles;
drop policy if exists "profiles: owner read" on public.profiles;
drop policy if exists "profiles: owner update" on public.profiles;
drop policy if exists "profiles: social graph read" on public.profiles;

create policy "profiles: owner read"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles: owner update"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: social graph read"
  on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.friendships f
      where f.status in ('pending', 'accepted')
        and (
          (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
          or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
        )
    )
    or exists (
      select 1
      from public.study_group_members mine
      join public.study_group_members theirs on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
    )
  );

-- Harden SECURITY DEFINER helpers with explicit search_path.
create or replace function public.auth_is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.study_group_members
    where group_id = p_group_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.get_my_groups()
returns table (
  group_id uuid,
  group_name text,
  created_by uuid,
  created_at timestamptz,
  joined_at timestamptz,
  member_count bigint
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    g.id as group_id,
    g.name as group_name,
    g.created_by,
    g.created_at,
    m.joined_at,
    count(all_members.user_id)::bigint as member_count
  from public.study_group_members m
  join public.study_groups g on g.id = m.group_id
  left join public.study_group_members all_members on all_members.group_id = g.id
  where m.user_id = auth.uid()
  group by g.id, g.name, g.created_by, g.created_at, m.joined_at
  order by m.joined_at desc;
$$;

-- Closed groups: create group and creator membership atomically through RPC.
create or replace function public.create_study_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_group_id uuid := uuid_generate_v4();
  v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if length(v_name) = 0 then
    raise exception 'group name is required';
  end if;

  insert into public.study_groups (id, name, created_by)
  values (v_group_id, v_name, auth.uid());

  insert into public.study_group_members (group_id, user_id)
  values (v_group_id, auth.uid());

  return v_group_id;
end;
$$;

drop policy if exists "sgm: self join" on public.study_group_members;

-- Effective timer tracking. Nullable/backfilled to avoid breaking existing active rows.
alter table public.active_sessions
  add column if not exists total_ms integer,
  add column if not exists elapsed_ms integer not null default 0,
  add column if not exists last_started_at timestamptz;

update public.active_sessions
set total_ms = greatest(1, floor(extract(epoch from (ends_at - started_at)) * 1000)::integer)
where total_ms is null;

alter table public.active_sessions
  alter column total_ms set default 1,
  alter column total_ms set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'active_sessions_total_ms_positive'
  ) then
    alter table public.active_sessions
      add constraint active_sessions_total_ms_positive check (total_ms > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'active_sessions_elapsed_ms_nonnegative'
  ) then
    alter table public.active_sessions
      add constraint active_sessions_elapsed_ms_nonnegative check (elapsed_ms >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'active_sessions_ends_after_started'
  ) then
    alter table public.active_sessions
      add constraint active_sessions_ends_after_started check (ends_at > started_at);
  end if;
end $$;

-- Atomically finish the current work session. Full completion stores total_ms;
-- manual stop stores effective elapsed time and ignores paused time.
create or replace function public.finish_active_work_session(p_save_full boolean)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_active public.active_sessions%rowtype;
  v_now timestamptz := now();
  v_ended_at timestamptz;
  v_duration_ms integer;
  v_duration_seconds integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_active
  from public.active_sessions
  where user_id = auth.uid()
  for update;

  if not found then
    return null;
  end if;

  if v_active.session_type <> 'work' then
    delete from public.active_sessions where id = v_active.id;
    return null;
  end if;

  if p_save_full then
    v_duration_ms := v_active.total_ms;
    v_ended_at := v_active.ends_at;
  else
    v_duration_ms := least(
      v_active.total_ms,
      v_active.elapsed_ms + case
        when v_active.last_started_at is null then 0
        else greatest(0, floor(extract(epoch from (v_now - v_active.last_started_at)) * 1000)::integer)
      end
    );
    v_ended_at := v_now;
  end if;

  v_duration_seconds := floor(greatest(0, v_duration_ms) / 1000)::integer;

  if v_duration_seconds > 0 then
    insert into public.sessions (
      user_id,
      project_id,
      task_id,
      tag_id,
      started_at,
      ended_at,
      duration_seconds,
      session_type
    ) values (
      auth.uid(),
      v_active.project_id,
      v_active.task_id,
      v_active.tag_id,
      v_active.started_at,
      v_ended_at,
      v_duration_seconds,
      v_active.session_type
    );
  end if;

  delete from public.active_sessions where id = v_active.id;
  return v_duration_seconds;
end;
$$;

-- Sessions are append-only for clients.
drop policy if exists "sessions: owner read/insert" on public.sessions;
drop policy if exists "sessions: owner read" on public.sessions;
drop policy if exists "sessions: owner insert" on public.sessions;
drop policy if exists "sessions: group members can read" on public.sessions;

create policy "sessions: owner read"
  on public.sessions for select
  using (user_id = auth.uid());

create policy "sessions: owner insert"
  on public.sessions for insert
  with check (user_id = auth.uid());

create policy "sessions: group members can read"
  on public.sessions for select
  using (
    exists (
      select 1
      from public.study_group_members my_membership
      join public.study_group_members other_membership
        on other_membership.group_id = my_membership.group_id
      where my_membership.user_id = auth.uid()
        and other_membership.user_id = sessions.user_id
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_duration_seconds_positive'
  ) then
    alter table public.sessions
      add constraint sessions_duration_seconds_positive check (duration_seconds > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sessions_ended_after_started'
  ) then
    alter table public.sessions
      add constraint sessions_ended_after_started check (ended_at >= started_at);
  end if;
end $$;
