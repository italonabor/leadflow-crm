## Escopo

Como você respondeu **"Abrir conversa (click-to-chat)"**, não precisamos de API de WhatsApp nem contas verificadas. Vamos combinar:

1. **Botão "WhatsApp" em cada card e no diálogo do lead** — abre `https://wa.me/<telefone>?text=<mensagem>` em nova aba.
2. **Automação ao mover entre etapas** via webhook n8n (opcional, você configura depois).

## 1. Botão click-to-chat (imediato, sem n8n)

- Ícone verde do WhatsApp no card do lead (aparece só quando há telefone).
- No `LeadDialog`, botão "Abrir WhatsApp" que usa o telefone + uma mensagem-modelo editável.
- Sanitização do número: remove tudo que não é dígito; se não tiver DDI, assume `55` (Brasil).
- Cada etapa pode ter uma **mensagem-modelo padrão** (ex.: "Contato Feito" → "Olá {nome}, tudo bem?"). Placeholders suportados: `{nome}`, `{profissao}`.

## 2. Automação por etapa (webhook n8n)

Configuração por etapa no `StageDialog`:
- Campo **"Webhook n8n (opcional)"** — URL do webhook.
- Campo **"Mensagem-modelo do WhatsApp"** — texto com placeholders.
- Toggle **"Disparar webhook ao mover lead para esta etapa"**.

Quando o lead é arrastado para uma etapa com webhook ativo, o CRM faz `POST` para a URL configurada com o payload:

```json
{
  "event": "lead.stage_changed",
  "stage": { "id": "...", "name": "Contato Feito" },
  "lead": {
    "nome": "...", "profissao": "...", "telefone": "...",
    "rede_social": "...", "link": "...", "notes": "..."
  },
  "message_template": "Olá {nome}, ..."
}
```

O envio real via WhatsApp acontece **dentro do n8n** (nó HTTP → Evolution API, Z-API, WhatsApp Cloud, etc.). O CRM só notifica.

## 3. Guia de setup do n8n (dentro do app)

Nova página `/integrations` acessível pelo menu do avatar com:
- Passo a passo curto: instalar n8n → criar workflow com trigger "Webhook" → copiar URL → colar na etapa do CRM → adicionar nó de envio de WhatsApp.
- Exemplo do payload JSON acima para o usuário testar.
- Link para docs oficiais do n8n.

## Detalhes técnicos

**Banco** — adicionar colunas em `public.stages`:
- `webhook_url TEXT NULL`
- `message_template TEXT NULL`
- `trigger_webhook BOOLEAN NOT NULL DEFAULT false`

Migration única, sem novas tabelas nem mudanças de RLS (a policy `own stages all` já cobre).

**Frontend**:
- `src/lib/whatsapp.ts` — helpers: `normalizePhone(raw)`, `buildWhatsAppLink(phone, msg)`, `renderTemplate(tpl, lead)`.
- `src/components/kanban/Column.tsx` (LeadCard) — ícone WhatsApp quando `telefone` existe.
- `src/components/kanban/LeadDialog.tsx` — botão "Abrir WhatsApp" + textarea de mensagem (pré-preenchida com o template da etapa).
- `src/components/kanban/StageDialog.tsx` — novos campos (URL, template, toggle).
- `src/routes/_authenticated/board.tsx` — no `moveLead.mutationFn`, se a etapa destino tem `trigger_webhook`, faz `fetch(webhook_url, { method: 'POST', body: payload })` em paralelo ao update. Erros do webhook não bloqueiam o drag; aparecem em `toast`.
- Nova rota `src/routes/_authenticated/integrations.tsx` com o guia.

**Tipos** — atualizar `src/components/kanban/types.ts` após a migration (colunas novas em `Stage`).

## O que fica de fora

- Não vamos armazenar histórico de mensagens enviadas.
- Não vamos receber mensagens de volta (seria o "chat completo", que você não pediu).
- Segurança do webhook (assinatura HMAC) fica por conta do n8n — o CRM só faz POST direto.