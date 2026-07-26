CREATE TABLE public.niches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  position bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.niches TO authenticated;
GRANT ALL ON public.niches TO service_role;

ALTER TABLE public.niches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read niches" ON public.niches FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members create niches" ON public.niches FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()) AND user_id = auth.uid());
CREATE POLICY "members update niches" ON public.niches FOR UPDATE
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members delete niches" ON public.niches FOR DELETE
  USING (public.has_workspace_role(workspace_id, auth.uid(), 'admin') OR user_id = auth.uid());

CREATE TRIGGER niches_set_updated_at BEFORE UPDATE ON public.niches
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.leads ADD COLUMN niche_id uuid REFERENCES public.niches(id) ON DELETE SET NULL;
CREATE INDEX idx_leads_niche ON public.leads(niche_id);
CREATE INDEX idx_niches_workspace ON public.niches(workspace_id, position);