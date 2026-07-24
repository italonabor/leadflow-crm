import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  to: z.string().min(6, "Telefone inválido"),
  message: z.string().min(1, "Mensagem vazia"),
});

/**
 * Envia uma mensagem de texto pelo WhatsApp Business Cloud API (Meta).
 * Requer janela ativa de 24h; caso contrário, template pré-aprovado.
 */
export const sendWhatsAppCloudMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneId) {
      throw new Error(
        "WhatsApp Business não configurado. Adicione WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID nas configurações.",
      );
    }

    const digits = data.to.replace(/\D/g, "");
    const normalized = digits.startsWith("55") || digits.length > 11 ? digits : "55" + digits;

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalized,
        type: "text",
        text: { preview_url: true, body: data.message },
      }),
    });

    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
      messages?: Array<{ id: string }>;
    };

    if (!res.ok) {
      const msg = body?.error?.message ?? `Falha ao enviar (HTTP ${res.status})`;
      throw new Error(msg);
    }

    return { ok: true as const, messageId: body.messages?.[0]?.id ?? null };
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
        error: !hasToken && !hasPhoneId
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
