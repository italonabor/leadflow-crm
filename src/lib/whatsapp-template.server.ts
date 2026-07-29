/**
 * Monta os `components` do payload de template da Graph API do WhatsApp.
 *
 * A Cloud API aceita DOIS formatos de parâmetro:
 *  - POSICIONAL  -> template usa {{1}}, {{2}}  => { type: "text", text: "..." }
 *  - NOMEADO     -> template usa {{nome}}      => { type: "text", parameter_name: "nome", text: "..." }
 *
 * Enviar posicional em um template aprovado com variável nomeada gera
 * "(100) Invalid parameter". Por isso buscamos a definição aprovada na Meta,
 * detectamos os nomes das variáveis e montamos o formato correto.
 */

import { countVars, extractVars } from "./template-vars";

type BuildArgs = {
  templateName: string;
  language: string;
  leadName?: string | null;
  bodyParams?: string[];
  headerParams?: string[];
};

type MetaParam = { type: "text"; text: string; parameter_name?: string };
type MetaComponent = { type: string; parameters: MetaParam[] };

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

/** true quando todas as variáveis são numéricas ({{1}}, {{2}}). */
function isPositional(names: string[]): boolean {
  return names.length > 0 && names.every((n) => /^\d+$/.test(n));
}

function buildParams(names: string[], count: number, values: string[], firstName: string): MetaParam[] {
  const named = names.length === count && !isPositional(names);
  return Array.from({ length: count }, (_, i) => {
    const text = (values[i] ?? "").trim() || (i === 0 ? firstName : "") || " ";
    return named
      ? { type: "text" as const, parameter_name: names[i], text }
      : { type: "text" as const, text };
  });
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
  let bodyNames: string[] = [];
  let headerNames: string[] = [];

  if (def) {
    const body = def.components?.find((c: any) => c.type === "BODY");
    const header = def.components?.find(
      (c: any) => c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT",
    );
    bodyCount = countVars(body?.text);
    headerCount = countVars(header?.text);
    bodyNames = extractVars(body?.text);
    headerNames = extractVars(header?.text);
  } else {
    // Sem acesso à definição: confia no que veio da UI (posicional).
    bodyCount = bodyParams.length || (firstName ? 1 : 0);
    headerCount = headerParams.length;
  }

  const comps: MetaComponent[] = [];

  if (headerCount > 0) {
    comps.push({
      type: "header",
      parameters: buildParams(headerNames, headerCount, headerParams, firstName),
    });
  }

  if (bodyCount > 0) {
    comps.push({
      type: "body",
      parameters: buildParams(bodyNames, bodyCount, bodyParams, firstName),
    });
  }

  return comps.length ? comps : undefined;
}
