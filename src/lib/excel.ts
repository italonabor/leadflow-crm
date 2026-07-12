import * as XLSX from "xlsx";

export type LeadRow = {
  nome: string;
  profissao?: string | null;
  telefone?: string | null;
  rede_social?: string | null;
  link?: string | null;
  notes?: string | null;
  stage?: string | null;
};

const HEADERS = ["Nome", "Profissão", "Telefone", "Rede Social", "Link", "Etapa", "Observações"];

export function exportLeadsToExcel(
  leads: Array<{
    nome: string;
    profissao: string | null;
    telefone: string | null;
    rede_social: string | null;
    link: string | null;
    notes: string | null;
    stage_name: string;
  }>,
) {
  const rows = leads.map((l) => ({
    Nome: l.nome,
    Profissão: l.profissao ?? "",
    Telefone: l.telefone ?? "",
    "Rede Social": l.rede_social ?? "",
    Link: l.link ?? "",
    Etapa: l.stage_name,
    Observações: l.notes ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
  ws["!cols"] = HEADERS.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  XLSX.writeFile(wb, `leads-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function parseLeadsFile(file: File): Promise<LeadRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const pick = (row: Record<string, unknown>, keys: string[]) => {
    for (const k of Object.keys(row)) {
      if (keys.includes(norm(k))) {
        const v = row[k];
        return v == null || v === "" ? null : String(v);
      }
    }
    return null;
  };

  return raw
    .map((row) => ({
      nome: pick(row, ["nome", "name", "lead", "cliente"]) ?? "",
      profissao: pick(row, ["profissao", "profissão", "cargo", "profession"]),
      telefone: pick(row, ["telefone", "phone", "celular", "whatsapp"]),
      rede_social: pick(row, ["rede social", "redesocial", "rede", "social"]),
      link: pick(row, ["link", "url", "website"]),
      notes: pick(row, ["observacoes", "observações", "notas", "notes"]),
      stage: pick(row, ["etapa", "stage", "coluna", "status"]),
    }))
    .filter((r) => r.nome.trim() !== "");
}

export function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    HEADERS,
    ["João Silva", "Advogado", "(11) 99999-9999", "Instagram", "https://instagram.com/joao", "Lead Inicial", "Indicação"],
  ]);
  ws["!cols"] = HEADERS.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  XLSX.writeFile(wb, "modelo-leads.xlsx");
}
