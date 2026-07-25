import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  ShieldCheck,
  KeyRound,
  MessageCircle,
  RefreshCw,
  Copy,
  FileJson,
  Clock,
} from "lucide-react";
import {
  checkWhatsAppConnection,
  listLeadsForWhatsApp,
  sendWhatsAppCloudMessage,
} from "@/lib/whatsapp-cloud.functions";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  component: WhatsAppPage,
});

type CheckResult =
  | {
      ok: true;
      hasToken: boolean;
      hasPhoneId: boolean;
      phone: string | null;
      verifiedName: string | null;
      qualityRating: string | null;
      platformType: string | null;
    }
  | { ok: false; hasToken: boolean; hasPhoneId: boolean; error: string };

type SendResult = Awaited<ReturnType<typeof sendWhatsAppCloudMessage>>;

function WhatsAppPage() {
  const { user } = Route.useRouteContext();
  const check = useServerFn(checkWhatsAppConnection);
  const send = useServerFn(sendWhatsAppCloudMessage);
  const listLeads = useServerFn(listLeadsForWhatsApp);

  const [result, setResult] = useState<CheckResult | null>(null);
  const [mode, setMode] = useState<"lead" | "manual">("lead");
  const [selectedLeadId, setSelectedLeadId] = useState<string>("");
  const [manualPhone, setManualPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Teste do Prospecta CRM ✅");
  const [sendLog, setSendLog] = useState<SendResult | null>(null);

  const leadsQuery = useQuery({
    queryKey: ["whatsapp-leads"],
    queryFn: async () => (await listLeads()) as Awaited<ReturnType<typeof listLeadsForWhatsApp>>,
    staleTime: 30_000,
  });

  const leads = useMemo(() => {
    if (!leadsQuery.data || !("ok" in leadsQuery.data) || !leadsQuery.data.ok) return [];
    return leadsQuery.data.leads.filter((l) => (l.telefone ?? "").replace(/\D/g, "").length >= 8);
  }, [leadsQuery.data]);

  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;
  const recipient = mode === "lead" ? selectedLead?.telefone ?? "" : manualPhone;

  const validate = useMutation({
    mutationFn: async () => (await check()) as CheckResult,
    onSuccess: (r) => {
      setResult(r);
      if (r.ok) toast.success("Conexão OK");
      else toast.error(r.error);
    },
    onError: (e: Error) => {
      setResult({ ok: false, hasToken: false, hasPhoneId: false, error: e.message });
      toast.error(e.message);
    },
  });

  const test = useMutation({
    mutationFn: async () => {
      return (await send({ data: { to: recipient, message: testMessage } })) as SendResult;
    },
    onSuccess: (r) => {
      setSendLog(r);
      if (r.ok) toast.success(`Enviado · id ${r.messageId ?? "—"}`);
      else toast.error(`${r.stage}: ${r.error}`);
    },
    onError: (e: Error) => {
      setSendLog({
        ok: false,
        stage: "network",
        error: e.message,
        request: null,
        response: null,
        durationMs: 0,
      } as unknown as SendResult);
      toast.error(e.message);
    },
  });

  return (
    <AppShell
      user={user}
      title="WhatsApp Business"
      toolbar={
        <Button size="sm" variant="outline" onClick={() => validate.mutate()} disabled={validate.isPending}>
          {validate.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Validar conexão
        </Button>
      }
    >
      <PageContainer>
        <div className="grid gap-6">
          {/* Credenciais */}
          <section className="rounded-xl border border-border/60 bg-card p-5 shadow-card">
            <div className="mb-4 flex items-center gap-2">
              <div className="grad-brand grid h-9 w-9 place-items-center rounded-lg">
                <ShieldCheck className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">Status das credenciais</h2>
                <p className="text-xs text-muted-foreground">
                  Verifica <code>WHATSAPP_ACCESS_TOKEN</code> e <code>WHATSAPP_PHONE_NUMBER_ID</code> no servidor.
                </p>
              </div>
            </div>

            {!result && !validate.isPending && (
              <div className="rounded-lg border border-dashed border-border/60 bg-surface/40 p-6 text-center text-sm text-muted-foreground">
                Clique em <b>Validar conexão</b> para consultar a Graph API do WhatsApp.
              </div>
            )}
            {validate.isPending && (
              <div className="grid place-items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Consultando Meta / WhatsApp Cloud API…
              </div>
            )}

            {result && (
              <div className="grid gap-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <StatusRow ok={result.hasToken} label="WHATSAPP_ACCESS_TOKEN" icon={<KeyRound className="h-4 w-4" />} />
                  <StatusRow ok={result.hasPhoneId} label="WHATSAPP_PHONE_NUMBER_ID" icon={<KeyRound className="h-4 w-4" />} />
                </div>

                {result.ok ? (
                  <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
                    <div className="mb-2 flex items-center gap-2 text-emerald-400">
                      <CheckCircle2 className="h-5 w-5" />
                      <b>Conexão ativa com o WhatsApp Cloud API</b>
                    </div>
                    <dl className="grid gap-2 text-sm sm:grid-cols-2">
                      <Field label="Número exibido" value={result.phone ?? "—"} />
                      <Field label="Nome verificado" value={result.verifiedName ?? "—"} />
                      <Field label="Qualidade" value={result.qualityRating ?? "—"} />
                      <Field label="Plataforma" value={result.platformType ?? "—"} />
                    </dl>
                  </div>
                ) : (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                    <div className="mb-1 flex items-center gap-2 font-semibold">
                      <XCircle className="h-5 w-5" /> Falha na validação
                    </div>
                    <div className="text-destructive/90">{result.error}</div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Envio de teste */}
          <section className="rounded-xl border border-border/60 bg-card p-5 shadow-card">
            <div className="mb-4 flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">Mensagem de teste</h2>
                <p className="text-xs text-muted-foreground">
                  Escolha um lead do funil ou digite um número. O request e a resposta da Graph API aparecem abaixo.
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={mode === "lead" ? "default" : "outline"}
                  onClick={() => setMode("lead")}
                >
                  Escolher lead
                </Button>
                <Button
                  size="sm"
                  variant={mode === "manual" ? "default" : "outline"}
                  onClick={() => setMode("manual")}
                >
                  Digitar número
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                <div className="grid gap-1.5">
                  <Label>Destinatário</Label>
                  {mode === "lead" ? (
                    <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            leadsQuery.isLoading
                              ? "Carregando leads…"
                              : leads.length === 0
                                ? "Nenhum lead com telefone"
                                : "Selecione um lead"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {leads.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.nome} — {l.telefone}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="5562948471800"
                      value={manualPhone}
                      onChange={(e) => setManualPhone(e.target.value)}
                    />
                  )}
                  {mode === "lead" && selectedLead && (
                    <p className="text-xs text-muted-foreground">
                      Enviando para <b>{selectedLead.telefone}</b>
                    </p>
                  )}
                </div>

                <div className="grid gap-1.5">
                  <Label>Mensagem</Label>
                  <Textarea
                    rows={3}
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  className="grad-brand text-primary-foreground"
                  onClick={() => test.mutate()}
                  disabled={test.isPending || !recipient.trim() || !testMessage.trim()}
                >
                  {test.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Enviar teste
                </Button>
                {sendLog && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {sendLog.durationMs} ms
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Log request/response */}
          {sendLog && <SendLogPanel log={sendLog} />}

          <section className="rounded-xl border border-border/60 bg-card/60 p-5 text-sm text-muted-foreground">
            <b className="text-foreground">Dica:</b> no modo <i>teste</i> do Meta, o destinatário precisa estar cadastrado como recebedor de teste no painel do app, ter enviado mensagem nas últimas 24h ou receber um <b>template aprovado</b>. Erros comuns: <code>#131030</code> (destinatário fora da lista), <code>#131047</code> (fora da janela de 24h), <code>#133010</code> (número não registrado).
          </section>
        </div>
      </PageContainer>
    </AppShell>
  );
}

function SendLogPanel({ log }: { log: SendResult }) {
  const copy = (v: unknown) => {
    void navigator.clipboard.writeText(typeof v === "string" ? v : JSON.stringify(v, null, 2));
    toast.success("Copiado");
  };

  const okBadge = log.ok ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
      <CheckCircle2 className="h-3 w-3" /> Enviado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
      <XCircle className="h-3 w-3" /> {log.stage}
    </span>
  );

  return (
    <section className="rounded-xl border border-border/60 bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <FileJson className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">Log da requisição</h2>
            <p className="text-xs text-muted-foreground">
              Duração <b>{log.durationMs} ms</b> · Stage <code>{log.stage}</code>
            </p>
          </div>
        </div>
        {okBadge}
      </div>

      {log.ok ? (
        <div className="mb-3 grid gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm sm:grid-cols-2">
          <Field label="messages[0].id" value={log.messageId ?? "—"} />
          <Field label="contacts[0].wa_id" value={log.waId ?? "—"} />
        </div>
      ) : (
        <div className="mb-3 grid gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <Field label="error" value={log.error} />
          {"errorCode" in log && (
            <>
              <Field label="code" value={String(log.errorCode ?? "—")} />
              <Field label="subcode" value={String(log.errorSubcode ?? "—")} />
              <Field label="details" value={log.errorDetails ?? "—"} />
              <Field label="fbtrace_id" value={log.fbtraceId ?? "—"} />
            </>
          )}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <LogBlock title="Request" onCopy={() => copy(log.request)} data={log.request} />
        <LogBlock title="Response" onCopy={() => copy(log.response)} data={log.response} />
      </div>
    </section>
  );
}

function LogBlock({
  title,
  data,
  onCopy,
}: {
  title: string;
  data: unknown;
  onCopy: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-surface/50">
      <div className="flex items-center justify-between border-b border-border/60 bg-surface/80 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </span>
        <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={onCopy}>
          <Copy className="h-3 w-3" /> Copiar
        </Button>
      </div>
      <pre className="max-h-96 overflow-auto p-3 text-xs leading-relaxed text-foreground/90">
        {data == null ? "—" : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function StatusRow({ ok, label, icon }: { ok: boolean; label: string; icon: React.ReactNode }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
        ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"
      }`}
    >
      <span className={ok ? "text-emerald-400" : "text-destructive"}>{icon}</span>
      <span className="flex-1 font-mono text-xs">{label}</span>
      {ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
      ) : (
        <XCircle className="h-4 w-4 text-destructive" />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-all font-medium">{value}</dd>
    </div>
  );
}
