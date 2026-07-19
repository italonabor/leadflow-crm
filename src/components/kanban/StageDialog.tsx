import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import type { Stage } from "./types";

const PRESET_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#ef4444", "#14b8a6"];

export function StageDialog({
  userId,
  workspaceId,
  stage,
  nextPosition,
  open,
  onOpenChange,
}: {
  userId: string;
  workspaceId: string;
  stage?: Stage;
  nextPosition: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(stage?.name ?? "");
  const [color, setColor] = useState(stage?.color ?? PRESET_COLORS[0]);
  const [messageTemplate, setMessageTemplate] = useState(stage?.message_template ?? "");
  const [webhookUrl, setWebhookUrl] = useState(stage?.webhook_url ?? "");
  const [triggerWebhook, setTriggerWebhook] = useState(stage?.trigger_webhook ?? false);

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nome é obrigatório");
      const payload = {
        name,
        color,
        message_template: messageTemplate.trim() || null,
        webhook_url: webhookUrl.trim() || null,
        trigger_webhook: triggerWebhook && !!webhookUrl.trim(),
      };
      if (stage) {
        const { error } = await supabase.from("stages").update(payload).eq("id", stage.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("stages").insert({ workspace_id: workspaceId, user_id: userId, position: nextPosition, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(stage ? "Etapa atualizada" : "Etapa criada");
      qc.invalidateQueries({ queryKey: ["stages"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!stage) return;
      const { error } = await supabase.from("stages").delete().eq("id", stage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Etapa excluída");
      qc.invalidateQueries({ queryKey: ["stages"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{stage ? "Editar etapa" : "Nova etapa"}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
          <div className="grid gap-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Proposta enviada" />
          </div>
          <div className="grid gap-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-9 w-9 rounded-full border-2 transition"
                  style={{ backgroundColor: c, borderColor: color === c ? "white" : "transparent" }}
                />
              ))}
            </div>
          </div>

          <div className="mt-2 rounded-lg border border-border/60 bg-surface/40 p-3">
            <div className="mb-3 text-sm font-semibold">WhatsApp & Automação</div>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label>Mensagem-modelo do WhatsApp</Label>
                <Textarea
                  rows={3}
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  placeholder="Olá {nome}, tudo bem?"
                />
                <p className="text-xs text-muted-foreground">
                  Placeholders: <code>{"{nome}"}</code>, <code>{"{profissao}"}</code>, <code>{"{telefone}"}</code>,{" "}
                  <code>{"{rede_social}"}</code>, <code>{"{link}"}</code>
                </p>
              </div>
              <div className="grid gap-2">
                <Label>Webhook n8n (opcional)</Label>
                <Input
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://seu-n8n/webhook/..."
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-sm">Disparar webhook ao mover lead para esta etapa</Label>
                  <p className="text-xs text-muted-foreground">Requer URL de webhook.</p>
                </div>
                <Switch
                  checked={triggerWebhook}
                  onCheckedChange={setTriggerWebhook}
                  disabled={!webhookUrl.trim()}
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {stage ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => del.mutate()} disabled={del.isPending}>
              <Trash2 className="mr-2 h-4 w-4" /> Excluir etapa
            </Button>
          ) : <div />}
          <Button className="grad-brand text-primary-foreground" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
