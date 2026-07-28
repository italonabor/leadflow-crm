import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Column, LeadCard } from "@/components/kanban/Column";
import { LeadDialog } from "@/components/kanban/LeadDialog";
import { StageDialog } from "@/components/kanban/StageDialog";
import type { Lead, Stage } from "@/components/kanban/types";
import { downloadTemplate, exportLeadsToExcel, parseLeadsFile } from "@/lib/excel";
import { toast } from "sonner";
import { Download, Upload, Plus, FileDown, Loader2, Users as UsersIcon, TrendingUp, Search, X } from "lucide-react";
import { renderTemplate, normalizePhone } from "@/lib/whatsapp";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { ConversationPanel } from "@/components/whatsapp/ConversationPanel";
import { useActiveWorkspace } from "@/lib/useActiveWorkspace";
import { InviteBanner } from "@/components/team/InviteBanner";
import { AppShell } from "@/components/layout/AppShell";
import { useNiches, useActiveNiche } from "@/lib/niches";
import { sendStageAutoMessage } from "@/lib/whatsapp-inbox.functions";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/board")({
  component: BoardPage,
});

function BoardPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");

  const workspaceQ = useActiveWorkspace(user.id);
  const workspaceId = workspaceQ.data?.id;
  const nichesQ = useNiches();
  const { activeNicheId } = useActiveNiche();
  const activeNiche = (nichesQ.data ?? []).find((n) => n.id === activeNicheId) ?? null;


  const [leadDialog, setLeadDialog] = useState<{ open: boolean; lead?: Lead; stageId?: string }>({ open: false });
  const [stageDialog, setStageDialog] = useState<{ open: boolean; stage?: Stage }>({ open: false });
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  const stagesQ = useQuery({
    queryKey: ["stages", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("stages").select("*").order("position");
      if (error) throw error;
      return data as Stage[];
    },
  });

  const leadsQ = useQuery({
    queryKey: ["leads", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").order("position");
      if (error) throw error;
      return data as Lead[];
    },
  });

  const unreadQ = useQuery({
    queryKey: ["lead-unread", user.id],
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("lead_id, unread_count")
        .gt("unread_count", 0)
        .not("lead_id", "is", null);
      if (error) throw error;
      return new Set((data ?? []).map((c: { lead_id: string }) => c.lead_id));
    },
  });
  const unreadLeadIds = unreadQ.data ?? new Set<string>();
  const [chatLead, setChatLead] = useState<Lead | null>(null);

  const moveLead = useMutation({
    mutationFn: async ({ id, stage_id }: { id: string; stage_id: string }) => {
      const { error } = await supabase.from("leads").update({ stage_id, position: Date.now() }).eq("id", id);
      if (error) throw error;
      const lead = (leadsQ.data ?? []).find((l) => l.id === id);
      const stage = (stagesQ.data ?? []).find((s) => s.id === stage_id);

      if (stage?.auto_send_whatsapp && lead?.telefone) {
        try {
          const r = await sendStageAutoMessage({ data: { leadId: id, stageId: stage_id } });
          if (r.ok && "sent" in r) toast.success(`Mensagem automática enviada (${stage.name})`);
          else if (!r.ok) toast.error("Envio automático falhou: " + r.error);
        } catch (err) {
          toast.error("Envio automático falhou: " + (err instanceof Error ? err.message : "erro"));
        }
      }

      if (stage?.trigger_webhook && stage.webhook_url && lead) {
        const message = renderTemplate(stage.message_template, lead);
        try {
          await fetch(stage.webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "lead.stage_changed",
              stage: { id: stage.id, name: stage.name },
              lead: {
                id: lead.id,
                nome: lead.nome,
                profissao: lead.profissao,
                telefone: lead.telefone,
                rede_social: lead.rede_social,
                link: lead.link,
                notes: lead.notes,
              },
              message_template: stage.message_template,
              message,
            }),
          });
          toast.success(`Webhook disparado: ${stage.name}`);
        } catch (err) {
          toast.error("Webhook falhou: " + (err instanceof Error ? err.message : "erro desconhecido"));
        }
      }
    },
    onMutate: async ({ id, stage_id }) => {
      await qc.cancelQueries({ queryKey: ["leads", user.id] });
      const prev = qc.getQueryData<Lead[]>(["leads", user.id]);
      qc.setQueryData<Lead[]>(["leads", user.id], (old) =>
        (old ?? []).map((l) => (l.id === id ? { ...l, stage_id } : l)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["leads", user.id], ctx.prev);
      toast.error("Erro ao mover lead");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["leads", user.id] }),
  });

  const visibleLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (leadsQ.data ?? [])
      .filter((l) => !activeNicheId || l.niche_id === activeNicheId)
      .filter((l) =>
        !q ||
        [l.nome, l.profissao, l.telefone, l.rede_social, l.link, l.notes]
          .some((v) => (v ?? "").toLowerCase().includes(q)),
      );
  }, [leadsQ.data, activeNicheId, search]);


  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    visibleLeads.forEach((l) => {
      const arr = map.get(l.stage_id) ?? [];
      arr.push(l);
      map.set(l.stage_id, arr);
    });
    // Leads com mensagens novas sobem para o topo da coluna
    map.forEach((arr) => {
      arr.sort((a, b) => Number(unreadLeadIds.has(b.id)) - Number(unreadLeadIds.has(a.id)));
    });
    return map;
  }, [visibleLeads, unreadLeadIds]);


  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragStart(e: DragStartEvent) {
    const l = e.active.data.current?.lead as Lead | undefined;
    if (l) setActiveLead(l);
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveLead(null);
    const overId = e.over?.id as string | undefined;
    const lead = e.active.data.current?.lead as Lead | undefined;
    if (!overId || !lead || overId === lead.stage_id) return;
    moveLead.mutate({ id: lead.id, stage_id: overId });
  }

  async function handleImport(file: File) {
    setImporting(true);
    try {
      const rows = await parseLeadsFile(file);
      if (rows.length === 0) {
        toast.error("Nenhum lead encontrado na planilha");
        return;
      }
      const stages = stagesQ.data ?? [];
      const stageByName = new Map(stages.map((s) => [s.name.toLowerCase(), s.id]));
      const defaultStage = stages[0]?.id;
      if (!defaultStage) {
        toast.error("Crie uma etapa primeiro");
        return;
      }
      if (!workspaceId) {
        toast.error("Workspace não carregado");
        return;
      }
      const payload = rows.map((r, i) => ({
        workspace_id: workspaceId,
        user_id: user.id,
        assigned_to: user.id,
        stage_id: (r.stage && stageByName.get(r.stage.toLowerCase())) || defaultStage,
        nome: r.nome,
        profissao: r.profissao,
        telefone: r.telefone,
        rede_social: r.rede_social,
        link: r.link,
        notes: r.notes,
        niche_id: activeNicheId,
        position: Date.now() + i,

      }));
      const { error } = await supabase.from("leads").insert(payload);
      if (error) throw error;
      toast.success(`${payload.length} leads importados`);
      qc.invalidateQueries({ queryKey: ["leads"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao importar");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleExport() {
    const stages = stagesQ.data ?? [];
    const stageMap = new Map(stages.map((s) => [s.id, s.name]));
    const rows = (leadsQ.data ?? []).map((l) => ({
      nome: l.nome,
      profissao: l.profissao,
      telefone: l.telefone,
      rede_social: l.rede_social,
      link: l.link,
      notes: l.notes,
      stage_name: stageMap.get(l.stage_id) ?? "",
    }));
    if (rows.length === 0) return toast.error("Nenhum lead para exportar");
    exportLeadsToExcel(rows);
  }

  const stages = stagesQ.data ?? [];
  const leads = visibleLeads;
  const nextStagePos = stages.length ? Math.max(...stages.map((s) => s.position)) + 1 : 0;

  const totalLeads = leads.length;
  const totalStages = stages.length;
  const encerramentoStage = stages.find((s) => /encerr/i.test(s.name));
  const encerrados = encerramentoStage ? (leadsByStage.get(encerramentoStage.id)?.length ?? 0) : 0;
  const conversao = totalLeads > 0 ? Math.round((encerrados / totalLeads) * 100) : 0;


  const toolbar = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
      />
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar lead..."
          aria-label="Buscar lead no pipeline"
          className="h-8 w-36 rounded-md border border-border/60 bg-surface/60 pl-8 pr-7 text-xs outline-none transition placeholder:text-muted-foreground focus:border-primary/60 sm:w-52"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            aria-label="Limpar busca"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <FileDown className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Excel</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={importing}>
            <Upload className="mr-2 h-4 w-4" /> Importar planilha
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" /> Exportar leads
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => downloadTemplate()}>
            <FileDown className="mr-2 h-4 w-4" /> Baixar modelo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" size="sm" onClick={() => setStageDialog({ open: true })}>
        <Plus className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Etapa</span>
      </Button>
      <Button size="sm" className="grad-brand text-primary-foreground" onClick={() => setLeadDialog({ open: true })}>
        <Plus className="mr-2 h-4 w-4" /> <span className="hidden sm:inline">Novo lead</span>
      </Button>
    </>
  );

  return (
    <AppShell
      user={user}
      title={activeNiche ? `Pipeline · ${activeNiche.name}` : "Pipeline de leads"}
      toolbar={toolbar}
      scrollable={false}
    >
      <div className="flex h-full flex-col">
        <InviteBanner userId={user.id} />

        {/* KPIs compactos */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 bg-surface/30 px-4 py-1.5 text-[11px] text-muted-foreground sm:px-6">
          {activeNiche && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 font-medium text-foreground">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: activeNiche.color }} />
              {activeNiche.name}
            </span>
          )}
          <Kpi label="Leads" value={totalLeads.toString()} icon={<UsersIcon className="h-3 w-3" />} />
          <Kpi label="Etapas" value={totalStages.toString()} icon={<TrendingUp className="h-3 w-3" />} />
          <Kpi label="Encerrados" value={encerrados.toString()} accent />
          <Kpi label="Conversão" value={`${conversao}%`} accent />
        </div>


        <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4 sm:p-6">
          {stagesQ.isLoading || leadsQ.isLoading ? (
            <div className="grid h-full place-items-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
              <div className="flex h-full gap-4 pb-4">
                {stages.map((stage) => (
                  <Column
                    key={stage.id}
                    stage={stage}
                    leads={leadsByStage.get(stage.id) ?? []}
                    onAddLead={() => setLeadDialog({ open: true, stageId: stage.id })}
                    onEditStage={() => setStageDialog({ open: true, stage })}
                    onEditLead={(lead) => setLeadDialog({ open: true, lead })}
                    unreadLeadIds={unreadLeadIds}
                    onOpenChat={(lead) => setChatLead(lead)}
                  />
                ))}
                <button
                  onClick={() => setStageDialog({ open: true })}
                  className="flex h-full w-72 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground transition hover:border-primary/60 hover:text-foreground"
                >
                  <Plus className="h-5 w-5" />
                  Nova etapa
                </button>
              </div>
              <DragOverlay>
                {activeLead && <LeadCard lead={activeLead} onEdit={() => {}} />}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        {chatLead && (
          <aside className="hidden w-[380px] shrink-0 flex-col border-l border-border/60 bg-card/40 p-3 lg:flex">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{chatLead.nome}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {chatLead.telefone}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Link
                  to="/inbox"
                  search={{ phone: normalizePhone(chatLead.telefone ?? ""), leadId: chatLead.id }}
                  className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                  aria-label="Abrir no Inbox WhatsApp"
                  title="Abrir no Inbox WhatsApp"
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => setChatLead(null)}
                  className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                  aria-label="Fechar conversa"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ConversationPanel
                key={chatLead.id}
                conversationId={null}
                leadId={chatLead.id}
                leadName={chatLead.nome}
                phone={normalizePhone(chatLead.telefone ?? "")}
              />
            </div>
          </aside>
        )}
      </div>
      </div>

      {leadDialog.open && workspaceId && (
        <LeadDialog
          key={leadDialog.lead?.id ?? leadDialog.stageId ?? "new"}
          userId={user.id}
          workspaceId={workspaceId}
          stages={stages}
          niches={nichesQ.data ?? []}
          defaultNicheId={activeNicheId}
          lead={leadDialog.lead}
          defaultStageId={leadDialog.stageId}
          open={leadDialog.open}
          onOpenChange={(o) => setLeadDialog({ open: o })}
        />
      )}

      {stageDialog.open && workspaceId && (
        <StageDialog
          key={stageDialog.stage?.id ?? "new-stage"}
          userId={user.id}
          workspaceId={workspaceId}
          stage={stageDialog.stage}
          nextPosition={nextStagePos}
          open={stageDialog.open}
          onOpenChange={(o) => setStageDialog({ open: o })}
        />
      )}
    </AppShell>
  );
}

function Kpi({ label, value, icon, accent }: { label: string; value: string; icon?: React.ReactNode; accent?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon && <span className={accent ? "text-primary" : "text-muted-foreground"}>{icon}</span>}
      <span className="uppercase tracking-widest">{label}</span>
      <span className={`font-semibold ${accent ? "text-primary" : "text-foreground"}`}>{value}</span>
    </span>
  );

}
