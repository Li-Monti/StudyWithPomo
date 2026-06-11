-- Enforce ownership consistency for cross-table references and prevent
-- inconsistent social rows from being created by direct API calls.

create or replace function public.validate_project_tag_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.default_tag_id is not null and not exists (
    select 1
    from public.tags t
    where t.id = new.default_tag_id
      and (t.is_default = true or t.user_id = new.user_id)
  ) then
    raise exception 'project default tag must belong to the project owner or be a default tag';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_project_tag_ownership_trigger on public.projects;

create trigger validate_project_tag_ownership_trigger
before insert or update of user_id, default_tag_id on public.projects
for each row
execute function public.validate_project_tag_ownership();

create or replace function public.validate_task_project_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1
    from public.projects p
    where p.id = new.project_id
      and p.user_id = new.user_id
  ) then
    raise exception 'task project must belong to task owner';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_task_project_ownership_trigger on public.tasks;

create trigger validate_task_project_ownership_trigger
before insert or update of user_id, project_id on public.tasks
for each row
execute function public.validate_task_project_ownership();

create or replace function public.validate_session_references_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.project_id is not null and not exists (
    select 1
    from public.projects p
    where p.id = new.project_id
      and p.user_id = new.user_id
  ) then
    raise exception 'session project must belong to session owner';
  end if;

  if new.task_id is not null then
    if new.project_id is null then
      raise exception 'session task requires a project';
    end if;

    if not exists (
      select 1
      from public.tasks t
      where t.id = new.task_id
        and t.user_id = new.user_id
        and t.project_id = new.project_id
    ) then
      raise exception 'session task must belong to session owner and project';
    end if;
  end if;

  if new.tag_id is not null and not exists (
    select 1
    from public.tags t
    where t.id = new.tag_id
      and (t.is_default = true or t.user_id = new.user_id)
  ) then
    raise exception 'session tag must belong to session owner or be a default tag';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_sessions_references_ownership_trigger on public.sessions;

create trigger validate_sessions_references_ownership_trigger
before insert or update of user_id, project_id, task_id, tag_id on public.sessions
for each row
execute function public.validate_session_references_ownership();

drop trigger if exists validate_active_sessions_references_ownership_trigger on public.active_sessions;

create trigger validate_active_sessions_references_ownership_trigger
before insert or update of user_id, project_id, task_id, tag_id on public.active_sessions
for each row
execute function public.validate_session_references_ownership();

create or replace function public.validate_friendship_pair()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.requester_id = new.addressee_id then
    raise exception 'cannot create friendship with self';
  end if;

  if exists (
    select 1
    from public.friendships f
    where f.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and least(f.requester_id, f.addressee_id) = least(new.requester_id, new.addressee_id)
      and greatest(f.requester_id, f.addressee_id) = greatest(new.requester_id, new.addressee_id)
  ) then
    raise exception 'friendship pair already exists';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_friendship_pair_trigger on public.friendships;

create trigger validate_friendship_pair_trigger
before insert or update of requester_id, addressee_id on public.friendships
for each row
execute function public.validate_friendship_pair();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'timer_configs_positive_values'
  ) then
    alter table public.timer_configs
      add constraint timer_configs_positive_values
      check (
        work_min between 1 and 180
        and short_break_min between 1 and 180
        and long_break_min between 1 and 180
        and pomodoros_per_cycle between 1 and 12
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'projects_goal_hours_positive'
  ) then
    alter table public.projects
      add constraint projects_goal_hours_positive
      check (goal_hours is null or goal_hours > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'projects_valid_type'
  ) then
    alter table public.projects
      add constraint projects_valid_type
      check (type in ('hobby', 'academic')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'active_sessions_valid_type'
  ) then
    alter table public.active_sessions
      add constraint active_sessions_valid_type
      check (session_type in ('work', 'short_break', 'long_break')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'active_sessions_pause_bounds'
  ) then
    alter table public.active_sessions
      add constraint active_sessions_pause_bounds
      check (paused_remaining_ms is null or (paused_remaining_ms >= 0 and paused_remaining_ms <= total_ms)) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'sessions_valid_type'
  ) then
    alter table public.sessions
      add constraint sessions_valid_type
      check (session_type in ('work', 'short_break', 'long_break')) not valid;
  end if;
end $$;
