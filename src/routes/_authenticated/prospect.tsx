import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Send,
  Loader2,
  Rocket,
  Copy,
  CheckCircle2,
  XCircle,
  Users,
  MessageSquare,
  FileText,
  Search,
} from "lucide-react";
import { listLeadsForWhatsApp } from "@/lib/whatsapp-cloud.functions";
import {
  sendTextInConversation,
  sendTemplateInConversation,
  listWhatsAppTemplates,
} from "@/lib/whatsapp-inbox.functions";

export const Route = createFileRoute("/_authenticated/prospect")({
  component: ProspectPage,
});

type Recipient = { id: string; nome: string; telefone: string };
type SendStatus = "pending" | "sending" | "sent" | "failed";
type SendRow = Recipient & { status: SendStatus; error?: string; messageId?: string };

function renderTemplate(tpl: string, lead: { nome: string; telefone: string }): string {
  // {{x}} e {x} são tratados igualmente.
  return normalizeBraces(tpl)
    .replace(/\{nome\}/gi, (lead.nome || "").trim())
    .replace(/\{primeiro_nome\}/gi, (lead.nome || "").trim().split(/\s+/)[0] ?? "")
    .replace(/\{telefone\}/gi, lead.telefone || "");
}

function ProspectPage() {
  const { user } = Route.useRouteContext();
  const listLeads = useServerFn(listLeadsForWhatsApp);
  const listTemplates = useServerFn(listWhatsAppTemplates);
  const sendText = useServerFn(sendTextInConversation);
  const sendTemplate = useServerFn(sendTemplateInConversation);

  const [mode, setMode] = useState<"text" | "template">("text");
  const [messageBody, setMessageBody] = useState(
    "Olá {primeiro_nome}, tudo bem? Aqui é da equipe Prospecta. Você tem 2 minutinhos?",
  );
  const [templateName, setTemplateName] = useState("");
  const [templateLang, setTemplateLang] = useState("pt_BR");
  const [templateParams, setTemplateParams] = useState("{primeiro_nome}");
  const [manualNumbers, setManualNumbers] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [delayMs, setDelayMs] = useState(1500);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<SendRow[]>([]);

  const leadsQuery = useQuery({
    queryKey: ["prospect-leads"],
    queryFn: async () => (await listLeads()) as Awaited<ReturnType<typeof listLeadsForWhatsApp>>,
    staleTime: 30_000,
  });

  const templatesQuery = useQuery({
    queryKey: ["prospect-templates"],
    queryFn: async () => (await listTemplates()) as Awaited<ReturnType<typeof listWhatsAppTemplates>>,
    enabled: mode === "template",
    staleTime: 60_000,
  });

  const allLeads = useMemo(() => {
    if (!leadsQuery.data || !("ok" in leadsQuery.data) || !leadsQuery.data.ok) return [] as Recipient[];
    return leadsQuery.data.leads
      .filter((l) => (l.telefone ?? "").replace(/\D/g, "").length >= 8)
      .map((l) => ({ id: l.id, nome: l.nome, telefone: l.telefone ?? "" }));
  }, [leadsQuery.data]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allLeads;
    return allLeads.filter(
      (l) => l.nome.toLowerCase().includes(q) || (l.telefone ?? "").toLowerCase().includes(q),
    );
  }, [allLeads, search]);

  const manualRecipients = useMemo<Recipient[]>(() => {
    const lines = manualNumbers.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    return lines.map((raw, i) => ({
      id: `manual-${i}-${raw}`,
      nome: raw,
      telefone: raw,
    }));
  }, [manualNumbers]);

  const recipients: Recipient[] = useMemo(() => {
    const selected = allLeads.filter((l) => selectedIds.has(l.id));
    // dedup por telefone normalizado
    const seen = new Set<string>();
    const out: Recipient[] = [];
    for (const r of [...selected, ...manualRecipients]) {
      const key = r.telefone.replace(/\D/g, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [allLeads, selectedIds, manualRecipients]);

  const canSend =
    recipients.length > 0 &&
    (mode === "text" ? messageBody.trim().length > 0 : templateName.trim().length > 0);

  function toggleAll(checked: boolean) {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredLeads.map((l) => l.id)));
  }
  function toggleOne(id: string, checked: boolean) {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleDispatch() {
    if (!canSend || running) return;
    setRunning(true);
    const initial: SendRow[] = recipients.map((r) => ({ ...r, status: "pending" }));
    setRows(initial);

    const paramsList = templateParams
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    for (let i = 0; i < initial.length; i++) {
      const r = initial[i];
      setRows((prev) => prev.map((x, idx) => (idx === i ? { ...x, status: "sending" } : x)));
      try {
        let result: { ok: boolean; error?: string; messageId?: string | null };
        if (mode === "text") {
          const body = renderTemplate(messageBody, r);
          result = (await sendText({ data: { to: r.telefone, body } })) as any;
        } else {
          const bodyParams = paramsList.map((p) => renderTemplate(p, r));
          result = (await sendTemplate({
            data: {
              to: r.telefone,
              templateName: templateName.trim(),
              language: templateLang.trim() || "pt_BR",
              bodyParams,
              leadName: (r as any).nome ?? undefined,
              leadId: (r as any).id && String((r as any).id).length === 36 ? (r as any).id : undefined,
            },
          })) as any;

        }
        setRows((prev) =>
          prev.map((x, idx) =>
            idx === i
              ? {
                  ...x,
                  status: result.ok ? "sent" : "failed",
                  error: result.ok ? undefined : result.error,
                  messageId: result.messageId ?? undefined,
                }
              : x,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setRows((prev) =>
          prev.map((x, idx) => (idx === i ? { ...x, status: "failed", error: msg } : x)),
        );
      }
      if (i < initial.length - 1 && delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    setRunning(false);
    toast.success("Disparo finalizado");
  }

  const sentCount = rows.filter((r) => r.status === "sent").length;
  const failCount = rows.filter((r) => r.status === "failed").length;

  const templates =
    templatesQuery.data && "ok" in templatesQuery.data && templatesQuery.data.ok
      ? (templatesQuery.data.templates as Array<{ name: string; language: string; category: string }>)
      : [];

  return (
    <AppShell user={user} title="Prospecção · Disparos WhatsApp">
      <PageContainer>
        <div className="grid gap-6">
          {/* Composição da mensagem */}
          <section className="rounded-xl border border-border/60 bg-card p-5 shadow-card">
            <div className="mb-4 flex items-center gap-2">
              <div className="grad-brand grid h-9 w-9 place-items-center rounded-lg">
                <Rocket className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">Mensagem</h2>
                <p className="text-xs text-muted-foreground">
                  Use <code>{"{nome}"}</code>, <code>{"{primeiro_nome}"}</code> e{" "}
                  <code>{"{telefone}"}</code> para personalizar.
                </p>
              </div>
            </div>

            <div className="mb-3 flex gap-2">
              <Button
                size="sm"
                variant={mode === "text" ? "default" : "outline"}
                onClick={() => setMode("text")}
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Texto (janela 24h)
              </Button>
              <Button
                size="sm"
                variant={mode === "template" ? "default" : "outline"}
                onClick={() => setMode("template")}
              >
                <FileText className="mr-2 h-4 w-4" />
                Template aprovado
              </Button>
            </div>

            {mode === "text" ? (
              <div className="grid gap-1.5">
                <Label>Corpo da mensagem</Label>
                <Textarea
                  rows={5}
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  placeholder="Olá {primeiro_nome}, tudo bem?"
                />
                <p className="text-xs text-muted-foreground">
                  Só entrega para leads que interagiram nas últimas 24h. Fora dessa janela use Template.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Template</Label>
                  <Select value={templateName} onValueChange={(v) => {
                    setTemplateName(v);
                    const t = templates.find((x) => x.name === v);
                    if (t?.language) setTemplateLang(t.language);
                  }}>
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          templatesQuery.isLoading
                            ? "Carregando templates…"
                            : templates.length === 0
                              ? "Digite o nome manualmente abaixo"
                              : "Selecione um template"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={`${t.name}-${t.language}`} value={t.name}>
                          {t.name} · {t.language} · {t.category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="mt-1"
                    placeholder="ou digite o nome do template"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Idioma</Label>
                  <Input value={templateLang} onChange={(e) => setTemplateLang(e.target.value)} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>Parâmetros do corpo (separados por vírgula)</Label>
                  <Input
                    value={templateParams}
                    onChange={(e) => setTemplateParams(e.target.value)}
                    placeholder="{primeiro_nome}, Prospecta"
                  />
                  <p className="text-xs text-muted-foreground">
                    Cada valor preenche <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>… na ordem.
                    Variáveis <code>{"{primeiro_nome}"}</code> etc. são substituídas por lead.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* Destinatários */}
          <section className="rounded-xl border border-border/60 bg-card p-5 shadow-card">
            <div className="mb-4 flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">Destinatários</h2>
                <p className="text-xs text-muted-foreground">
                  Selecione leads do funil e/ou adicione números avulsos. Duplicados são removidos.
                </p>
              </div>
              <div className="ml-auto rounded-md border border-border/60 bg-surface/50 px-2 py-1 text-xs">
                <b>{recipients.length}</b> destinatário(s)
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-surface/40">
                <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
                    placeholder="Buscar por nome ou telefone…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <label className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={filteredLeads.length > 0 && filteredLeads.every((l) => selectedIds.has(l.id))}
                      onCheckedChange={(v) => toggleAll(Boolean(v))}
                    />
                    Todos
                  </label>
                </div>
                <div className="max-h-80 overflow-auto">
                  {leadsQuery.isLoading && (
                    <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>
                  )}
                  {!leadsQuery.isLoading && filteredLeads.length === 0 && (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      Nenhum lead com telefone.
                    </div>
                  )}
                  <ul className="divide-y divide-border/60">
                    {filteredLeads.map((l) => {
                      const checked = selectedIds.has(l.id);
                      return (
                        <li key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => toggleOne(l.id, Boolean(v))}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium">{l.nome}</div>
                            <div className="truncate text-xs text-muted-foreground">{l.telefone}</div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Copiar número"
                            onClick={() => {
                              void navigator.clipboard.writeText(l.telefone);
                              toast.success("Número copiado");
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label>Números avulsos</Label>
                <Textarea
                  rows={10}
                  placeholder={"Um por linha, ex.:\n5562948471800\n5511999998888"}
                  value={manualNumbers}
                  onChange={(e) => setManualNumbers(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Aceita vírgula, ponto e vírgula ou quebra de linha. DDI 55 é aplicado automaticamente.
                </p>
              </div>
            </div>
          </section>

          {/* Ação */}
          <section className="rounded-xl border border-border/60 bg-card p-5 shadow-card">
            <div className="flex flex-wrap items-end gap-4">
              <div className="grid gap-1.5">
                <Label>Intervalo entre envios (ms)</Label>
                <Input
                  type="number"
                  min={0}
                  step={250}
                  className="w-40"
                  value={delayMs}
                  onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
              <Button
                className="grad-brand text-primary-foreground"
                disabled={!canSend || running}
                onClick={handleDispatch}
              >
                {running ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Disparar para {recipients.length}
              </Button>
              {rows.length > 0 && (
                <div className="ml-auto flex items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> {sentCount} enviadas
                  </span>
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <XCircle className="h-3 w-3" /> {failCount} falhas
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Resultados */}
          {rows.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-card">
              <div className="border-b border-border/60 px-5 py-3">
                <h2 className="font-display text-base font-semibold">Progresso do disparo</h2>
              </div>
              <div className="max-h-[480px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface/80 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Nome</th>
                      <th className="px-4 py-2 text-left">Telefone</th>
                      <th className="px-4 py-2 text-left">Status</th>
                      <th className="px-4 py-2 text-left">Detalhes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2">{r.nome}</td>
                        <td className="px-4 py-2 font-mono text-xs">{r.telefone}</td>
                        <td className="px-4 py-2">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {r.status === "sent" && (r.messageId ?? "enviada")}
                          {r.status === "failed" && <span className="text-destructive">{r.error}</span>}
                          {r.status === "sending" && "enviando…"}
                          {r.status === "pending" && "aguardando"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </PageContainer>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: SendStatus }) {
  const map: Record<SendStatus, { cls: string; label: string; icon: React.ReactNode }> = {
    pending: {
      cls: "border-border/60 bg-surface/50 text-muted-foreground",
      label: "Aguardando",
      icon: null,
    },
    sending: {
      cls: "border-primary/40 bg-primary/10 text-primary",
      label: "Enviando",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    sent: {
      cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
      label: "Enviada",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    failed: {
      cls: "border-destructive/40 bg-destructive/10 text-destructive",
      label: "Falhou",
      icon: <XCircle className="h-3 w-3" />,
    },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}
    >
      {s.icon}
      {s.label}
    </span>
  );
}
