-- 1) Chave canônica de telefone (trata o 9º dígito brasileiro)
CREATE OR REPLACE FUNCTION public.wa_phone_key(_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(coalesce(_phone,''), '\D', '', 'g');
  IF d = '' THEN RETURN ''; END IF;
  IF length(d) <= 11 THEN d := '55' || d; END IF;
  -- 55 + DDD(2) + 9 + 8 dígitos => remove o 9 extra para canonizar
  IF length(d) = 13 AND left(d,2) = '55' AND substr(d,5,1) = '9' THEN
    d := '55' || substr(d,3,2) || substr(d,6);
  END IF;
  RETURN d;
END;
$$;

-- 2) Coluna canônica
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS phone_key text;

UPDATE public.whatsapp_conversations
  SET phone_key = public.wa_phone_key(phone)
  WHERE phone_key IS NULL OR phone_key <> public.wa_phone_key(phone);

-- 3) Mesclar conversas duplicadas (mesmo workspace + mesma chave)
WITH ranked AS (
  SELECT id, workspace_id, phone_key,
         first_value(id) OVER (PARTITION BY workspace_id, phone_key ORDER BY created_at ASC) AS keep_id
  FROM public.whatsapp_conversations
), dupes AS (
  SELECT id, keep_id FROM ranked WHERE id <> keep_id
)
UPDATE public.whatsapp_messages m
   SET conversation_id = d.keep_id
  FROM dupes d
 WHERE m.conversation_id = d.id;

WITH ranked AS (
  SELECT id, workspace_id, phone_key,
         first_value(id) OVER (PARTITION BY workspace_id, phone_key ORDER BY created_at ASC) AS keep_id
  FROM public.whatsapp_conversations
), dupes AS (
  SELECT id, keep_id FROM ranked WHERE id <> keep_id
)
DELETE FROM public.whatsapp_conversations c USING dupes d WHERE c.id = d.id;

-- Recalcular agregados das conversas remanescentes
UPDATE public.whatsapp_conversations c
SET last_message_at = agg.last_msg,
    last_inbound_at = agg.last_in,
    last_message_preview = agg.preview
FROM (
  SELECT conversation_id,
         max(created_at) AS last_msg,
         max(created_at) FILTER (WHERE direction = 'inbound') AS last_in,
         (array_agg(body ORDER BY created_at DESC))[1] AS preview
  FROM public.whatsapp_messages
  GROUP BY conversation_id
) agg
WHERE c.id = agg.conversation_id;

-- 4) Unicidade + preenchimento automático
ALTER TABLE public.whatsapp_conversations
  ALTER COLUMN phone_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_ws_phone_key_uidx
  ON public.whatsapp_conversations (workspace_id, phone_key);

CREATE OR REPLACE FUNCTION public.set_wa_phone_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.phone_key := public.wa_phone_key(NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_wa_phone_key ON public.whatsapp_conversations;
CREATE TRIGGER trg_set_wa_phone_key
  BEFORE INSERT OR UPDATE OF phone ON public.whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_wa_phone_key();

-- 5) Upsert seguro de conversa por telefone
CREATE OR REPLACE FUNCTION public.upsert_wa_conversation(_workspace_id uuid, _phone text, _lead_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE k text; cid uuid;
BEGIN
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

GRANT EXECUTE ON FUNCTION public.upsert_wa_conversation(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wa_phone_key(text) TO authenticated, service_role, anon;