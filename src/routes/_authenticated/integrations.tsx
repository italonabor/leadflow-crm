import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Workflow, MessageCircle, Copy } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/integrations")({
  component: IntegrationsPage,
});

const SAMPLE_PAYLOAD = `{
  "event": "lead.stage_changed",
  "stage": { "id": "uuid", "name": "Contato Feito" },
  "lead": {
    "id": "uuid",
    "nome": "João Silva",
    "profissao": "Advogado",
    "telefone": "5511999999999",
    "rede_social": "Instagram",
    "link": "https://instagram.com/joao",
    "notes": "Indicação"
  },
  "message_template": "Olá {nome}, tudo bem?",
  "message": "Olá João Silva, tudo bem?"
}`;

function IntegrationsPage() {
  const copyPayload = async () => {
    await navigator.clipboard.writeText(SAMPLE_PAYLOAD);
    toast.success("Payload copiado");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="glass flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-6">
        <Link to="/board" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar ao board
        </Link>
        <div className="flex items-center gap-2 font-display font-semibold">
          <Workflow className="h-5 w-5 text-primary" /> Integrações
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="font-display text-2xl font-bold">n8n + WhatsApp</h1>
        <p className="mt-2 text-muted-foreground">
          O Prospecta abre conversas no WhatsApp direto do card do lead (click-to-chat).
          Para automatizar envios quando um lead muda de etapa, use o n8n como orquestrador.
        </p>

        <section className="mt-8 space-y-6">
          <Card
            step={1}
            title="Click-to-chat (já funciona)"
            icon={<MessageCircle className="h-5 w-5 text-emerald-500" />}
          >
            <p>
              Qualquer lead com telefone mostra um botão de WhatsApp no card e no diálogo de edição.
              Clique para abrir a conversa no WhatsApp Web ou no app.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Dica: cadastre uma <b>mensagem-modelo</b> em cada etapa (ao editar a coluna). Suporta
              placeholders <code>{"{nome}"}</code>, <code>{"{profissao}"}</code>,{" "}
              <code>{"{telefone}"}</code>, <code>{"{rede_social}"}</code>, <code>{"{link}"}</code>.
            </p>
          </Card>

          <Card step={2} title="Instale/acesse seu n8n">
            <p>
              Use a versão cloud em <a className="text-primary hover:underline" href="https://n8n.io" target="_blank" rel="noreferrer">n8n.io</a>{" "}
              ou rode local com Docker:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs">
{`docker run -it --rm -p 5678:5678 n8nio/n8n`}
            </pre>
          </Card>

          <Card step={3} title="Crie um workflow com trigger Webhook">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>No n8n, crie um workflow novo.</li>
              <li>Adicione o nó <b>Webhook</b> como gatilho, método <code>POST</code>.</li>
              <li>Copie a <b>Production URL</b> gerada.</li>
              <li>Ative o workflow.</li>
            </ol>
          </Card>

          <Card step={4} title="Cole a URL na etapa do CRM">
            <p>
              No board, clique no nome da etapa (ex.: <i>Contato Feito</i>) → cole a URL em{" "}
              <b>Webhook n8n</b>, escreva a <b>mensagem-modelo</b> e ative{" "}
              <b>Disparar webhook ao mover lead para esta etapa</b>. Salve.
            </p>
          </Card>

          <Card step={5} title="Envie o WhatsApp dentro do n8n">
            <p>
              No mesmo workflow, adicione um nó de envio de mensagem — por exemplo:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              <li><b>Evolution API</b> (open-source): nó HTTP Request para <code>POST /message/sendText/&lt;instance&gt;</code></li>
              <li><b>Z-API</b> / <b>UltraMsg</b> / <b>Twilio WhatsApp</b>: use o nó HTTP Request com o token</li>
              <li><b>WhatsApp Cloud API</b> (Meta): nó HTTP Request para <code>graph.facebook.com</code></li>
            </ul>
            <p className="mt-2 text-sm text-muted-foreground">
              Use os campos do payload abaixo: <code>{"{{ $json.lead.telefone }}"}</code> e{" "}
              <code>{"{{ $json.message }}"}</code>.
            </p>
          </Card>

          <Card step={6} title="Payload enviado pelo CRM">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Cole no nó Webhook para testar.</p>
              <Button size="sm" variant="outline" onClick={copyPayload}>
                <Copy className="mr-2 h-3.5 w-3.5" /> Copiar
              </Button>
            </div>
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 text-xs">{SAMPLE_PAYLOAD}</pre>
          </Card>
        </section>

        <div className="mt-8 rounded-lg border border-border/60 bg-surface/40 p-4 text-sm text-muted-foreground">
          Precisa de ajuda? Consulte a{" "}
          <a className="text-primary hover:underline" href="https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/" target="_blank" rel="noreferrer">
            documentação do nó Webhook do n8n
          </a>.
        </div>
      </main>
    </div>
  );
}

function Card({ step, title, icon, children }: { step: number; title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 shadow-card">
      <div className="mb-2 flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">{step}</div>
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {icon && <span className="ml-auto">{icon}</span>}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
