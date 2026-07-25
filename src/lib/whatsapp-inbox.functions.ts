import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (d.length >= 12 && d.startsWith("55")) return d;
  if (d.length <= 11) return "55" + d;
  return d;
}

/** Lista conversas do workspace ativo (mais recentes primeiro). */
export const listConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as { supabase: any };
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select(
        "id, phone, lead_id, last_inbound_at, last_message_at, last_message_preview, unread_count, leads(nome, telefone)",
      )
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) return { ok: false as const, error: String(error.message ?? error) };
    return { ok: true as const, conversations: data ?? [] };
  });

/** Mensagens de uma conversa. */
export const listConversationMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { data: conv } = await supabase
      .from("whatsapp_conversations")
      .select("id, phone, last_inbound_at")
      .eq("id", data.conversationId)
      .maybeSingle();
    const { data: msgs, error } = await supabase
      .from("whatsapp_messages")
      .select(
        "id, direction, body, wa_message_id, message_type, template_name, status, created_at, sent_by",
      )
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) return { ok: false as const, error: String(error.message ?? error) };
    return { ok: true as const, conversation: conv ?? null, messages: msgs ?? [] };
  });

/** Mensagens vinculadas a um lead (para o painel de chat dentro do card do lead). */
export const listLeadConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    // busca a conversa pelo lead_id
    const { data: conv } = await supabase
      .from("whatsapp_conversations")
      .select("id, phone, last_inbound_at")
      .eq("lead_id", data.leadId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (!conv) return { ok: true as const, conversation: null, messages: [] };

    const { data: msgs } = await supabase
      .from("whatsapp_messages")
      .select("id, direction, body, message_type, template_name, status, created_at")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true });

    return { ok: true as const, conversation: conv, messages: msgs ?? [] };
  });

/** Marca conversa como lida. */
export const markConversationRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    await supabase
      .from("whatsapp_conversations")
      .update({ unread_count: 0 })
      .eq("id", data.conversationId);
    return { ok: true as const };
  });

/** Envia mensagem de TEXTO (dentro da janela de 24h) e persiste no histórico. */
export const sendTextInConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: z.string().uuid().optional(),
        leadId: z.string().uuid().optional(),
        to: z.string().min(6),
        body: z.string().min(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) return { ok: false as const, error: "WhatsApp não configurado" };

    const to = normalizePhone(data.to);
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: true, body: data.body },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false as const, error: json?.error?.message ?? `HTTP ${res.status}` };
    }

    // upsert conversa
    let conversationId = data.conversationId;
    let leadId = data.leadId ?? null;
    // Descobre workspace do usuário
    const { data: ws } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const workspaceId = ws?.workspace_id;

    if (!conversationId && workspaceId) {
      if (!leadId) {
        const { data: found } = await supabase.rpc("find_lead_by_phone", {
          _workspace_id: workspaceId,
          _phone: to,
        });
        leadId = found ?? null;
      }
      const { data: cid } = await supabase.rpc("upsert_wa_conversation", {
        _workspace_id: workspaceId,
        _phone: to,
        _lead_id: leadId,
      });
      conversationId = cid ?? undefined;
    }

    if (conversationId && workspaceId) {
      await supabase.from("whatsapp_messages").insert({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        lead_id: leadId,
        direction: "outbound",
        wa_message_id: json?.messages?.[0]?.id ?? null,
        to_phone: to,
        body: data.body,
        message_type: "text",
        status: "sent",
        sent_by: userId,
        raw: json,
      });
      await supabase
        .from("whatsapp_conversations")
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: data.body.slice(0, 200),
        })
        .eq("id", conversationId);
    }

    return { ok: true as const, messageId: json?.messages?.[0]?.id ?? null, conversationId };
  });

/** Envia mensagem TEMPLATE (fora da janela de 24h). */
export const sendTemplateInConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        to: z.string().min(6),
        templateName: z.string().min(1),
        language: z.string().default("pt_BR"),
        bodyParams: z.array(z.string()).default([]),
        conversationId: z.string().uuid().optional(),
        leadId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) return { ok: false as const, error: "WhatsApp não configurado" };

    const to = normalizePhone(data.to);
    const components = data.bodyParams.length
      ? [{ type: "body", parameters: data.bodyParams.map((t) => ({ type: "text", text: t })) }]
      : undefined;

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: data.templateName,
          language: { code: data.language },
          ...(components ? { components } : {}),
        },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false as const, error: json?.error?.message ?? `HTTP ${res.status}` };

    // Persistir como outbound (mesma lógica de upsert)
    const { data: ws } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const workspaceId = ws?.workspace_id;
    let conversationId = data.conversationId;
    let leadId = data.leadId ?? null;

    if (workspaceId) {
      if (!conversationId) {
        if (!leadId) {
          const { data: found } = await supabase.rpc("find_lead_by_phone", {
            _workspace_id: workspaceId,
            _phone: to,
          });
          leadId = found ?? null;
        }
        const { data: cid } = await supabase.rpc("upsert_wa_conversation", {
          _workspace_id: workspaceId,
          _phone: to,
          _lead_id: leadId,
        });
        conversationId = cid ?? undefined;
      }
      if (conversationId) {
        await supabase.from("whatsapp_messages").insert({
          workspace_id: workspaceId,
          conversation_id: conversationId,
          lead_id: leadId,
          direction: "outbound",
          wa_message_id: json?.messages?.[0]?.id ?? null,
          to_phone: to,
          body: `[template: ${data.templateName}] ${data.bodyParams.join(" | ")}`,
          message_type: "template",
          template_name: data.templateName,
          status: "sent",
          sent_by: userId,
          raw: json,
        });
        await supabase
          .from("whatsapp_conversations")
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: `[template] ${data.templateName}`,
          })
          .eq("id", conversationId);
      }
    }

    return { ok: true as const, messageId: json?.messages?.[0]?.id ?? null };
  });

/** Lista templates aprovados da WABA (usa WHATSAPP_BUSINESS_ACCOUNT_ID). */
export const listWhatsAppTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (!token || !wabaId) {
      return {
        ok: false as const,
        error: "Configure WHATSAPP_BUSINESS_ACCOUNT_ID para listar templates.",
      };
    }
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${wabaId}/message_templates?fields=name,status,language,category,components&limit=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false as const, error: json?.error?.message ?? `HTTP ${res.status}` };
    const templates = (json.data ?? []).filter((t: any) => t.status === "APPROVED");
    return { ok: true as const, templates };
  });

/** Envia ÁUDIO (nota de voz) na conversa: faz upload na Graph API e envia. */
export const sendAudioInConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        to: z.string().min(6),
        audioBase64: z.string().min(10),
        mimeType: z.string().default("audio/ogg"),
        conversationId: z.string().uuid().optional(),
        leadId: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) return { ok: false as const, error: "WhatsApp não configurado" };

    const to = normalizePhone(data.to);

    // base64 -> bytes
    const b64 = data.audioBase64.includes(",") ? data.audioBase64.split(",")[1] : data.audioBase64;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    // A Meta só aceita: aac, mp4, mpeg, amr, ogg (opus). webm é rejeitado.
    const raw = data.mimeType.split(";")[0].trim();
    const ALLOWED: Record<string, string> = {
      "audio/mpeg": "mp3",
      "audio/mp3": "mp3",
      "audio/mp4": "mp4",
      "audio/aac": "aac",
      "audio/amr": "amr",
      "audio/ogg": "ogg",
    };
    const mime = raw === "audio/mp3" ? "audio/mpeg" : ALLOWED[raw] ? raw : "audio/mpeg";
    const ext = ALLOWED[raw] ?? "mp3";

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mime);
    form.append("file", new Blob([bytes], { type: mime }), `audio.${ext}`);

    const up = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const upJson: any = await up.json().catch(() => ({}));
    if (!up.ok || !upJson?.id) {
      return {
        ok: false as const,
        error: upJson?.error?.message ?? `Falha no upload do áudio (HTTP ${up.status})`,
      };
    }

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: { id: upJson.id },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false as const, error: json?.error?.message ?? `HTTP ${res.status}` };

    const { data: ws } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const workspaceId = ws?.workspace_id;
    let conversationId = data.conversationId;
    let leadId = data.leadId ?? null;

    if (workspaceId && !conversationId) {
      if (!leadId) {
        const { data: found } = await supabase.rpc("find_lead_by_phone", {
          _workspace_id: workspaceId,
          _phone: to,
        });
        leadId = found ?? null;
      }
      const { data: cid } = await supabase.rpc("upsert_wa_conversation", {
        _workspace_id: workspaceId,
        _phone: to,
        _lead_id: leadId,
      });
      conversationId = cid ?? undefined;
    }

    if (workspaceId && conversationId) {
      await supabase.from("whatsapp_messages").insert({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        lead_id: leadId,
        direction: "outbound",
        wa_message_id: json?.messages?.[0]?.id ?? null,
        to_phone: to,
        body: "[áudio]",
        message_type: "audio",
        status: "sent",
        sent_by: userId,
        raw: json,
      });
      await supabase
        .from("whatsapp_conversations")
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: "[áudio]",
        })
        .eq("id", conversationId);
    }

    return { ok: true as const, messageId: json?.messages?.[0]?.id ?? null, conversationId };
  });

/**
 * Baixa uma mídia recebida (áudio/imagem/vídeo/documento) da Graph API
 * e devolve como data URL para tocar/visualizar direto no navegador.
 */
export const fetchWhatsAppMedia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ messageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!token) return { ok: false as const, error: "WhatsApp não configurado" };

    const { data: msg, error } = await supabase
      .from("whatsapp_messages")
      .select("id, raw, message_type")
      .eq("id", data.messageId)
      .maybeSingle();
    if (error) return { ok: false as const, error: String(error.message ?? error) };
    if (!msg) return { ok: false as const, error: "Mensagem não encontrada" };

    const r = (msg.raw ?? {}) as any;
    const mediaId: string | null =
      r.audio?.id ??
      r.voice?.id ??
      r.image?.id ??
      r.video?.id ??
      r.document?.id ??
      r.sticker?.id ??
      null;
    if (!mediaId) return { ok: false as const, error: "Esta mensagem não possui mídia anexada" };

    const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meta: any = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok || !meta?.url) {
      return {
        ok: false as const,
        error: meta?.error?.message ?? `Falha ao localizar mídia (HTTP ${metaRes.status})`,
      };
    }

    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!fileRes.ok) {
      return { ok: false as const, error: `Falha ao baixar mídia (HTTP ${fileRes.status})` };
    }
    const buf = new Uint8Array(await fileRes.arrayBuffer());
    const mimeType: string = meta.mime_type ?? "application/octet-stream";
    let base64 = "";
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      base64 += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    base64 = btoa(base64);
    return {
      ok: true as const,
      mimeType,
      dataUrl: `data:${mimeType};base64,${base64}`,
      filename: meta?.file_name ?? null,
    };
  });
