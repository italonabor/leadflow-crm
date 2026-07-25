import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveWorkspace } from "@/lib/useActiveWorkspace";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
  head: () => ({
    meta: [
      { title: "Chat da equipe · Prospecta" },
      { name: "description", content: "Chat interno entre administrador e vendedores do workspace." },
      { property: "og:title", content: "Chat da equipe · Prospecta" },
      { property: "og:description", content: "Chat interno entre administrador e vendedores do workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Message = {
  id: string;
  workspace_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

type Member = {
  user_id: string;
  role: "admin" | "atendente";
  email: string;
  display_name: string | null;
};

function ChatPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const wsQ = useActiveWorkspace(user.id);
  const ws = wsQ.data;

  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const membersQ = useQuery({
    queryKey: ["members", ws?.id],
    enabled: !!ws?.id,
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase.rpc("list_workspace_members", { _workspace_id: ws!.id });
      if (error) throw error;
      return (data ?? []) as Member[];
    },
  });

  const messagesQ = useQuery({
    queryKey: ["messages", ws?.id],
    enabled: !!ws?.id,
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await (supabase as any)
        .from("workspace_messages")
        .select("id, workspace_id, sender_id, content, created_at")
        .eq("workspace_id", ws!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Message[];
    },
  });

  const send = useMutation({
    mutationFn: async (content: string) => {
      if (!ws) throw new Error("Workspace não carregado");
      const { error } = await (supabase as any).from("workspace_messages").insert({
        workspace_id: ws.id,
        sender_id: user.id,
        content: content.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["messages", ws?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (!ws?.id) return;
    const channel = supabase
      .channel(`workspace_messages:${ws.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "workspace_messages", filter: `workspace_id=eq.${ws.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["messages", ws.id] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ws?.id, qc]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQ.data?.length]);

  const members = membersQ.data ?? [];
  const messages = messagesQ.data ?? [];

  const senderMap = new Map(members.map((m) => [m.user_id, m]));
  const me = senderMap.get(user.id);

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (send.isPending) return;
    send.mutate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }

  return (
    <AppShell user={user} title="Chat da equipe" scrollable={false}>
      <div className="flex h-full flex-col">
        {/* Member pills */}
        <div className="border-b border-border/60 bg-surface/40 px-4 py-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-xs text-muted-foreground">Membros:</span>
            {members.map((m) => (
              <span
                key={m.user_id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${
                  m.user_id === user.id ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-card"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {m.display_name || m.email}
                {m.role === "admin" && <span className="text-[10px] text-muted-foreground">(admin)</span>}
              </span>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-4 px-4 py-4">
              {messages.length === 0 && (
                <div className="grid h-40 place-items-center text-sm text-muted-foreground">
                  Nenhuma mensagem ainda. Inicie a conversa com sua equipe.
                </div>
              )}
              {messages.map((msg, idx) => {
                const isMe = msg.sender_id === user.id;
                const sender = senderMap.get(msg.sender_id);
                const showDate =
                  idx === 0 || formatDate(msg.created_at) !== formatDate(messages[idx - 1]!.created_at);
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div className="my-4 flex items-center gap-3">
                        <div className="h-px flex-1 bg-border/60" />
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {formatDate(msg.created_at)}
                        </span>
                        <div className="h-px flex-1 bg-border/60" />
                      </div>
                    )}
                    <div className={`flex gap-3 ${isMe ? "flex-row-reverse" : ""}`}>
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                        {(sender?.display_name || sender?.email || "?")[0]?.toUpperCase()}
                      </div>
                      <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                        <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {isMe ? "Você" : sender?.display_name || sender?.email || "Desconhecido"}
                          </span>
                          <span>{formatTime(msg.created_at)}</span>
                        </div>
                        <div
                          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                            isMe
                              ? "rounded-tr-none bg-primary text-primary-foreground"
                              : "rounded-tl-none border border-border bg-card text-foreground"
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Input */}
        <div className="border-t border-border/60 bg-surface/40 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite uma mensagem..."
              rows={1}
              className="min-h-[44px] resize-none rounded-xl border-border bg-card py-2.5 pr-4"
              disabled={send.isPending || !ws}
            />
            <Button
              size="icon"
              className="grad-brand h-11 w-11 shrink-0 rounded-xl text-primary-foreground"
              onClick={handleSend}
              disabled={send.isPending || !text.trim() || !ws}
              aria-label="Enviar"
            >
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">Enter para enviar · Shift+Enter para nova linha</p>
        </div>
      </div>
    </AppShell>
  );
}
