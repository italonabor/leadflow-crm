import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Phone, Link as LinkIcon, AtSign, Briefcase, Pencil, MessageCircle, Copy } from "lucide-react";
import type { Lead, Stage } from "./types";
import { buildWhatsAppLink, renderTemplate } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copiado: " + text);
  } catch {
    toast.error("Não foi possível copiar");
  }
}

export function LeadCard({ lead, onEdit, stage }: { lead: Lead; onEdit: () => void; stage?: Stage }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { type: "lead", lead },
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "group cursor-grab touch-none rounded-md border border-border/70 bg-card px-2 py-1 shadow-card transition hover:border-primary/40 active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-1.5">
          <h4 className="truncate text-[12px] font-semibold leading-tight">{lead.nome}</h4>
          <div
            className="flex shrink-0 items-center gap-0.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {lead.telefone && (
              <a
                href={buildWhatsAppLink(lead.telefone, renderTemplate(stage?.message_template, lead))}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded p-0.5 text-emerald-500 opacity-0 transition hover:bg-emerald-500/10 group-hover:opacity-100"
                aria-label="Abrir WhatsApp"
              >
                <MessageCircle className="h-3 w-3" />
              </a>
            )}
            <button
              onClick={onEdit}
              className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-surface-2 hover:text-foreground group-hover:opacity-100"
              aria-label="Editar"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div
          className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] leading-tight text-muted-foreground"
          onPointerDown={(e) => {
            // permite arrastar a partir dos textos, mas botões/links internos param propagação
          }}
        >
          {lead.profissao && (
            <span className="flex min-w-0 items-center gap-1 truncate"><Briefcase className="h-2.5 w-2.5 shrink-0" />{lead.profissao}</span>
          )}
          {lead.telefone && (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); copyToClipboard(lead.telefone!); }}
              className="flex min-w-0 items-center gap-1 truncate hover:text-foreground"
              title="Clique para copiar"
            >
              <Phone className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{lead.telefone}</span>
              <Copy className="h-2.5 w-2.5 shrink-0 opacity-40" />
            </button>
          )}
          {lead.rede_social && (
            <span className="flex min-w-0 items-center gap-1 truncate"><AtSign className="h-2.5 w-2.5 shrink-0" />{lead.rede_social}</span>
          )}
          {lead.link && (
            <a
              href={lead.link}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-1 truncate text-primary hover:underline"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <LinkIcon className="h-2.5 w-2.5 shrink-0" /><span className="truncate">{lead.link}</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}


export function Column({
  stage,
  leads,
  onAddLead,
  onEditStage,
  onEditLead,
}: {
  stage: Stage;
  leads: Lead[];
  onAddLead: () => void;
  onEditStage: () => void;
  onEditLead: (lead: Lead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { type: "stage", stage } });

  return (
    <div className="flex h-full w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <button onClick={onEditStage} className="group flex min-w-0 items-center gap-2 text-left">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
          <span className="truncate font-display text-sm font-semibold group-hover:text-primary">{stage.name}</span>
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{leads.length}</span>
        </button>
        <button
          onClick={onAddLead}
          className="rounded-md p-1 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          aria-label="Adicionar lead"
        >
          +
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 space-y-1.5 overflow-y-auto rounded-xl border border-border/60 bg-surface/40 p-1.5 transition",
          isOver && "border-primary/60 bg-primary/5",
        )}
        style={{ minHeight: 200 }}
      >
        {leads.length === 0 ? (
          <div className="grid h-20 place-items-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
            Solte um lead aqui
          </div>

        ) : (
          leads.map((lead) => <LeadCard key={lead.id} lead={lead} stage={stage} onEdit={() => onEditLead(lead)} />)
        )}
      </div>
    </div>
  );
}
