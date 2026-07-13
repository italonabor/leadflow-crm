import type { Lead } from "@/components/kanban/types";

/** Remove tudo que não é dígito; se não tiver DDI, prefixa 55 (Brasil). */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // se começa com 55 e tem 12-13 dígitos, ok. Caso contrário, prefixa 55.
  if (digits.length >= 12 && digits.startsWith("55")) return digits;
  if (digits.length <= 11) return "55" + digits;
  return digits;
}

export function renderTemplate(
  tpl: string | null | undefined,
  lead: Pick<Lead, "nome" | "profissao" | "telefone" | "rede_social" | "link">,
): string {
  if (!tpl) return "";
  return tpl
    .replace(/\{nome\}/gi, lead.nome ?? "")
    .replace(/\{profissao\}/gi, lead.profissao ?? "")
    .replace(/\{telefone\}/gi, lead.telefone ?? "")
    .replace(/\{rede_social\}/gi, lead.rede_social ?? "")
    .replace(/\{link\}/gi, lead.link ?? "");
}

export function buildWhatsAppLink(phone: string, message?: string): string {
  const p = normalizePhone(phone);
  const base = `https://wa.me/${p}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
