import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  to: z.string().min(6, "Telefone inválido"),
  message: z.string().min(1, "Mensagem vazia"),
});

/** Mascara token, deixando prefixo/sufixo para identificação sem expor o valor. */
function maskToken(t: string | undefined | null): string {
  if (!t) return "";
  if (t.length <= 12) return "***";
  return `${t.slice(0, 6)}…${t.slice(-4)} (len=${t.length})`;
}

/**
 * Envia uma mensagem de texto pelo WhatsApp Business Cloud API (Meta).
 * Sempre retorna um objeto detalhado com request/response para diagnóstico —
 * nunca lança em erros da Graph API (falhas de rede ainda lançam).
 */
export const sendWhatsAppCloudMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const startedAt = Date.now();
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneId) {
      return {
        ok: false as const,
        stage: "config" as const,
        error:
          "WhatsApp Business não configurado. Adicione WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID nas configurações.",
        request: null,
        response: null,
        durationMs: 0,
      };
    }

    const digits = data.to.replace(/\D/g, "");
    const normalized =
      digits.startsWith("55") || digits.length > 11 ? digits : "55" + digits;

    const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: normalized,
      type: "text" as const,
      text: { preview_url: true, body: data.message },
    };

    const requestLog = {
      url,
      method: "POST",
      headers: {
        Authorization: `Bearer ${maskToken(token)}`,
        "Content-Type": "application/json",
      },
      body: payload,
      normalizedTo: normalized,
      originalTo: data.to,
      phoneNumberId: phoneId,
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return {
        ok: false as const,
        stage: "network" as const,
        error: e instanceof Error ? e.message : String(e),
        request: requestLog,
        response: null,
        durationMs: Date.now() - startedAt,
      };
    }

    const rawText = await res.text();
    let parsed: unknown = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }

    const body = (parsed ?? {}) as {
      error?: {
        message?: string;
        code?: number;
        error_subcode?: number;
        error_data?: { details?: string };
        fbtrace_id?: string;
        type?: string;
      };
      messages?: Array<{ id: string; message_status?: string }>;
      contacts?: Array<{ input: string; wa_id: string }>;
    };

    const responseLog = {
      status: res.status,
      statusText: res.statusText,
      headers: {
        "content-type": res.headers.get("content-type"),
        "x-fb-trace-id": res.headers.get("x-fb-trace-id"),
        "x-fb-rev": res.headers.get("x-fb-rev"),
      },
      body: parsed ?? rawText,
    };

    if (!res.ok) {
      const err = body.error;
      return {
        ok: false as const,
        stage: "graph_api" as const,
        error: err?.message ?? `Falha ao enviar (HTTP ${res.status})`,
        errorCode: err?.code ?? null,
        errorSubcode: err?.error_subcode ?? null,
        errorDetails: err?.error_data?.details ?? null,
        fbtraceId: err?.fbtrace_id ?? null,
        request: requestLog,
        response: responseLog,
        durationMs: Date.now() - startedAt,
      };
    }

    return {
      ok: true as const,
      stage: "sent" as const,
      messageId: body.messages?.[0]?.id ?? null,
      waId: body.contacts?.[0]?.wa_id ?? null,
      request: requestLog,
      response: responseLog,
      durationMs: Date.now() - startedAt,
    };
  });

/**
 * Verifica se WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID estão configurados
 * e testa a validade chamando o endpoint de informações do número na Graph API.
 */
export const checkWhatsAppConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const hasToken = !!token;
    const hasPhoneId = !!phoneId;

    if (!hasToken || !hasPhoneId) {
      return {
        ok: false as const,
        hasToken,
        hasPhoneId,
        error:
          !hasToken && !hasPhoneId
            ? "Faltam WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID."
            : !hasToken
              ? "Falta WHATSAPP_ACCESS_TOKEN."
              : "Falta WHATSAPP_PHONE_NUMBER_ID.",
      };
    }

    const res = await fetch(
      `https://graph.facebook.com/v20.0/${phoneId}?fields=display_phone_number,verified_name,quality_rating,platform_type`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number; type?: string };
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      platform_type?: string;
      id?: string;
    };

    if (!res.ok) {
      return {
        ok: false as const,
        hasToken,
        hasPhoneId,
        error: body?.error?.message ?? `Falha ao consultar Graph API (HTTP ${res.status})`,
      };
    }

    return {
      ok: true as const,
      hasToken,
      hasPhoneId,
      phone: body.display_phone_number ?? null,
      verifiedName: body.verified_name ?? null,
      qualityRating: body.quality_rating ?? null,
      platformType: body.platform_type ?? null,
    };
  });

/**
 * Lista leads do workspace ativo do usuário para escolher destinatário no teste.
 */
export const listLeadsForWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    void userId;

    const { data, error } = await supabase
      .from("leads")
      .select("id, nome, telefone")
      .not("telefone", "is", null)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (error) {
      return { ok: false as const, error: String((error as { message?: string }).message ?? error) };
    }

    return {
      ok: true as const,
      leads: (data as Array<{ id: string; nome: string; telefone: string | null }>) ?? [],
    };
  });
