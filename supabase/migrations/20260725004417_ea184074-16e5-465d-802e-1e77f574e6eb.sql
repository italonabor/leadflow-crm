
-- Normalize a Brazilian/international phone to digits-only with 55 prefix
CREATE OR REPLACE FUNCTION public.normalize_phone(_raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE d text;
BEGIN
  IF _raw IS NULL THEN RETURN NULL; END IF;
  d := regexp_replace(_raw, '\D', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF length(d) >= 12 AND left(d,2) = '55' THEN RETURN d; END IF;
  IF length(d) <= 11 THEN RETURN '55' || d; END IF;
  RETURN d;
END; $$;

-- Given any phone, return possible variants (with/without 9th digit for BR mobile)
CREATE OR REPLACE FUNCTION public.phone_variants(_raw text)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE n text; ddd text; rest text; variants text[] := ARRAY[]::text[];
BEGIN
  n := public.normalize_phone(_raw);
  IF n IS NULL THEN RETURN variants; END IF;
  variants := array_append(variants, n);
  -- Only Brazilian numbers (55 + DDD + subscriber)
  IF left(n,2) = '55' AND length(n) IN (12,13) THEN
    ddd := substr(n,3,2);
    rest := substr(n,5);
    -- 13 digits => has 9th (e.g. 55 62 9XXXXXXXX). Add variant without leading 9.
    IF length(n) = 13 AND left(rest,1) = '9' THEN
      variants := array_append(variants, '55' || ddd || substr(rest,2));
    END IF;
    -- 12 digits => missing 9th (e.g. 55 62 XXXXXXXX). Add variant with 9 prefix if first digit is 6-9 (mobile).
    IF length(n) = 12 AND left(rest,1) IN ('6','7','8','9') THEN
      variants := array_append(variants, '55' || ddd || '9' || rest);
    END IF;
  END IF;
  RETURN variants;
END; $$;

-- Conversations: one per (workspace, normalized phone)
CREATE TABLE public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  phone text NOT NULL,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, phone)
);
CREATE INDEX idx_wa_conv_workspace ON public.whatsapp_conversations(workspace_id, last_message_at DESC);
CREATE INDEX idx_wa_conv_lead ON public.whatsapp_conversations(lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_conversations TO authenticated;
GRANT ALL ON public.whatsapp_conversations TO service_role;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read conversations" ON public.whatsapp_conversations
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members write conversations" ON public.whatsapp_conversations
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

-- Messages
CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  wa_message_id text,
  from_phone text,
  to_phone text,
  body text,
  message_type text DEFAULT 'text',
  template_name text,
  status text DEFAULT 'received',
  raw jsonb,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wa_msg_conv ON public.whatsapp_messages(conversation_id, created_at);
CREATE INDEX idx_wa_msg_workspace ON public.whatsapp_messages(workspace_id, created_at DESC);
CREATE UNIQUE INDEX idx_wa_msg_wa_id ON public.whatsapp_messages(wa_message_id) WHERE wa_message_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read messages" ON public.whatsapp_messages
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members write messages" ON public.whatsapp_messages
  FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

-- updated_at trigger on conversations
CREATE TRIGGER tg_wa_conv_updated_at BEFORE UPDATE ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;

-- Find lead in a workspace by any phone variant
CREATE OR REPLACE FUNCTION public.find_lead_by_phone(_workspace_id uuid, _phone text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id
  FROM public.leads l
  WHERE l.workspace_id = _workspace_id
    AND l.telefone IS NOT NULL
    AND public.normalize_phone(l.telefone) = ANY(public.phone_variants(_phone))
  ORDER BY l.updated_at DESC
  LIMIT 1;
$$;
