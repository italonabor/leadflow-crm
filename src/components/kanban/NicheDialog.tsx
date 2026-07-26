import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import type { Niche } from "@/lib/niches";

const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#ef4444", "#14b8a6"];

export function NicheDialog({
  userId,
  workspaceId,
  niche,
  nextPosition,
  open,
  onOpenChange,
  onDeleted,
}: {
  userId: string;
  workspaceId: string;
  niche?: Niche;
  nextPosition: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDeleted?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(niche?.name ?? "");
  const [color, setColor] = useState(niche?.color ?? COLORS[0]);

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Informe o nome do nicho");
      if (niche) {
        const { error } = await supabase
          .from("niches")
          .update({ name: name.trim(), color })
          .eq("id", niche.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("niches").insert({
          workspace_id: workspaceId,
          user_id: userId,
          name: name.trim(),
          color,
          position: nextPosition,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(niche ? "Nicho atualizado" : "Nicho criado");
      qc.invalidateQueries({ queryKey: ["niches"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!niche) return;
      const { error } = await supabase.from("niches").delete().eq("id", niche.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nicho excluído (os leads foram mantidos sem nicho)");
      qc.invalidateQueries({ queryKey: ["niches"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      if (niche) onDeleted?.(niche.id);
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{niche ? "Editar nicho" : "Novo nicho"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Nome</Label>
            <Input
              autoFocus
              placeholder="Dentistas, Arquitetos…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save.mutate()}
            />
          </div>
          <div className="grid gap-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition ${color === c ? "border-foreground scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {niche ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => del.mutate()} disabled={del.isPending}>
              <Trash2 className="mr-2 h-4 w-4" /> Excluir
            </Button>
          ) : (
            <div />
          )}
          <Button className="grad-brand text-primary-foreground" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
