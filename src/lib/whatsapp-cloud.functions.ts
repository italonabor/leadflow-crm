import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  to: z.string().min(6, "Telefone inválido"),
  message: z.string().min(1, "Mensagem vazia"),
});

/**
 * Envia uma mensagem de texto pelo WhatsApp Business Cloud API (Meta).
 * Requer que o destinatário já tenha uma janela ativa de 24h; caso contrário,
 * é necessário usar template pré-aprovado (não implementado nesta versão).
 *
 * Secrets esperados no ambiente do servidor:
 * - WHATSAPP_ACCESS_TOKEN
 * - WHATSAPP_PHONE_NUMBER_ID
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
