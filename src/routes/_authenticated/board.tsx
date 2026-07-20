import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Column, LeadCard } from "@/components/kanban/Column";
import { LeadDialog } from "@/components/kanban/LeadDialog";
import { StageDialog } from "@/components/kanban/StageDialog";
import type { Lead, Stage } from "@/components/kanban/types";
import { downloadTemplate, exportLeadsToExcel, parseLeadsFile } from "@/lib/excel";
import { toast } from "sonner";
import { Download, Upload, Plus, Kanban, LogOut, FileDown, Loader2, Workflow, Users } from "lucide-react";
import { renderTemplate } from "@/lib/whatsapp";
import { useActiveWorkspace } from "@/lib/useActiveWorkspace";
import { InviteBanner } from "@/components/team/InviteBanner";

export const Route = createFileRoute("/_authenticated/board")({
  component: BoardPage,
});

function BoardPage() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const workspaceQ = useActiveWorkspace(user.id);
  const workspaceId = workspaceQ.data?.id;

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

  const moveLead = useMutation({
    mutationFn: async ({ id, stage_id }: { id: string; stage_id: string }) => {
      const { error } = await supabase.from("leads").update({ stage_id, position: Date.now() }).eq("id", id);
      if (error) throw error;
      // Fire n8n webhook if the destination stage has one configured.
      const lead = (leadsQ.data ?? []).find((l) => l.id === id);
      const stage = (stagesQ.data ?? []).find((s) => s.id === stage_id);
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

  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    (leadsQ.data ?? []).forEach((l) => {
      const arr = map.get(l.stage_id) ?? [];
      arr.push(l);
      map.set(l.stage_id, arr);
    });
    return map;
  }, [leadsQ.data]);

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

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
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
  const nextStagePos = stages.length ? Math.max(...stages.map((s) => s.position)) + 1 : 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="glass flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 sm:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <div className="grad-brand grid h-8 w-8 shrink-0 place-items-center rounded-lg">
            <Kanban className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="truncate font-display text-lg font-bold">Prospecta</span>
        </Link>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            <span className="hidden sm:inline">Importar</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Exportar</span>
          </Button>
          <Button size="sm" className="grad-brand text-primary-foreground" onClick={() => setLeadDialog({ open: true })}>
            <Plus className="mr-2 h-4 w-4" />
            <span className="hidden sm:inline">Novo lead</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
                  {(user.email ?? "?")[0].toUpperCase()}
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5 text-xs text-muted-foreground">{user.email}</div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setStageDialog({ open: true })}>
                <Plus className="mr-2 h-4 w-4" /> Nova etapa
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadTemplate()}>
                <FileDown className="mr-2 h-4 w-4" /> Baixar modelo Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate({ to: "/integrations" })}>
                <Workflow className="mr-2 h-4 w-4" /> Integração n8n / WhatsApp
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="flex-1 overflow-x-auto overflow-y-hidden p-4 sm:p-6">
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
      </main>

      {leadDialog.open && workspaceId && (
        <LeadDialog
          key={leadDialog.lead?.id ?? leadDialog.stageId ?? "new"}
          userId={user.id}
          workspaceId={workspaceId}
          stages={stages}
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
    </div>
  );
}
