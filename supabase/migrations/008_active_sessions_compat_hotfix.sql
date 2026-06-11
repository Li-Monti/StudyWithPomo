-- Hotfix for active_sessions rows created before or by older clients after 007.
-- It reconstructs effective elapsed time and prevents old clients from creating total_ms=1 rows.

update public.active_sessions
set
  elapsed_ms = least(
    total_ms,
    greatest(0, total_ms - coalesce(paused_remaining_ms, 0))
  ),
  last_started_at = null
where paused_remaining_ms is not null;

update public.active_sessions
set
  elapsed_ms = least(
    total_ms,
    greatest(0, floor(extract(epoch from (now() - started_at)) * 1000)::integer)
  ),
  last_started_at = now()
where paused_remaining_ms is null
  and last_started_at is null;

create or replace function public.normalize_active_session_timer_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_computed_total integer;
begin
  v_computed_total := greatest(
    1,
    floor(extract(epoch from (new.ends_at - new.started_at)) * 1000)::integer
  );

  -- Older clients do not send total_ms; after 007 they receive the default 1.
  if new.total_ms is null or new.total_ms <= 1 then
    new.total_ms := v_computed_total;
  end if;

  if new.elapsed_ms is null then
    new.elapsed_ms := 0;
  end if;

  new.elapsed_ms := greatest(0, least(new.elapsed_ms, new.total_ms));

  if new.paused_remaining_ms is null and new.last_started_at is null then
    new.last_started_at := now();
  end if;

  if new.paused_remaining_ms is not null then
    new.last_started_at := null;
    new.elapsed_ms := greatest(0, least(new.total_ms, new.total_ms - new.paused_remaining_ms));
  end if;

  return new;
end;
$$;

drop trigger if exists normalize_active_session_timer_fields_trigger on public.active_sessions;

create trigger normalize_active_session_timer_fields_trigger
before insert or update on public.active_sessions
for each row
execute function public.normalize_active_session_timer_fields();
