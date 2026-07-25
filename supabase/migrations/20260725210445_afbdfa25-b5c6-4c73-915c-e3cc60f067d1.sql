REVOKE EXECUTE ON FUNCTION public.wa_phone_key(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.wa_phone_key(text) FROM authenticated;

CREATE OR REPLACE FUNCTION public.upsert_wa_conversation(_workspace_id uuid, _phone text, _lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE k text; cid uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = _workspace_id AND wm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not a member of this workspace';
  END IF;

  k := public.wa_phone_key(_phone);
  SELECT id INTO cid FROM public.whatsapp_conversations
   WHERE workspace_id = _workspace_id AND phone_key = k LIMIT 1;
  IF cid IS NOT NULL THEN
    IF _lead_id IS NOT NULL THEN
      UPDATE public.whatsapp_conversations SET lead_id = coalesce(lead_id, _lead_id) WHERE id = cid;
    END IF;
    RETURN cid;
  END IF;
  INSERT INTO public.whatsapp_conversations (workspace_id, phone, lead_id, last_message_at)
  VALUES (_workspace_id, _phone, _lead_id, now())
  ON CONFLICT (workspace_id, phone_key) DO UPDATE SET phone = excluded.phone
  RETURNING id INTO cid;
  RETURN cid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_wa_conversation(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_wa_conversation(uuid, text, uuid) TO authenticated, service_role;