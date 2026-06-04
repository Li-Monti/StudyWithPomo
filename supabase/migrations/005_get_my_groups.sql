-- Migration 005: RPC get_my_groups
-- Returns the current user's groups with member counts in one query,
-- eliminating the N+1 / waterfall pattern in SocialPage.

CREATE OR REPLACE FUNCTION get_my_groups()
RETURNS TABLE(
  group_id     uuid,
  group_name   text,
  created_by   uuid,
  created_at   timestamptz,
  joined_at    timestamptz,
  member_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    sg.id          AS group_id,
    sg.name        AS group_name,
    sg.created_by,
    sg.created_at,
    mine.joined_at,
    COUNT(all_m.user_id)::bigint AS member_count
  FROM   public.study_group_members mine
  JOIN   public.study_groups        sg     ON sg.id         = mine.group_id
  LEFT   JOIN public.study_group_members all_m ON all_m.group_id = mine.group_id
  WHERE  mine.user_id = auth.uid()
  GROUP  BY sg.id, sg.name, sg.created_by, sg.created_at, mine.joined_at
  ORDER  BY mine.joined_at DESC;
$$;
