
# Plano — Prospecta v2 (equipes, WhatsApp, agenda, chat)

Cinco entregas encadeadas. Cada uma é utilizável isoladamente, então se algo travar (ex.: você não configurar Evolution), o resto continua funcionando.

---

## Entrega 1 — Workspace + Atendentes + Convites

**Refatoração de base.** Hoje cada usuário é uma ilha. Passa a existir "workspace" (a empresa/equipe) e usuários com papéis dentro dela.

### Banco
- `workspaces` (id, name, owner_id)
- `workspace_members` (workspace_id, user_id, role: `admin` | `atendente`, invited_at, joined_at)
- `workspace_invites` (workspace_id, email, role, token, expires_at, accepted_at)
- Migração: adicionar `workspace_id` em `stages` e `leads`; adicionar `assigned_to` (uuid, nullable) em `leads` para "atendente responsável"
- Reescrever RLS: membros do workspace veem leads/stages do workspace; só admin edita stages; atendente edita leads que criou ou está como `assigned_to`; admin edita tudo
- Função `has_workspace_role(user_id, workspace_id, role)` security definer para evitar recursão
- Trigger no signup: cria workspace pessoal e default stages (mantém o comportamento atual pra quem entra sozinho)

### Convites por e-mail
- Admin abre modal "Adicionar atendente" → digita e-mail + role
- Cria linha em `workspace_invites` com token único
- Dispara e-mail (Lovable Emails) com link `/invite/{token}`
- Página `/invite/{token}` exibe convite, pede login/signup, ao aceitar cria `workspace_members`
- Se o e-mail já tem conta, entra direto no workspace ao logar
- Prereq: **você precisa configurar um domínio de e-mail** (Lovable Emails). Sem domínio, uso fallback: admin gera link, copia e envia manualmente.

### UI
- Página `/team` (só admin): lista atendentes, convites pendentes, botão remover
- Header: chip do workspace ativo + seletor se pertencer a mais de um
- No card do lead: avatar do atendente responsável; menu "Atribuir a…"
- Filtro no board: "meus leads" / "todos" / por atendente

---

## Entrega 2 — Copiar Telefone (rápido)

- Ícone de "copiar" ao lado do número no `LeadCard` e no `LeadDialog`
- Click → `navigator.clipboard.writeText(telefone)` + toast "Copiado"
- Número vira link clicável (`tel:`) no mobile

---

## Entrega 3 — WhatsApp Business (Evolution API via n8n)

Escolha: **Evolution API rodando no seu n8n** (mais rápido, não-oficial, já temos base de webhook). Se depois quiser migrar pra Meta Cloud API oficial, a camada de UI é a mesma.

### Envio (plataforma → WhatsApp)
- Configuração por workspace: URL base do Evolution, nome da instância, API key (guardo como secret)
- No lead: botão "Enviar mensagem" abre painel de chat lateral com histórico
- Enviar → POST pro Evolution via server function (`createServerFn` autenticado)
- Templates rápidos por etapa (reaproveita `message_template` das stages)

### Recebimento (WhatsApp → plataforma)
- Endpoint público `/api/public/webhooks/whatsapp/{workspace_id}` valida assinatura simples (secret compartilhado)
- Recebe mensagem, encontra lead pelo telefone (normalizado), grava em `messages`
- Se telefone não bate com nenhum lead, cria "lead órfão" pra o admin classificar
- Realtime na UI: mensagens novas aparecem sem refresh

### Banco
- `messages` (id, workspace_id, lead_id, direction: in/out, body, media_url, from_number, to_number, wa_message_id, sent_by_user_id, status)
- Índices em (lead_id, created_at), (workspace_id, created_at)
- RLS: membros do workspace leem/escrevem

### Configuração
- Página `/integrations` ganha aba "WhatsApp": campos + botão "Testar conexão"
- Documento com instruções passo-a-passo pra subir Evolution no n8n

---

## Entrega 4 — Agendamento (Calendly + Google Calendar)

**Ambos**, conforme pedido. Cada atendente escolhe o que usar no perfil dele.

### Calendly (simples)
- Cada atendente cola seu link do Calendly em `profiles.calendly_url`
- No lead, botão "Agendar (Calendly)" abre link em nova aba com nome/e-mail pré-preenchidos via query params
- Sem OAuth, sem custo

### Google Calendar (integrado)
- App User Connector `google_calendar` (cada atendente conecta a própria conta)
- No lead, botão "Agendar (Google)" abre modal: data/hora, duração, convidados (pré-preenche nome + telefone do lead)
- Cria evento via API do Google usando o token do atendente
- Lista próximos eventos ligados ao lead no card
- Guardo `google_event_id` em nova tabela `lead_events` pra sincronizar

---

## Entrega 5 — Chat Interno (Admin ↔ Atendentes)

Mensageria em tempo real dentro do workspace, separada do WhatsApp.

### Banco
- `chat_channels` (id, workspace_id, name, type: `general` | `dm`)
- `chat_channel_members` (channel_id, user_id)
- `chat_messages` (id, channel_id, user_id, body, created_at)
- Trigger cria canal `#geral` ao criar workspace, adiciona todos os membros
- RLS: só membros do canal leem/escrevem
- Realtime habilitado em `chat_messages`

### UI
- Ícone de balão no header com badge de não-lidas
- Drawer lateral: lista de canais + DMs, painel de mensagens
- `#geral` (todos do workspace) + DMs 1-a-1 entre admin e cada atendente
- Digitação indica presença (opcional, se der tempo)

---

## Ordem de execução

1. **Entrega 1** primeiro (base) → 2 migrações grandes (schema + RLS), UI de equipe, convites
2. **Entrega 2** junto com 1 (é trivial)
3. **Entrega 5** depois de 1 (usa workspace_members)
4. **Entrega 3** (WhatsApp) — depende de você configurar Evolution
5. **Entrega 4** (agenda) — Calendly é rápido; Google Calendar precisa você aprovar o connector

## O que preciso de você durante o caminho

- **Domínio de e-mail** para convites (senão uso link manual como fallback)
- **URL + API key do Evolution** quando chegar na Entrega 3
- **Aprovar connector Google Calendar** quando chegar na Entrega 4

## Ponto de atenção — dados existentes

Você já tem stages e leads criados. Na migração da Entrega 1, todos os leads/stages atuais migram para um workspace pessoal com você como admin. Nada se perde.

## Detalhes técnicos (para referência)

- Stack: TanStack Start + Supabase (Lovable Cloud) + RLS
- Server functions com `requireSupabaseAuth` para operações autenticadas
- Server routes em `/api/public/*` para webhooks (Evolution, futuros)
- Realtime do Supabase para chat interno e mensagens WhatsApp
- App User Connector `google_calendar` para OAuth por atendente
- E-mail transacional via `sendLovableEmail` para convites

---

**Aprovando este plano, começo pela Entrega 1 (workspace + convites + copiar telefone).** Posso rodar as entregas em sequência sem parar entre elas, mas as Entregas 3 e 4 vão pausar aguardando suas credenciais/aprovação.
