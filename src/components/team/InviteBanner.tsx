import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Mail, Check, X, Loader2 } from "lucide-react";

type PendingInvite = {
  id: string;
  workspace_id: string;
  role: "admin" | "atendente";
  email: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  workspaces: { name: string } | null;
};

export function InviteBanner({ userId }: { userId: string }) {
  const qc = useQueryClient();

  const invitesQ = useQuery({
    queryKey: ["my-invites", userId],
    queryFn: async (): Promise<PendingInvite[]> => {
      const { data, error } = await supabase
        .from("workspace_invites")
        .select("id, workspace_id, role, email, expires_at, accepted_at, workspaces(name)")
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString());
      if (error) throw error;
      return (data ?? []) as unknown as PendingInvite[];
    },
  });

  const accept = useMutation({
    mutationFn: async (inv: PendingInvite) => {
      const { error: mErr } = await supabase.from("workspace_members").insert({
        workspace_id: inv.workspace_id,
        user_id: userId,
        role: inv.role,
      });
      if (mErr && !/duplicate|unique/i.test(mErr.message)) throw mErr;
      const { error: uErr } = await supabase
        .from("workspace_invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", inv.id);
      if (uErr) throw uErr;
    },
    onSuccess: () => {
      toast.success("Convite aceito! Você agora faz parte do workspace.");
      qc.invalidateQueries({ queryKey: ["my-invites", userId] });
      qc.invalidateQueries({ queryKey: ["active-workspace", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decline = useMutation({
    mutationFn: async (inv: PendingInvite) => {
      const { error } = await supabase
        .from("workspace_invites")
        .update({ accepted_at: new Date(0).toISOString() })
        .eq("id", inv.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-invites", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invites = invitesQ.data ?? [];
  if (invites.length === 0) return null;

  return (
    <div className="mx-4 mt-3 space-y-2 sm:mx-6">
      {invites.map((inv) => (
        <div
          key={inv.id}
          className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm"
        >
          <Mail className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            Você foi convidado como <b>{inv.role === "admin" ? "Administrador" : "Vendedor"}</b>
            {inv.workspaces?.name && <> para o workspace <b>{inv.workspaces.name}</b></>}.
          </div>
          <Button size="sm" className="grad-brand text-primary-foreground" onClick={() => accept.mutate(inv)} disabled={accept.isPending}>
            {accept.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}
            Aceitar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => decline.mutate(inv)} disabled={decline.isPending}>
            <X className="mr-2 h-3.5 w-3.5" /> Recusar
          </Button>
        </div>
      ))}
    </div>
  );
}
