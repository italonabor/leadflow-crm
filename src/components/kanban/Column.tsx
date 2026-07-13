import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Phone, Link as LinkIcon, AtSign, Briefcase, GripVertical, Pencil, MessageCircle } from "lucide-react";
import type { Lead, Stage } from "./types";
import { buildWhatsAppLink, renderTemplate } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

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
      className={cn(
        "group rounded-lg border border-border/70 bg-card p-3 shadow-card transition",
        isDragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          {...listeners}
          {...attributes}
          className="mt-0.5 cursor-grab touch-none text-muted-foreground/60 opacity-0 transition group-hover:opacity-100 active:cursor-grabbing"
          aria-label="Arrastar"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="truncate font-semibold">{lead.nome}</h4>
            <div className="flex shrink-0 items-center gap-0.5">
              {lead.telefone && (
                <a
                  href={buildWhatsAppLink(lead.telefone, renderTemplate(stage?.message_template, lead))}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="rounded p-1 text-emerald-500 opacity-0 transition hover:bg-emerald-500/10 group-hover:opacity-100"
                  aria-label="Abrir WhatsApp"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                </a>
              )}
              <button
                onClick={onEdit}
                className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-surface-2 hover:text-foreground group-hover:opacity-100"
                aria-label="Editar"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {lead.profissao && (
              <div className="flex items-center gap-1.5 truncate"><Briefcase className="h-3 w-3 shrink-0" />{lead.profissao}</div>
            )}
            {lead.telefone && (
              <div className="flex items-center gap-1.5 truncate"><Phone className="h-3 w-3 shrink-0" />{lead.telefone}</div>
            )}
            {lead.rede_social && (
              <div className="flex items-center gap-1.5 truncate"><AtSign className="h-3 w-3 shrink-0" />{lead.rede_social}</div>
            )}
            {lead.link && (
              <a
                href={lead.link}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 truncate text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <LinkIcon className="h-3 w-3 shrink-0" />{lead.link}
              </a>
            )}
          </div>
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
    <div className="flex h-full w-80 shrink-0 flex-col">
      <div className="mb-3 flex items-center justify-between px-1">
        <button onClick={onEditStage} className="group flex min-w-0 items-center gap-2 text-left">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
          <span className="truncate font-display font-semibold group-hover:text-primary">{stage.name}</span>
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{leads.length}</span>
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
          "flex-1 space-y-2 overflow-y-auto rounded-xl border border-border/60 bg-surface/40 p-2 transition",
          isOver && "border-primary/60 bg-primary/5",
        )}
        style={{ minHeight: 200 }}
      >
        {leads.length === 0 ? (
          <div className="grid h-24 place-items-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
            Solte um lead aqui
          </div>
        ) : (
          leads.map((lead) => <LeadCard key={lead.id} lead={lead} stage={stage} onEdit={() => onEditLead(lead)} />)
        )}
      </div>
    </div>
  );
}
