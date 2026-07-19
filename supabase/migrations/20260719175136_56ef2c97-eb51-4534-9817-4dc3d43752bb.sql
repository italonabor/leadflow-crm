
-- =========================================================
-- 1. ENUM de papéis
-- =========================================================
DO $$ BEGIN
  CREATE TYPE public.workspace_role AS ENUM ('admin', 'atendente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- 2. Tabelas
-- =========================================================
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'atendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.workspace_role NOT NULL DEFAULT 'atendente',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);
CREATE INDEX idx_workspace_invites_email ON public.workspace_invites (lower(email));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_invites TO authenticated;
GRANT ALL ON public.workspace_invites TO service_role;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 3. Funções de segurança (SECURITY DEFINER, sem recursão)
-- =========================================================
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_role(_workspace_id uuid, _user_id uuid, _role public.workspace_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_email(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT email FROM auth.users WHERE id = _user_id;
$$;

-- =========================================================
-- 4. RLS: workspaces
-- =========================================================
CREATE POLICY "members read workspace" ON public.workspaces
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(id, auth.uid()));

CREATE POLICY "owner creates workspace" ON public.workspaces
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "admin updates workspace" ON public.workspaces
  FOR UPDATE TO authenticated
  USING (public.has_workspace_role(id, auth.uid(), 'admin'))
  WITH CHECK (public.has_workspace_role(id, auth.uid(), 'admin'));

CREATE POLICY "owner deletes workspace" ON public.workspaces
  FOR DELETE TO authenticated
  USING (auth.uid() = owner_id);

-- =========================================================
-- 5. RLS: workspace_members
-- =========================================================
CREATE POLICY "read own memberships" ON public.workspace_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "admin adds members" ON public.workspace_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_workspace_role(workspace_id, auth.uid(), 'admin')
    OR user_id = auth.uid()  -- permitir auto-inserção via aceitar convite (server function usará service_role de qualquer forma)
  );

CREATE POLICY "admin updates members" ON public.workspace_members
  FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), 'admin'))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), 'admin'));

CREATE POLICY "admin removes members" ON public.workspace_members
  FOR DELETE TO authenticated
  USING (
    public.has_workspace_role(workspace_id, auth.uid(), 'admin')
    OR user_id = auth.uid()
  );

-- =========================================================
-- 6. RLS: workspace_invites
-- =========================================================
CREATE POLICY "admin reads invites" ON public.workspace_invites
  FOR SELECT TO authenticated
  USING (
    public.has_workspace_role(workspace_id, auth.uid(), 'admin')
    OR lower(email) = lower(public.get_user_email(auth.uid()))
  );

CREATE POLICY "admin creates invites" ON public.workspace_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_workspace_role(workspace_id, auth.uid(), 'admin')
    AND invited_by = auth.uid()
  );

CREATE POLICY "admin updates invites" ON public.workspace_invites
  FOR UPDATE TO authenticated
  USING (
    public.has_workspace_role(workspace_id, auth.uid(), 'admin')
    OR lower(email) = lower(public.get_user_email(auth.uid()))
  );

CREATE POLICY "admin deletes invites" ON public.workspace_invites
  FOR DELETE TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), 'admin'));

-- =========================================================
-- 7. Adicionar workspace_id em stages e leads
-- =========================================================
ALTER TABLE public.stages ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.leads  ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.leads  ADD COLUMN assigned_to  uuid;

-- =========================================================
-- 8. Migrar dados existentes: cria workspace pessoal por usuário
-- =========================================================
DO $$
DECLARE r RECORD; wid uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM public.stages
      UNION SELECT user_id FROM public.leads
      UNION SELECT id AS user_id FROM public.profiles
    ) x WHERE user_id IS NOT NULL
  LOOP
    INSERT INTO public.workspaces (name, owner_id)
    VALUES (COALESCE((SELECT display_name FROM public.profiles WHERE id = r.user_id), 'Meu workspace'), r.user_id)
    RETURNING id INTO wid;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (wid, r.user_id, 'admin');

    UPDATE public.stages SET workspace_id = wid WHERE user_id = r.user_id;
    UPDATE public.leads  SET workspace_id = wid, assigned_to = r.user_id WHERE user_id = r.user_id;
  END LOOP;
END $$;

-- Torna workspace_id obrigatório
ALTER TABLE public.stages ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.leads  ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX idx_stages_workspace ON public.stages(workspace_id);
CREATE INDEX idx_leads_workspace  ON public.leads(workspace_id);
CREATE INDEX idx_leads_assigned   ON public.leads(assigned_to);

-- =========================================================
-- 9. Reescrever RLS de stages e leads
-- =========================================================
DROP POLICY IF EXISTS "own stages all" ON public.stages;
DROP POLICY IF EXISTS "own leads all"  ON public.leads;

-- stages: qualquer membro lê; só admin escreve
CREATE POLICY "members read stages" ON public.stages
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "admin writes stages" ON public.stages
  FOR ALL TO authenticated
  USING (public.has_workspace_role(workspace_id, auth.uid(), 'admin'))
  WITH CHECK (public.has_workspace_role(workspace_id, auth.uid(), 'admin'));

-- leads: qualquer membro lê
CREATE POLICY "members read leads" ON public.leads
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- leads: qualquer membro cria (fica como user_id do criador)
CREATE POLICY "members create leads" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_workspace_member(workspace_id, auth.uid())
    AND user_id = auth.uid()
  );

-- leads: admin edita tudo; atendente edita apenas seus ou atribuídos
CREATE POLICY "members update leads" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.has_workspace_role(workspace_id, auth.uid(), 'admin')
    OR user_id = auth.uid()
    OR assigned_to = auth.uid()
  )
  WITH CHECK (
    public.has_workspace_role(workspace_id, auth.uid(), 'admin')
    OR user_id = auth.uid()
    OR assigned_to = auth.uid()
  );

-- leads: admin apaga tudo; atendente apaga apenas seus
CREATE POLICY "members delete leads" ON public.leads
  FOR DELETE TO authenticated
  USING (
    public.has_workspace_role(workspace_id, auth.uid(), 'admin')
    OR user_id = auth.uid()
  );

-- =========================================================
-- 10. Trigger de signup: cria workspace pessoal + stages padrão
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE wid uuid;
BEGIN
  INSERT INTO public.profiles (id, display_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  INSERT INTO public.workspaces (name, owner_id)
    VALUES (COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)) || ' — Workspace', NEW.id)
    RETURNING id INTO wid;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (wid, NEW.id, 'admin');

  INSERT INTO public.stages (workspace_id, user_id, name, color, position) VALUES
    (wid, NEW.id, 'Lead Inicial',   '#6366f1', 0),
    (wid, NEW.id, 'Contato Feito',  '#8b5cf6', 1),
    (wid, NEW.id, 'Up 1',           '#ec4899', 2),
    (wid, NEW.id, 'Up 2',           '#f59e0b', 3),
    (wid, NEW.id, 'Up 3',           '#10b981', 4),
    (wid, NEW.id, 'Encerramento',   '#0ea5e9', 5);
  RETURN NEW;
END; $$;

-- Trigger de updated_at nas workspaces
DROP TRIGGER IF EXISTS trg_workspaces_updated_at ON public.workspaces;
CREATE TRIGGER trg_workspaces_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
