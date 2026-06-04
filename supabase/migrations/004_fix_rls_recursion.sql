-- Migration 004: Fix infinite recursion in study_group_members RLS policies
--
-- Root cause: the SELECT policy on study_group_members references itself,
-- and the INSERT policy from migration 003 creates the same recursion.
-- The study_groups SELECT policy also references study_group_members.
-- Fix: use a SECURITY DEFINER helper function that bypasses RLS for the
-- membership check, breaking the recursive call chain.

-- Helper: checks if auth.uid() is a member of a given group (bypasses RLS)
CREATE OR REPLACE FUNCTION auth_is_group_member(p_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.study_group_members
    WHERE group_id = p_group_id AND user_id = auth.uid()
  );
$$;

-- Fix study_group_members SELECT policy (was self-referential)
DROP POLICY "sgm: members can read" ON public.study_group_members;
CREATE POLICY "sgm: members can read" ON public.study_group_members
FOR SELECT USING (auth_is_group_member(group_id));

-- Fix study_groups SELECT policy (referenced study_group_members → recursion)
DROP POLICY "study_groups: members can read" ON public.study_groups;
CREATE POLICY "study_groups: members can read" ON public.study_groups
FOR SELECT USING (auth_is_group_member(id));

-- Fix INSERT policy added in migration 003 (same recursion via subquery)
DROP POLICY "sgm: members can invite friends" ON public.study_group_members;
CREATE POLICY "sgm: members can invite friends" ON public.study_group_members
FOR INSERT WITH CHECK (
  auth_is_group_member(group_id)
  AND user_id IN (
    SELECT CASE WHEN f.requester_id = auth.uid()
                THEN f.addressee_id ELSE f.requester_id END
    FROM public.friendships f
    WHERE (f.requester_id = auth.uid() OR f.addressee_id = auth.uid())
      AND f.status = 'accepted'
  )
);
