-- Centralize group invitation checks in the database.

create or replace function public.invite_friend_to_group(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'cannot invite yourself';
  end if;

  if not public.auth_is_group_member(p_group_id) then
    raise exception 'only group members can invite users';
  end if;

  if not exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = auth.uid() and f.addressee_id = p_user_id)
        or (f.addressee_id = auth.uid() and f.requester_id = p_user_id)
      )
  ) then
    raise exception 'only accepted friends can be invited';
  end if;

  insert into public.study_group_members (group_id, user_id)
  values (p_group_id, p_user_id)
  on conflict (group_id, user_id) do nothing;
end;
$$;
