import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Clock,
  ShieldAlert,
  ShieldCheck,
  FileText,
  CheckCheck,
  Check,
  Download,
  Play,
} from "lucide-react";
import {
  listConversationMessages,
  listLeadConversation,
  markConversationRead,
  sendTemplateInConversation,
  sendTextInConversation,
  listWhatsAppTemplates,
  sendAudioInConversation,
  fetchWhatsAppMedia,
} from "@/lib/whatsapp-inbox.functions";
import { MessageComposer } from "./MessageComposer";

type Msg = {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  message_type: string | null;
  template_name: string | null;
  status: string | null;
  created_at: string;
};

/**
 * Painel de chat que pode ser usado com:
 *  - conversationId (Inbox)
 *  - leadId (dentro do LeadDialog)
 * Um dos dois é obrigatório; se leadId sem conversa, aparece só o envio de template.
 */
export function ConversationPanel({
  conversationId,
  leadId,
  leadName,
  phone,
  compact = false,
  onConversationCreated,
}: {
  conversationId?: string | null;
  leadId?: string | null;
  leadName?: string | null;
  phone?: string | null;
  compact?: boolean;
  onConversationCreated?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const listMsgs = useServerFn(listConversationMessages);
  const listLead = useServerFn(listLeadConversation);
  const markRead = useServerFn(markConversationRead);
  const sendText = useServerFn(sendTextInConversation);
  const sendTpl = useServerFn(sendTemplateInConversation);
  const sendAudio = useServerFn(sendAudioInConversation);

  const [text, setText] = useState("");
  const [tplOpen, setTplOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const key = conversationId
    ? ["wa-conv-msgs", conversationId]
    : ["wa-lead-conv", leadId ?? "none"];

  const query = useQuery({
    queryKey: key,
    enabled: !!conversationId || !!leadId,
    queryFn: async () => {
      if (conversationId) {
        const r = (await listMsgs({ data: { conversationId } })) as
          | {
              ok: true;
              conversation: { id: string; phone: string; last_inbound_at: string | null } | null;
              messages: Msg[];
            }
          | { ok: false; error: string };
        if (!r.ok) throw new Error(r.error);
        return {
          conversationId,
          phone: r.conversation?.phone ?? phone ?? null,
          lastInboundAt: r.conversation?.last_inbound_at ?? null,
          messages: r.messages,
        };
      }
      const r = (await listLead({ data: { leadId: leadId! } })) as
        | {
            ok: true;
            conversation: { id: string; phone: string; last_inbound_at: string | null } | null;
            messages: Msg[];
          }
        | { ok: false; error: string };
      if (!("ok" in r) || !r.ok) throw new Error("Falha ao carregar conversa");
      return {
        conversationId: r.conversation?.id ?? null,
        phone: r.conversation?.phone ?? phone ?? null,
        lastInboundAt: r.conversation?.last_inbound_at ?? null,
        messages: r.messages,
      };
    },
  });

  const effectiveConversationId = conversationId ?? query.data?.conversationId ?? null;
  const effectivePhone = phone ?? query.data?.phone ?? null;
  // fallback: se a conversa não tem last_inbound_at gravado, deriva da última mensagem recebida
  const lastInboundAt = useMemo(() => {
    const fromConv = query.data?.lastInboundAt ?? null;
    const msgs = query.data?.messages ?? [];
    const lastInboundMsg = [...msgs].reverse().find((m) => m.direction === "inbound");
    const fromMsg = lastInboundMsg?.created_at ?? null;
    if (!fromConv) return fromMsg;
    if (!fromMsg) return fromConv;
    return new Date(fromMsg) > new Date(fromConv) ? fromMsg : fromConv;
  }, [query.data]);

  // Realtime subscribe
  useEffect(() => {
    if (!effectiveConversationId) return;
    const ch = supabase
      .channel(`wa-conv-${effectiveConversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_messages",
          filter: `conversation_id=eq.${effectiveConversationId}`,
        },
        () => qc.invalidateQueries({ queryKey: key }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveConversationId]);

  // marcar como lido ao abrir
  useEffect(() => {
    if (!effectiveConversationId) return;
    void markRead({ data: { conversationId: effectiveConversationId } }).then(() => {
      qc.invalidateQueries({ queryKey: ["wa-conversations"] });
      qc.invalidateQueries({ queryKey: ["lead-unread"] });
      qc.invalidateQueries({ queryKey: ["niche-unread"] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveConversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [query.data?.messages?.length]);

  const window24h = useMemo(() => {
    if (!lastInboundAt) return { open: false, remainingMs: 0 };
    const last = new Date(lastInboundAt).getTime();
    const remaining = last + 24 * 3600 * 1000 - Date.now();
    return { open: remaining > 0, remainingMs: Math.max(0, remaining) };
  }, [lastInboundAt]);

  const sendMut = useMutation({
    mutationFn: async () => {
      if (!effectivePhone) throw new Error("Sem número de destino");
      const r = (await sendText({
        data: {
          to: effectivePhone,
          body: text,
          conversationId: effectiveConversationId ?? undefined,
          leadId: leadId ?? undefined,
        },
      })) as { ok: boolean; error?: string; conversationId?: string };
      if (!r.ok) throw new Error(r.error);
      if (r.conversationId && onConversationCreated) onConversationCreated(r.conversationId);
    },
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["wa-conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const audioMut = useMutation({
    mutationFn: async ({ base64, mimeType }: { base64: string; mimeType: string }) => {
      if (!effectivePhone) throw new Error("Sem número de destino");
      const r = (await sendAudio({
        data: {
          to: effectivePhone,
          audioBase64: base64,
          mimeType,
          conversationId: effectiveConversationId ?? undefined,
          leadId: leadId ?? undefined,
        },
      })) as { ok: boolean; error?: string; conversationId?: string };
      if (!r.ok) throw new Error(r.error);
      if (r.conversationId && onConversationCreated) onConversationCreated(r.conversationId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["wa-conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div
      className={`flex ${compact ? "h-[420px]" : "h-full"} flex-col rounded-lg border border-border/60 bg-card`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono text-muted-foreground">{effectivePhone ?? "—"}</span>
        </div>
        <Window24hBadge
          open={window24h.open}
          remainingMs={window24h.remainingMs}
          hasInbound={!!lastInboundAt}
        />
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        {query.isLoading ? (
          <div className="grid place-items-center p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (query.data?.messages.length ?? 0) === 0 ? (
          <div className="grid place-items-center p-10 text-center text-sm text-muted-foreground">
            Nenhuma mensagem ainda. Envie um <b>template</b> para iniciar a conversa.
          </div>
        ) : (
          <ul className="grid gap-2">
            {query.data!.messages.map((m) => (
              <MessageBubble key={m.id} m={m} />
            ))}
            <div ref={bottomRef} />
          </ul>
        )}
      </ScrollArea>

      <div className="border-t border-border/60 p-2">
        <Dialog open={tplOpen} onOpenChange={setTplOpen}>
          {window24h.open ? (
            <MessageComposer
              value={text}
              onChange={setText}
              sending={sendMut.isPending}
              disabled={!effectivePhone}
              onSend={() => sendMut.mutate()}
              onSendAudio={async (base64, mimeType) => {
                await audioMut.mutateAsync({ base64, mimeType });
              }}
              onOpenTemplates={() => setTplOpen(true)}
            />
          ) : (
            <div className="grid gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <div className="flex items-center gap-2 text-amber-400">
                <ShieldAlert className="h-4 w-4" />
                <b>Janela de 24h fechada.</b>
              </div>
              <p className="text-muted-foreground">
                Fora da janela, o WhatsApp só aceita <b>mensagens de modelo (template)</b> aprovadas
                pela Meta.
              </p>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={!effectivePhone}>
                  <FileText className="mr-2 h-4 w-4" /> Enviar mensagem de modelo
                </Button>
              </DialogTrigger>
            </div>
          )}
          <TemplateDialog
            to={effectivePhone ?? ""}
            conversationId={effectiveConversationId ?? undefined}
            leadId={leadId ?? undefined}
            leadName={leadName ?? undefined}
            onSent={() => {
              setTplOpen(false);
              qc.invalidateQueries({ queryKey: key });
              qc.invalidateQueries({ queryKey: ["wa-conversations"] });
            }}
          />
        </Dialog>
      </div>
    </div>
  );
}

function Window24hBadge({
  open,
  remainingMs,
  hasInbound,
}: {
  open: boolean;
  remainingMs: number;
  hasInbound: boolean;
}) {
  if (!hasInbound) {
    return (
      <Badge variant="outline" className="gap-1 border-muted-foreground/30 text-muted-foreground">
        <Clock className="h-3 w-3" /> Sem inbound
      </Badge>
    );
  }
  if (open) {
    const h = Math.floor(remainingMs / 3600_000);
    const m = Math.floor((remainingMs % 3600_000) / 60_000);
    return (
      <Badge
        className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
        variant="outline"
      >
        <ShieldCheck className="h-3 w-3" /> Janela 24h · {h}h{m}m
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-500/40 bg-amber-500/10 text-amber-400">
      <ShieldAlert className="h-3 w-3" /> Janela fechada
    </Badge>
  );
}

function MediaAttachment({ m }: { m: Msg }) {
  const fetchMedia = useServerFn(fetchWhatsAppMedia);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [mime, setMime] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const type = (m.message_type ?? "").toLowerCase();
  const isAudio = type === "audio" || type === "voice";
  const isImage = type === "image" || type === "sticker";
  const isVideo = type === "video";
  const isDoc = type === "document";

  async function load() {
    setState("loading");
    try {
      const r = (await fetchMedia({ data: { messageId: m.id } })) as
        | { ok: true; dataUrl: string; mimeType: string; filename: string | null }
        | { ok: false; error: string };
      if (!r.ok) throw new Error(r.error);
      setUrl(r.dataUrl);
      setMime(r.mimeType);
      setState("ready");
    } catch (e) {
      setErr((e as Error).message);
      setState("error");
    }
  }

  // Áudio recebido: carrega automaticamente para já ficar pronto para ouvir.
  useEffect(() => {
    if (isAudio && state === "idle") void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudio, m.id]);

  if (state === "ready" && url) {
    if (isAudio) {
      return (
        <audio
          controls
          preload="metadata"
          src={url}
          className="mt-1 h-10 w-[240px] max-w-full"
        />
      );
    }
    if (isImage) {
      return (
        <img
          src={url}
          alt="Imagem recebida no WhatsApp"
          loading="lazy"
          className="mt-1 max-h-64 w-auto rounded-lg"
        />
      );
    }
    if (isVideo) {
      return <video controls src={url} className="mt-1 max-h-64 w-full rounded-lg" />;
    }
    return (
      <a
        href={url}
        download
        className="mt-1 inline-flex items-center gap-1 text-xs underline opacity-90"
      >
        <Download className="h-3 w-3" /> Baixar arquivo ({mime})
      </a>
    );
  }

  return (
    <div className="mt-1">
      <Button
        size="sm"
        variant="secondary"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => void load()}
        disabled={state === "loading"}
      >
        {state === "loading" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isAudio ? (
          <Play className="h-3 w-3" />
        ) : (
          <Download className="h-3 w-3" />
        )}
        {state === "loading"
          ? "Carregando…"
          : state === "error"
            ? "Tentar de novo"
            : isAudio
              ? "Ouvir áudio"
              : isDoc
                ? "Abrir documento"
                : "Carregar mídia"}
      </Button>
      {state === "error" && err && (
        <div className="mt-1 text-[10px] text-amber-400">{err}</div>
      )}
    </div>
  );
}

function MessageBubble({ m }: { m: Msg }) {
  const isOut = m.direction === "outbound";
  const type = (m.message_type ?? "").toLowerCase();
  const hasMedia = ["audio", "voice", "image", "video", "document", "sticker"].includes(type);
  const time = new Date(m.created_at).toLocaleString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
  return (
    <li className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          isOut
            ? "rounded-br-md bg-primary/90 text-primary-foreground"
            : "rounded-bl-md bg-surface text-foreground"
        }`}
      >
        {m.template_name && (
          <div className="mb-1 inline-flex items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-widest">
            <FileText className="h-3 w-3" /> template · {m.template_name}
          </div>
        )}
        {hasMedia ? (
          <>
            {m.body && !/^(\[|🎤|🖼️|🎬|📎|📍)/.test(m.body) && (
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
            )}
            <MediaAttachment m={m} />
          </>
        ) : (
          <div className="whitespace-pre-wrap break-words">{m.body ?? "—"}</div>
        )}
        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
          {time}
          {isOut &&
            (m.status === "read" ? (
              <CheckCheck className="h-3 w-3" />
            ) : (
              <Check className="h-3 w-3" />
            ))}
        </div>
      </div>
    </li>
  );
}


function TemplateDialog({
  to,
  conversationId,
  leadId,
  leadName,
  onSent,
}: {
  to: string;
  conversationId?: string;
  leadId?: string;
  leadName?: string;
  onSent: () => void;
}) {
  const listTpl = useServerFn(listWhatsAppTemplates);
  const sendTpl = useServerFn(sendTemplateInConversation);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("pt_BR");
  const [params, setParams] = useState<string[]>([]);
  const [headerParams, setHeaderParams] = useState<string[]>([]);
  const [manualName, setManualName] = useState("");

  // Primeiro nome do lead — preenchido automaticamente na 1ª variável do corpo
  const firstName = (leadName ?? "").trim().split(/\s+/)[0] ?? "";

  const q = useQuery({
    queryKey: ["wa-templates"],
    queryFn: async () => (await listTpl()) as any,
  });

  const templates: any[] = q.data?.ok ? q.data.templates : [];
  const selected = templates.find((t) => t.name === name);
  const bodyComp = selected?.components?.find((c: any) => c.type === "BODY");
  const headerComp = selected?.components?.find(
    (c: any) => c.type === "HEADER" && (c.format ?? "TEXT") === "TEXT",
  );
  // Aceita placeholders numéricos ({{1}}) e nomeados ({{nome}}).
  const countVars = (t?: string) => {
    if (!t) return 0;
    const found = t.match(/\{\{\s*[^}\s][^}]*\s*\}\}/g) ?? [];
    if (!found.length) return 0;
    const nums = found
      .map((m) => Number(m.replace(/[{}\s]/g, "")))
      .filter((n) => Number.isFinite(n));
    // Numérico: usa o maior índice. Nomeado: conta os distintos.
    return nums.length === found.length
      ? Math.max(...nums)
      : new Set(found.map((m) => m.replace(/\s+/g, ""))).size;
  };
  const paramCount = countVars(bodyComp?.text);
  const headerCount = countVars(headerComp?.text);
  const autoName = !!firstName && paramCount > 0;

  useEffect(() => {
    setParams(Array(paramCount).fill("").map((v, i) => (i === 0 && firstName ? firstName : v)));
    setHeaderParams(Array(headerCount).fill(""));
    if (selected?.language) setLanguage(selected.language);
  }, [name, paramCount, headerCount, selected?.language, firstName]);


  const mut = useMutation({
    mutationFn: async () => {
      const finalName = name || manualName;
      if (!finalName) throw new Error("Escolha ou digite o nome do template");
      const r = (await sendTpl({
        data: {
          to,
          templateName: finalName,
          language,
          bodyParams: params,
          headerParams,
          conversationId,
          leadId,
          leadName: leadName || undefined,

        },
      })) as { ok: boolean; error?: string };
      if (!r.ok) throw new Error(r.error);
    },
    onSuccess: () => {
      toast.success("Template enviado");
      onSent();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Enviar mensagem de modelo</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        <p className="text-xs text-muted-foreground">
          Templates devem estar <b>aprovados</b> na Meta. Fora da janela de 24h só é possível
          iniciar conversa com template.
        </p>

        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando templates…</div>
        ) : templates.length > 0 ? (
          <div className="grid gap-2">
            <label className="text-sm font-medium">Template aprovado</label>
            <Select value={name} onValueChange={setName}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={`${t.name}-${t.language}`} value={t.name}>
                    {t.name} · {t.language} · {t.category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-400">
              {q.data && !q.data.ok
                ? q.data.error
                : "Nenhum template aprovado encontrado. Digite o nome manualmente."}
            </div>
            <label className="text-sm font-medium">Nome do template</label>
            <Input
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="hello_world"
            />
          </div>
        )}

        <div className="grid grid-cols-[1fr_120px] gap-2">
          <div />
          <div>
            <label className="text-xs text-muted-foreground">Idioma</label>
            <Input value={language} onChange={(e) => setLanguage(e.target.value)} />
          </div>
        </div>

        {selected && (bodyComp?.text || headerComp?.text) && (
          <div className="grid gap-1 rounded-md border border-border/60 bg-surface/40 p-3 text-xs">
            <div className="font-medium text-muted-foreground">Pré-visualização do template</div>
            {headerComp?.text && <div className="font-semibold">{headerComp.text}</div>}
            {bodyComp?.text && <div className="whitespace-pre-wrap">{bodyComp.text}</div>}
            <div className="text-[11px] text-muted-foreground">
              Variáveis: {headerCount} no título · {paramCount} no corpo
            </div>
          </div>
        )}

        {headerCount > 0 && (
          <div className="grid gap-2 rounded-md border border-border/60 p-3">
            <div className="text-xs font-medium">Parâmetros do título</div>
            {headerParams.map((p, i) => (
              <Input
                key={i}
                value={p}
                onChange={(e) => {
                  const next = [...headerParams];
                  next[i] = e.target.value;
                  setHeaderParams(next);
                }}
                placeholder={`{{${i + 1}}}`}
              />
            ))}
          </div>
        )}

        {paramCount > 0 && (
          <div className="grid gap-2 rounded-md border border-border/60 p-3">
            <div className="text-xs font-medium">Parâmetros do corpo</div>
            {autoName && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-xs">
                <span className="text-muted-foreground">
                  {"{{1}}"} · nome do lead (automático)
                </span>
                <b className="truncate">{firstName}</b>
              </div>
            )}
            {params.map((p, i) =>
              autoName && i === 0 ? null : (
                <Input
                  key={i}
                  value={p}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = e.target.value;
                    setParams(next);
                  }}
                  placeholder={`{{${i + 1}}}`}
                />
              ),
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button
          className="grad-brand text-primary-foreground"
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
        >
          {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enviar template
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
