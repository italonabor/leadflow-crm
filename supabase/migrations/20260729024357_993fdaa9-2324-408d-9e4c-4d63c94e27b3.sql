-- 1) Secure invite acceptance ---------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_workspace_invite(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE inv public.workspace_invites%ROWTYPE; uemail text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = auth.uid();

  SELECT * INTO inv FROM public.workspace_invites
   WHERE token = _token
     AND accepted_at IS NULL
     AND expires_at > now()
   LIMIT 1;

  IF inv.id IS NULL THEN RAISE EXCEPTION 'convite inválido ou expirado'; END IF;
  IF lower(inv.email) <> lower(coalesce(uemail, '')) THEN
    RAISE EXCEPTION 'convite emitido para outro e-mail';
  END IF;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (inv.workspace_id, auth.uid(), inv.role)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  UPDATE public.workspace_invites SET accepted_at = now() WHERE id = inv.id;
  RETURN inv.workspace_id;
END; $$;

REVOKE ALL ON FUNCTION public.accept_workspace_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(text) TO authenticated;

-- unique membership (needed by ON CONFLICT above)
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_ws_user_key
  ON public.workspace_members (workspace_id, user_id);

-- 2) No self-join into workspaces ------------------------------------------
DROP POLICY IF EXISTS "admin adds members" ON public.workspace_members;
CREATE POLICY "admin adds members" ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_workspace_role(workspace_id, auth.uid(), 'admin'::workspace_role)
    OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid())
  );

-- 3) Lock down privileged functions ----------------------------------------
CREATE OR REPLACE FUNCTION public.find_lead_by_phone(_workspace_id uuid, _phone text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE res uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_workspace_member(_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'not a member of this workspace';
  END IF;
  SELECT l.id INTO res
    FROM public.leads l
   WHERE l.workspace_id = _workspace_id
     AND l.telefone IS NOT NULL
     AND public.normalize_phone(l.telefone) = ANY(public.phone_variants(_phone))
   ORDER BY l.updated_at DESC
   LIMIT 1;
  RETURN res;
END; $$;

REVOKE ALL ON FUNCTION public.find_lead_by_phone(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_lead_by_phone(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_wa_conversation(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_wa_conversation(uuid, text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_user_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_email(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_workspace_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_workspace_members(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_workspace_role(uuid, uuid, workspace_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_workspace_role(uuid, uuid, workspace_role) TO authenticated, service_role;

-- 4) Niches policies: authenticated only ------------------------------------
DROP POLICY IF EXISTS "members create niches" ON public.niches;
DROP POLICY IF EXISTS "members delete niches" ON public.niches;
DROP POLICY IF EXISTS "members read niches" ON public.niches;
DROP POLICY IF EXISTS "members update niches" ON public.niches;

CREATE POLICY "members read niches" ON public.niches
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members create niches" ON public.niches
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()) AND user_id = auth.uid());
CREATE POLICY "members update niches" ON public.niches
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members delete niches" ON public.niches
  FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), 'admin'::workspace_role) OR user_id = auth.uid());

-- 5) Profiles policies: authenticated only ----------------------------------
DROP POLICY IF EXISTS "own profile insert" ON public.profiles;
DROP POLICY IF EXISTS "own profile select" ON public.profiles;
DROP POLICY IF EXISTS "own profile update" ON public.profiles;

CREATE POLICY "own profile select" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);