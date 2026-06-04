-- Migration 006: Fix get_group_leaderboard
-- Problems fixed:
--   1. STABLE → VOLATILE: function calls auth.uid() which is session-dependent,
--      not stable across different callers.
--   2. Use auth_is_group_member() (from migration 004) instead of a raw subquery
--      for the access check, consistent with the rest of the codebase.
--   3. SET search_path = public, auth: security best practice for SECURITY DEFINER
--      functions; ensures auth.uid() is always resolvable.

CREATE OR REPLACE FUNCTION get_group_leaderboard(p_group_id uuid)
RETURNS TABLE (
  user_id       uuid,
  username      text,
  avatar_url    text,
  joined_at     timestamptz,
  total_seconds bigint
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, auth AS $$
BEGIN
  IF NOT auth_is_group_member(p_group_id) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  RETURN QUERY
  SELECT
    sgm.user_id,
    p.username,
    p.avatar_url,
    sgm.joined_at,
    COALESCE(SUM(s.duration_seconds), 0)::bigint AS total_seconds
  FROM public.study_group_members sgm
  JOIN public.profiles p ON p.id = sgm.user_id
  LEFT JOIN public.sessions s
    ON  s.user_id      = sgm.user_id
    AND s.started_at  >= sgm.joined_at
    AND s.session_type = 'work'
  WHERE sgm.group_id = p_group_id
  GROUP BY sgm.user_id, p.username, p.avatar_url, sgm.joined_at
  ORDER BY total_seconds DESC;
END;
$$;
