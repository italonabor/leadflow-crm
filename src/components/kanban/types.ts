export type Stage = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  color: string;
  position: number;
  webhook_url: string | null;
  message_template: string | null;
  trigger_webhook: boolean;
};

export type Lead = {
  id: string;
  workspace_id: string;
  user_id: string;
  assigned_to: string | null;
  stage_id: string;
  niche_id: string | null;

  nome: string;
  profissao: string | null;
  telefone: string | null;
  rede_social: string | null;
  link: string | null;
  notes: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};
