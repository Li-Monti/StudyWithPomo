-- Migration 003: Social features
-- Extends RLS policies for group study and adds leaderboard RPC

-- 1. Allow group members to invite their accepted friends
CREATE POLICY "sgm: members can invite friends"
ON public.study_group_members
FOR INSERT WITH CHECK (
  -- Inviter must already be a member of this group
  group_id IN (
    SELECT sgm.group_id FROM public.study_group_members sgm
    WHERE sgm.user_id = auth.uid()
  )
  -- Invitee must be an accepted friend of the inviter
  AND user_id IN (
    SELECT CASE WHEN f.requester_id = auth.uid()
                THEN f.addressee_id
                ELSE f.requester_id
           END
    FROM public.friendships f
    WHERE (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
      AND f.status = 'accepted'
  )
);

-- 2. Allow group members to read sessions of other members in the same group
--    Required for Realtime cross-user events and the leaderboard query
CREATE POLICY "sessions: group members can read"
ON public.sessions
FOR SELECT USING (
  user_id = auth.uid()
  OR user_id IN (
    SELECT sgm2.user_id
    FROM public.study_group_members sgm1
    JOIN public.study_group_members sgm2 ON sgm1.group_id = sgm2.group_id
    WHERE sgm1.user_id = auth.uid()
      AND sgm2.user_id <> auth.uid()
  )
);

-- 3. RPC for group leaderboard: work hours per member since they joined
CREATE OR REPLACE FUNCTION get_group_leaderboard(p_group_id uuid)
RETURNS TABLE (
  user_id       uuid,
  username      text,
  avatar_url    text,
  joined_at     timestamptz,
  total_seconds bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  -- Verify the caller is a member of the group
  IF NOT EXISTS (
    SELECT 1 FROM public.study_group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  ) THEN
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
    ON  s.user_id     = sgm.user_id
    AND s.started_at >= sgm.joined_at
    AND s.session_type = 'work'
  WHERE sgm.group_id = p_group_id
  GROUP BY sgm.user_id, p.username, p.avatar_url, sgm.joined_at
  ORDER BY total_seconds DESC;
END;
$$;
