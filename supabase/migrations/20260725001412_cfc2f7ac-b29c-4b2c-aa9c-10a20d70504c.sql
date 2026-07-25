CREATE TABLE public.workspace_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
    sender_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

GRANT SELECT, INSERT ON public.workspace_messages TO authenticated;
GRANT ALL ON public.workspace_messages TO service_role;

CREATE INDEX idx_workspace_messages_workspace_created
    ON public.workspace_messages (workspace_id, created_at DESC);

ALTER TABLE public.workspace_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view workspace messages"
ON public.workspace_messages
FOR SELECT
TO authenticated
USING (public.is_workspace_member(auth.uid(), workspace_id));

CREATE POLICY "Members can insert workspace messages"
ON public.workspace_messages
FOR INSERT
TO authenticated
WITH CHECK (public.is_workspace_member(auth.uid(), workspace_id));
