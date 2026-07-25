DROP POLICY IF EXISTS "Members can view workspace messages" ON public.workspace_messages;
DROP POLICY IF EXISTS "Members can insert workspace messages" ON public.workspace_messages;

CREATE POLICY "Members can view workspace messages"
ON public.workspace_messages
FOR SELECT
TO authenticated
USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can insert workspace messages"
ON public.workspace_messages
FOR INSERT
TO authenticated
WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
