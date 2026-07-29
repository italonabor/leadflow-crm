/**
 * Contagem de variáveis de template do WhatsApp.
 *
 * A Meta aprova templates com placeholders em chaves duplas ({{1}}, {{nome}}),
 * mas na prática os textos copiados/colados costumam vir com chave simples
 * ({1}, {nome}). Para evitar o erro (#132000) "number of parameters does not
 * match", tratamos {x} e {{x}} como o MESMO placeholder.
 */

/** Normaliza chaves duplas em simples: "{{nome}}" -> "{nome}". */
export function normalizeBraces(text: string): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, "{$1}");
}

/** Lista os placeholders na ordem em que aparecem (sem chaves, sem duplicados). */
export function extractVars(text?: string | null): string[] {
  if (!text) return [];
  const found = normalizeBraces(String(text)).match(/\{\s*[^{}\s][^{}]*\s*\}/g) ?? [];
  const names = found.map((m) => m.slice(1, -1).trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * Quantos parâmetros posicionais o template exige.
 * Numéricos ({1},{2}) usam o maior índice; nomeados contam os distintos.
 */
export function countVars(text?: string | null): number {
  const names = extractVars(text);
  if (!names.length) return 0;
  const nums = names.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === names.length) return Math.max(...nums);
  return names.length;
}
