import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Trash2, MessageCircle, Send } from "lucide-react";
import { buildWhatsAppLink, renderTemplate } from "@/lib/whatsapp";
import { sendWhatsAppCloudMessage } from "@/lib/whatsapp-cloud.functions";
import type { Lead, Stage } from "./types";

type Props = {
  userId: string;
  workspaceId: string;
  stages: Stage[];
  lead?: Lead;
  defaultStageId?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
};

export function LeadDialog({ userId, workspaceId, stages, lead, defaultStageId, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    nome: lead?.nome ?? "",
    profissao: lead?.profissao ?? "",
    telefone: lead?.telefone ?? "",
    rede_social: lead?.rede_social ?? "",
    link: lead?.link ?? "",
    notes: lead?.notes ?? "",
    stage_id: lead?.stage_id ?? defaultStageId ?? stages[0]?.id ?? "",
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Nome é obrigatório");
      if (lead) {
        const { error } = await supabase
          .from("leads")
          .update({
            nome: form.nome,
            profissao: form.profissao || null,
            telefone: form.telefone || null,
            rede_social: form.rede_social || null,
            link: form.link || null,
            notes: form.notes || null,
            stage_id: form.stage_id,
          })
          .eq("id", lead.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("leads").insert({
          workspace_id: workspaceId,
          user_id: userId,
          assigned_to: userId,
          nome: form.nome,
          profissao: form.profissao || null,
          telefone: form.telefone || null,
          rede_social: form.rede_social || null,
          link: form.link || null,
          notes: form.notes || null,
          stage_id: form.stage_id,
          position: Date.now(),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(lead ? "Lead atualizado" : "Lead criado");
      qc.invalidateQueries({ queryKey: ["leads"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!lead) return;
      const { error } = await supabase.from("leads").delete().eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lead excluído");
      qc.invalidateQueries({ queryKey: ["leads"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? "Editar lead" : "Novo lead"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Nome *</Label>
            <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Profissão</Label>
              <Input value={form.profissao} onChange={(e) => setForm({ ...form, profissao: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Telefone</Label>
              <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Rede social</Label>
              <Input placeholder="Instagram, LinkedIn..." value={form.rede_social} onChange={(e) => setForm({ ...form, rede_social: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Link</Label>
              <Input placeholder="https://" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Etapa</Label>
            <Select value={form.stage_id} onValueChange={(v) => setForm({ ...form, stage_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Observações</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {form.telefone && (
            <WhatsAppActions
              phone={form.telefone}
              message={renderTemplate(
                stages.find((s) => s.id === form.stage_id)?.message_template,
                { nome: form.nome, profissao: form.profissao || null, telefone: form.telefone || null, rede_social: form.rede_social || null, link: form.link || null },
              )}
            />
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {lead ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => del.mutate()} disabled={del.isPending}>
              <Trash2 className="mr-2 h-4 w-4" /> Excluir
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

function WhatsAppActions({ phone, message }: { phone: string; message: string }) {
  const send = useServerFn(sendWhatsAppCloudMessage);
  const [sending, setSending] = useState(false);

  async function sendCloud() {
    if (!message.trim()) return toast.error("Escreva uma mensagem-modelo na etapa antes de enviar.");
    setSending(true);
    try {
      await send({ data: { to: phone, message } });
      toast.success("Mensagem enviada pelo WhatsApp Business");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no envio");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <a
        href={buildWhatsAppLink(phone, message)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-400 transition hover:bg-emerald-500/20"
      >
        <MessageCircle className="h-4 w-4" /> Abrir no WhatsApp
      </a>
      <Button type="button" variant="outline" onClick={sendCloud} disabled={sending}>
        {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
        Enviar via WhatsApp Business
      </Button>
    </div>
  );
}

export function LeadDialogTrigger({ children, ...props }: Props & { children: React.ReactNode }) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <LeadDialog {...props} />
    </Dialog>
  );
}
