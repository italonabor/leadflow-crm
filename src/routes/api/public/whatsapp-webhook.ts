import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/** Valida o header X-Hub-Signature-256 enviado pela Meta. */
function verifyMetaSignature(raw: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(raw, "utf8").digest("hex");
  const received = header.slice("sha256=".length).trim();
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Webhook do WhatsApp Cloud API (Meta).
 * - GET: verificação inicial (hub.challenge).
 * - POST: recepção de mensagens/status.
 *
 * URL pública estável (para colar no painel do app Meta):
 *   https://project--<project-id>.lovable.app/api/public/whatsapp-webhook
 */
export const Route = createFileRoute("/api/public/whatsapp-webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const expected = process.env.WHATSAPP_VERIFY_TOKEN;

        if (mode === "subscribe" && token && expected && token === expected) {
          return new Response(challenge ?? "", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        return new Response("forbidden", { status: 403 });
      },

      POST: async ({ request }) => {
        const raw = await request.text();

        // Segurança: só aceitamos payloads assinados pela Meta.
        const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
        if (!appSecret) {
          console.error(
            "[whatsapp-webhook] WHATSAPP_APP_SECRET não configurado — payload recusado",
          );
          return new Response("webhook not configured", { status: 503 });
        }
        const signature = request.headers.get("x-hub-signature-256");
        if (!verifyMetaSignature(raw, signature, appSecret)) {
          console.error(
            "[whatsapp-webhook] assinatura inválida",
            JSON.stringify({ hasHeader: Boolean(signature), bytes: raw.length }),
          );
          return new Response("invalid signature", { status: 401 });
        }


        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("bad json", { status: 400 });
        }


        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        try {
          await handleWebhook(payload, supabaseAdmin);
        } catch (e) {
          console.error("[whatsapp-webhook] handler error", e);
          // Retornar 200 mesmo em erro para evitar retries agressivos da Meta;
          // o log fica registrado para debug.
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});

type WebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          image?: { caption?: string };
          audio?: { id?: string };
          document?: { caption?: string; filename?: string };
          button?: { text?: string };
          interactive?: unknown;
        }>;
        statuses?: Array<{
          id?: string;
          status?: string;
          recipient_id?: string;
          timestamp?: string;
        }>;
      };
    }>;
  }>;
};

type Admin = Awaited<
  ReturnType<typeof import("@/integrations/supabase/client.server")["supabaseAdmin"]["from"]>
> extends never
  ? never
  : any; // eslint-disable-line @typescript-eslint/no-explicit-any

function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (d.length >= 12 && d.startsWith("55")) return d;
  if (d.length <= 11) return "55" + d;
  return d;
}

function extractBody(m: unknown): string {
  if (!m) return "";
  const anyM = m as any;

  // Respostas de botão (quick reply) e listas interativas
  const interactive = anyM.interactive ?? {};
  const interactiveText =
    interactive?.button_reply?.title ??
    interactive?.button_reply?.id ??
    interactive?.list_reply?.title ??
    interactive?.list_reply?.description ??
    interactive?.nfm_reply?.body ??
    null;

  return (
    anyM.text?.body ??
    // Botão de template (quick reply) → payload em button.text
    anyM.button?.text ??
    anyM.button?.payload ??
    interactiveText ??
    anyM.image?.caption ??
    anyM.document?.caption ??
    anyM.video?.caption ??
    anyM.reaction?.emoji ??
    ({
      audio: "🎤 Áudio",
      voice: "🎤 Áudio",
      image: "🖼️ Imagem",
      video: "🎬 Vídeo",
      document: "📎 Documento",
      sticker: "Sticker",
      location: "📍 Localização",
      contacts: "👤 Contato",
    } as Record<string, string>)[String(anyM.type)] ??
    (anyM.type ? `[${anyM.type}]` : "")
  );
}


async function handleWebhook(payload: unknown, admin: any) {
  const p = payload as WebhookPayload;
  if (!p?.entry) return;

  for (const entry of p.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      // Descobrir workspace pelo phone_number_id -> encontrar qualquer lead do workspace
      // (multi-tenant simples: 1 número WABA por instância; usamos o primeiro workspace com leads).
      // Estratégia: pega workspace do primeiro lead cujo telefone corresponda, senão o único workspace ativo.
      const messages = value.messages ?? [];
      const statuses = value.statuses ?? [];

      for (const msg of messages) {
        const from = msg.from ? normalizePhone(msg.from) : "";
        if (!from) continue;

        const workspaceId = await resolveWorkspaceFor(admin, from);
        if (!workspaceId) {
          console.warn("[wa] sem workspace para", from);
          continue;
        }

        // find lead by phone (com/sem 9º dígito)
        const { data: leadId } = await admin.rpc("find_lead_by_phone", {
          _workspace_id: workspaceId,
          _phone: from,
        });

        const conversationId = await upsertConversation(
          admin,
          workspaceId,
          from,
          leadId ?? null,
        );

        const body = extractBody(msg);
        await admin.from("whatsapp_messages").insert({
          workspace_id: workspaceId,
          conversation_id: conversationId,
          lead_id: leadId ?? null,
          direction: "inbound",
          wa_message_id: msg.id ?? null,
          from_phone: from,
          to_phone: value.metadata?.display_phone_number ?? null,
          body,
          message_type: msg.type ?? "text",
          status: "received",
          raw: msg as any,
        });

        await admin
          .from("whatsapp_conversations")
          .update({
            last_inbound_at: new Date().toISOString(),
            last_message_at: new Date().toISOString(),
            last_message_preview: body.slice(0, 200),
            unread_count: (await getUnread(admin, conversationId)) + 1,
            lead_id: leadId ?? undefined,
          })
          .eq("id", conversationId);

        // Sobe o lead para o topo do pipeline quando chega mensagem nova
        if (leadId) {
          await admin.from("leads").update({ position: Date.now() }).eq("id", leadId);
        }
      }

      for (const st of statuses) {
        if (!st.id) continue;
        await admin
          .from("whatsapp_messages")
          .update({ status: st.status ?? "unknown" })
          .eq("wa_message_id", st.id);
      }
    }
  }
}

async function getUnread(admin: any, conversationId: string): Promise<number> {
  const { data } = await admin
    .from("whatsapp_conversations")
    .select("unread_count")
    .eq("id", conversationId)
    .maybeSingle();
  return data?.unread_count ?? 0;
}

async function resolveWorkspaceFor(admin: any, phone: string): Promise<string | null> {
  // 1) tenta achar lead com esse telefone em qualquer workspace
  const { data: leads } = await admin
    .from("leads")
    .select("workspace_id, telefone")
    .not("telefone", "is", null)
    .limit(500);
  if (leads?.length) {
    const target = phone;
    for (const l of leads) {
      const d = String(l.telefone).replace(/\D/g, "");
      const norm = d.length >= 12 && d.startsWith("55") ? d : d.length <= 11 ? "55" + d : d;
      // compara com/sem 9º dígito
      if (equalsBRLoose(norm, target)) return l.workspace_id;
    }
  }
  // 2) fallback: workspace mais antigo
  const { data: ws } = await admin
    .from("workspaces")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return ws?.id ?? null;
}

function equalsBRLoose(a: string, b: string): boolean {
  if (a === b) return true;
  const v = (n: string) => {
    const out = [n];
    if (n.startsWith("55") && n.length === 13) out.push("55" + n.slice(2, 4) + n.slice(5));
    if (n.startsWith("55") && n.length === 12) out.push("55" + n.slice(2, 4) + "9" + n.slice(4));
    return out;
  };
  const va = v(a);
  const vb = v(b);
  return va.some((x) => vb.includes(x));
}

async function upsertConversation(
  admin: any,
  workspaceId: string,
  phone: string,
  leadId: string | null,
): Promise<string> {
  const { data, error } = await admin.rpc("upsert_wa_conversation", {
    _workspace_id: workspaceId,
    _phone: phone,
    _lead_id: leadId,
  });
  if (error || !data) throw error ?? new Error("falha ao criar conversa");
  return data as string;
}
