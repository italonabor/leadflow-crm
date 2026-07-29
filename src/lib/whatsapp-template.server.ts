/**
 * Monta os `components` do payload de template da Graph API do WhatsApp.
 *
 * A Cloud API NÃO aceita chaves nomeadas ({{nome}}): os parâmetros são
 * POSICIONAIS. Aqui buscamos a definição aprovada do template na Meta,
 * contamos quantas variáveis o BODY/HEADER exigem e montamos o array
 * `parameters` com exatamente esse tamanho, injetando o nome do lead
 * na primeira posição do corpo quando nada foi informado.
 */

type BuildArgs = {
  templateName: string;
  language: string;
  leadName?: string | null;
  bodyParams?: string[];
  headerParams?: string[];
};

type MetaComponent = { type: string; parameters: { type: "text"; text: string }[] };

// Conta {1}/{nome} e {{1}}/{{nome}} como o mesmo placeholder.

/** Busca a definição aprovada do template (retorna null se não for possível). */
async function fetchTemplateDef(templateName: string, language: string) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!token || !wabaId) return null;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${wabaId}/message_templates?fields=name,status,language,components&limit=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const list: any[] = json?.data ?? [];
    return (
      list.find((t) => t.name === templateName && t.language === language) ??
      list.find((t) => t.name === templateName) ??
      null
    );
  } catch {
    return null;
  }
}

export async function buildTemplateComponents({
  templateName,
  language,
  leadName,
  bodyParams = [],
  headerParams = [],
}: BuildArgs): Promise<MetaComponent[] | undefined> {
  const firstName = String(leadName ?? "").trim().split(/\s+/)[0] ?? "";
  const def = await fetchTemplateDef(templateName, language);

  let bodyCount: number;
  let headerCount: number;

  if (def) {
    const body = def.components?.find((c: any) => c.type === "BODY");
    const header = def.components?.find(
      (c: any) => c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT",
    );
    bodyCount = countVars(body?.text);
    headerCount = countVars(header?.text);
  } else {
    // Sem acesso à definição: confia no que veio da UI.
    bodyCount = bodyParams.length || (firstName ? 1 : 0);
    headerCount = headerParams.length;
  }

  const comps: MetaComponent[] = [];

  if (headerCount > 0) {
    comps.push({
      type: "header",
      parameters: Array.from({ length: headerCount }, (_, i) => ({
        type: "text" as const,
        text: (headerParams[i] ?? "").trim() || (i === 0 ? firstName : "") || " ",
      })),
    });
  }

  if (bodyCount > 0) {
    comps.push({
      type: "body",
      parameters: Array.from({ length: bodyCount }, (_, i) => ({
        type: "text" as const,
        text: (bodyParams[i] ?? "").trim() || (i === 0 ? firstName : "") || " ",
      })),
    });
  }

  return comps.length ? comps : undefined;
}
