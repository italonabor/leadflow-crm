import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveWorkspace } from "@/lib/useActiveWorkspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Trash2, Copy, Mail, MessageCircle, ShieldCheck, User as UserIcon } from "lucide-react";
import { AppShell, PageContainer } from "@/components/layout/AppShell";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
});

type Member = {
  user_id: string;
  role: "admin" | "atendente";
  email: string;
  display_name: string | null;
  created_at: string;
};

type Invite = {
  id: string;
  email: string;
  role: "admin" | "atendente";
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

function TeamPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const wsQ = useActiveWorkspace(user.id);
  const ws = wsQ.data;

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "atendente">("atendente");

  const membersQ = useQuery({
    queryKey: ["members", ws?.id],
    enabled: !!ws?.id,
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await supabase.rpc("list_workspace_members", { _workspace_id: ws!.id });
      if (error) throw error;
      return (data ?? []) as Member[];
    },
  });

  const invitesQ = useQuery({
    queryKey: ["invites", ws?.id],
    enabled: !!ws?.id,
    queryFn: async (): Promise<Invite[]> => {
      const { data, error } = await supabase
        .from("workspace_invites")
        .select("*")
        .eq("workspace_id", ws!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invite[];
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      if (!ws) throw new Error("Workspace não carregado");
      if (!email.trim()) throw new Error("Digite um e-mail");
      const token = crypto.randomUUID().replace(/-/g, "");
      const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from("workspace_invites").insert({
        workspace_id: ws.id,
        email: email.trim().toLowerCase(),
        role,
        token,
        expires_at,
        invited_by: user.id,
      });
      if (error) throw error;
      return { token, email: email.trim().toLowerCase() };
    },
    onSuccess: async (res) => {
      const link = inviteLink(res.token);
      try {
        await navigator.clipboard.writeText(link);
        toast.success("Convite criado e link copiado — envie ao vendedor.");
      } catch {
        toast.success("Convite criado. Copie o link na lista abaixo.");
      }
      setEmail("");
      qc.invalidateQueries({ queryKey: ["invites", ws?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function mailtoLink(to: string, token: string) {
    const subject = encodeURIComponent("Convite para o CRM Prospecta");
    const body = encodeURIComponent(
      `Olá!\n\nVocê foi convidado como vendedor no CRM Prospecta.\n\n1) Crie sua conta usando este mesmo e-mail: ${to}\n2) Abra o link do convite: ${inviteLink(token)}\n\nO convite expira em 7 dias.`,
    );
    return `mailto:${to}?subject=${subject}&body=${body}`;
  }

  function whatsappLink(token: string) {
    const text = encodeURIComponent(
      `Olá! Você foi convidado como vendedor no CRM Prospecta. Crie sua conta e abra este link: ${inviteLink(token)}`,
    );
    return `https://wa.me/?text=${text}`;
  }


  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("workspace_invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Convite revogado");
      qc.invalidateQueries({ queryKey: ["invites", ws?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMember = useMutation({
    mutationFn: async (uid: string) => {
      if (!ws) return;
      const { error } = await supabase
        .from("workspace_members")
        .delete()
        .eq("workspace_id", ws.id)
        .eq("user_id", uid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membro removido");
      qc.invalidateQueries({ queryKey: ["members", ws?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isAdmin = ws?.role === "admin";
  const inviteLink = (t: string) => `${window.location.origin}/board?invite=${t}`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <AppShell user={user} title="Equipe & vendedores">
      <PageContainer>
        {!ws ? (
          <div className="grid h-40 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-8">
            {isAdmin && (
              <section className="rounded-xl border border-border/60 bg-card p-5 shadow-card">
                <h2 className="mb-3 font-display text-lg font-semibold">Convidar vendedor</h2>
                <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
                  <div className="grid gap-1">
                    <Label>E-mail</Label>
                    <Input
                      type="email"
                      placeholder="vendedor@empresa.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label>Papel</Label>
                    <Select value={role} onValueChange={(v) => setRole(v as "admin" | "atendente")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="atendente">Vendedor</SelectItem>
                        <SelectItem value="admin">Administrador</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid items-end">
                    <Button className="grad-brand text-primary-foreground" onClick={() => invite.mutate()} disabled={invite.isPending}>
                      {invite.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      <Mail className="mr-2 h-4 w-4" /> Convidar
                    </Button>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Ao criar, o link do convite é copiado automaticamente. Você pode enviá-lo por
                  e-mail ou WhatsApp nos botões da lista de convites pendentes. O vendedor precisa
                  criar a conta com o mesmo e-mail e o convite aparece automaticamente para
                  aceitação. (Envio automático de e-mail exige um domínio de e-mail configurado.)
                </p>
              </section>
            )}

            <section>
              <h2 className="mb-3 font-display text-lg font-semibold">Membros ({membersQ.data?.length ?? 0})</h2>
              <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
                {(membersQ.data ?? []).map((m) => (
                  <div key={m.user_id} className="flex items-center gap-3 p-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                      {(m.display_name || m.email)[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{m.display_name || m.email}</div>
                      <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs">
                      {m.role === "admin" ? <ShieldCheck className="h-3 w-3 text-primary" /> : <UserIcon className="h-3 w-3" />}
                      {m.role === "admin" ? "Admin" : "Vendedor"}
                    </span>
                    {isAdmin && m.user_id !== user.id && m.user_id !== ws.owner_id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeMember.mutate(m.user_id)}
                        aria-label="Remover"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {(membersQ.data ?? []).length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">Nenhum membro carregado.</div>
                )}
              </div>
            </section>

            {isAdmin && (
              <section>
                <h2 className="mb-3 font-display text-lg font-semibold">Convites pendentes</h2>
                <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
                  {(invitesQ.data ?? []).filter((i) => !i.accepted_at).map((i) => (
                    <div key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{i.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {i.role === "admin" ? "Administrador" : "Vendedor"} · expira{" "}
                          {new Date(i.expires_at).toLocaleDateString("pt-BR")}
                        </div>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => copy(inviteLink(i.token))}>
                        <Copy className="mr-2 h-3.5 w-3.5" /> Copiar link
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a href={mailtoLink(i.email, i.token)}>
                          <Mail className="mr-2 h-3.5 w-3.5" /> Enviar por e-mail
                        </a>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a href={whatsappLink(i.token)} target="_blank" rel="noreferrer">
                          <MessageCircle className="mr-2 h-3.5 w-3.5" /> WhatsApp
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => revoke.mutate(i.id)}
                        aria-label="Revogar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {(invitesQ.data ?? []).filter((i) => !i.accepted_at).length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground">Nenhum convite pendente.</div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </PageContainer>
    </AppShell>
  );
}
