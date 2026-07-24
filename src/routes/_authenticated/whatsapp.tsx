import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
} from "lucide-react";
import { checkWhatsAppConnection, sendWhatsAppCloudMessage } from "@/lib/whatsapp-cloud.functions";

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

function WhatsAppPage() {
  const { user } = Route.useRouteContext();
  const check = useServerFn(checkWhatsAppConnection);
  const send = useServerFn(sendWhatsAppCloudMessage);

  const [result, setResult] = useState<CheckResult | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Teste do Prospecta CRM ✅");

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
      return await send({ data: { to: testPhone, message: testMessage } });
    },
    onSuccess: (r) => toast.success(`Mensagem enviada · id ${r.messageId ?? "—"}`),
    onError: (e: Error) => toast.error(e.message),
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

          <section className="rounded-xl border border-border/60 bg-card p-5 shadow-card">
            <div className="mb-4 flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold">Enviar mensagem de teste</h2>
                <p className="text-xs text-muted-foreground">
                  Em modo <b>teste</b> do Meta, o destinatário precisa estar cadastrado como recebedor de teste e ter janela ativa de 24h.
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
                <div className="grid gap-1.5">
                  <Label>Telefone (com DDI)</Label>
                  <Input
                    placeholder="5562948471800"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                  />
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
              <div>
                <Button
                  className="grad-brand text-primary-foreground"
                  onClick={() => test.mutate()}
                  disabled={test.isPending || !testPhone.trim()}
                >
                  {test.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Enviar teste
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-border/60 bg-card/60 p-5 text-sm text-muted-foreground">
            <b className="text-foreground">Onde encontrar as credenciais:</b> no{" "}
            <a
              className="text-primary hover:underline"
              href="https://developers.facebook.com/apps"
              target="_blank"
              rel="noreferrer"
            >
              Meta for Developers
            </a>{" "}
            → seu App → <i>WhatsApp → API Setup</i>. Copie o <b>Temporary access token</b> (ou permanente) e o{" "}
            <b>Phone number ID</b> abaixo do número.
          </section>
        </div>
      </PageContainer>
    </AppShell>
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
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
