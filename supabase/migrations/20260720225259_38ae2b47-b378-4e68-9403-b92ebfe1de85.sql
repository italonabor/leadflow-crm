CREATE OR REPLACE FUNCTION public.list_workspace_members(_workspace_id uuid)
RETURNS TABLE (user_id uuid, role public.workspace_role, email text, display_name text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT wm.user_id, wm.role, u.email::text, p.display_name, wm.created_at
  FROM public.workspace_members wm
  JOIN auth.users u ON u.id = wm.user_id
  LEFT JOIN public.profiles p ON p.id = wm.user_id
  WHERE wm.workspace_id = _workspace_id
    AND public.is_workspace_member(_workspace_id, auth.uid())
  ORDER BY wm.created_at;
$$;

GRANT EXECUTE ON FUNCTION public.list_workspace_members(uuid) TO authenticated;