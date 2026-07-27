import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Layers, Plus, Pencil } from "lucide-react";
import { useNiches, useActiveNiche, useNicheUnreadCounts, useMarkNicheRead, type Niche } from "@/lib/niches";
import { NicheDialog } from "@/components/kanban/NicheDialog";

export function NicheNav({
  userId,
  workspaceId,
  onNavigate,
}: {
  userId: string;
  workspaceId: string;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const nichesQ = useNiches();
  const unreadQ = useNicheUnreadCounts();
  const unread = unreadQ.data ?? {};
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  const { activeNicheId, setActiveNiche } = useActiveNiche();
  const markNicheRead = useMarkNicheRead();
  const [dialog, setDialog] = useState<{ open: boolean; niche?: Niche }>({ open: false });

  const niches = nichesQ.data ?? [];
  const nextPosition = niches.length ? Math.max(...niches.map((n) => n.position)) + 1 : 0;

  function select(id: string | null) {
    setActiveNiche(id);
    void markNicheRead(id);
    onNavigate?.();
    navigate({ to: "/board" });
  }

  return (
    <div className="mt-5 px-2">
      <div className="flex items-center justify-between px-3 pb-1">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          <Layers className="h-3 w-3" /> Nichos
        </div>
        <button
          onClick={() => setDialog({ open: true })}
          className="rounded p-0.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          aria-label="Novo nicho"
          title="Novo nicho"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-0.5">
        <button
          onClick={() => select(null)}
          className={`flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition ${
            activeNicheId === null
              ? "bg-primary/15 font-medium text-primary"
              : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          }`}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50" />
          <span className="truncate">Todos os nichos</span>
          {totalUnread > 0 && (
            <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive-foreground">
              {totalUnread}
            </span>
          )}
        </button>

        {niches.map((n) => {
          const active = activeNicheId === n.id;
          const count = unread[n.id] ?? 0;
          return (
            <div
              key={n.id}
              className={`group flex items-center gap-1 rounded-md pr-1 transition ${
                active ? "bg-primary/15" : "hover:bg-surface-2"
              }`}
            >
              <button
                onClick={() => select(n.id)}
                className={`flex min-w-0 flex-1 items-center gap-2.5 px-3 py-1.5 text-left text-sm ${
                  active ? "font-medium text-primary" : "text-muted-foreground group-hover:text-foreground"
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: n.color }} />
                <span className="truncate">{n.name}</span>
                {count > 0 && (
                  <span className="ml-auto shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold leading-none text-destructive-foreground">
                    {count}
                  </span>
                )}
              </button>
              <button
                onClick={() => setDialog({ open: true, niche: n })}
                className="rounded p-1 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
                aria-label={`Editar ${n.name}`}
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        {niches.length === 0 && !nichesQ.isLoading && (
          <p className="px-3 py-1 text-[11px] leading-snug text-muted-foreground">
            Crie nichos (ex.: Dentistas, Arquitetos) para separar os leads por segmento.
          </p>
        )}
      </div>

      {dialog.open && (
        <NicheDialog
          key={dialog.niche?.id ?? "new-niche"}
          userId={userId}
          workspaceId={workspaceId}
          niche={dialog.niche}
          nextPosition={nextPosition}
          open={dialog.open}
          onOpenChange={(o) => setDialog({ open: o })}
          onDeleted={(id) => {
            if (activeNicheId === id) setActiveNiche(null);
          }}
        />
      )}
    </div>
  );
}
