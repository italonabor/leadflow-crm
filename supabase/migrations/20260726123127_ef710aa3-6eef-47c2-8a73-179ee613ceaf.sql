ALTER TABLE public.stages
  ADD COLUMN IF NOT EXISTS auto_send_whatsapp boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wa_template_name text,
  ADD COLUMN IF NOT EXISTS wa_template_language text NOT NULL DEFAULT 'pt_BR';