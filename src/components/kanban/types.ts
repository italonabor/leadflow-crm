export type Stage = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  position: number;
};

export type Lead = {
  id: string;
  user_id: string;
  stage_id: string;
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
