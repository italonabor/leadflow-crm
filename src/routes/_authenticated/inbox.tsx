import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, MessageCircle } from "lucide-react";
import { ConversationPanel } from "@/components/whatsapp/ConversationPanel";
import { listConversations } from "@/lib/whatsapp-inbox.functions";

export const Route = createFileRoute("/_authenticated/inbox")({
  component: InboxPage,
  validateSearch: (search: Record<string, unknown>) => ({
    phone: typeof search.phone === "string" ? search.phone : undefined,
    leadId: typeof search.leadId === "string" ? search.leadId : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Inbox WhatsApp · Prospecta CRM" },
      { name: "description", content: "Caixa de entrada do WhatsApp Business com histórico por lead e janela de 24h." },
      { property: "og:title", content: "Inbox WhatsApp · Prospecta CRM" },
      { property: "og:description", content: "Receba, responda e envie templates do WhatsApp direto no CRM." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Conv = {
  id: string;
  phone: string;
  lead_id: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  leads: { nome: string; telefone: string | null } | null;
};

function InboxPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const list = useServerFn(listConversations);
  const [selected, setSelected] = useState<Conv | null>(null);
  const [filter, setFilter] = useState("");

  const q = useQuery({
    queryKey: ["wa-conversations"],
    queryFn: async () => {
      const r = (await list()) as { ok: true; conversations: Conv[] } | { ok: false; error: string };
      if (!r.ok) throw new Error(r.error);
      return r.conversations;
    },
    refetchInterval: 10_000,
  });

  // Realtime invalidation quando qualquer conversa muda
  useEffect(() => {
    const ch = supabase
      .channel("wa-conversations-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, () => {
        qc.invalidateQueries({ queryKey: ["wa-conversations"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const conversations = (q.data ?? []).filter((c) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return (
      c.phone.includes(f) ||
      (c.leads?.nome ?? "").toLowerCase().includes(f) ||
      (c.last_message_preview ?? "").toLowerCase().includes(f)
    );
  });

  return (
    <AppShell user={user} title="Inbox WhatsApp" scrollable={false}>
      <PageContainer>
        <div className="grid h-[calc(100vh-9rem)] grid-cols-1 gap-4 md:grid-cols-[340px_1fr]">
          {/* Lista */}
          <aside className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card">
            <div className="border-b border-border/60 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Buscar conversa…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              {q.isLoading ? (
                <div className="grid place-items-center p-10">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="grid place-items-center gap-2 p-10 text-center text-sm text-muted-foreground">
                  <MessageCircle className="h-8 w-8 opacity-30" />
                  Nenhuma conversa ainda.
                  <p className="text-xs">
                    Configure o webhook em <b>/whatsapp</b> e envie um template para iniciar.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {conversations.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelected(c)}
                        className={`flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-surface/60 ${
                          selected?.id === c.id ? "bg-surface/80" : ""
                        }`}
                      >
                        <div className="grad-brand grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-primary-foreground">
                          {(c.leads?.nome ?? c.phone).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-semibold">
                              {c.leads?.nome ?? c.phone}
                            </div>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {c.last_message_at
                                ? new Date(c.last_message_at).toLocaleString("pt-BR", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    day: "2-digit",
                                    month: "2-digit",
                                  })
                                : ""}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs text-muted-foreground">
                              {c.last_message_preview ?? c.phone}
                            </p>
                            {c.unread_count > 0 && (
                              <Badge className="grad-brand h-5 min-w-[20px] justify-center px-1.5 text-[10px] text-primary-foreground">
                                {c.unread_count}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </aside>

          {/* Chat */}
          <section className="min-h-0">
            {selected ? (
              <ConversationPanel
                conversationId={selected.id}
                leadId={selected.lead_id}
                phone={selected.phone}
              />
            ) : (
              <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/60 bg-card/40 text-sm text-muted-foreground">
                Selecione uma conversa para começar.
              </div>
            )}
          </section>
        </div>
      </PageContainer>
    </AppShell>
  );
}
