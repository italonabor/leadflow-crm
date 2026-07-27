import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Niche = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  color: string;
  position: number;
};

const STORAGE_KEY = "prospecta.active-niche";
export const ACTIVE_NICHE_KEY = ["active-niche"] as const;

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function useNiches() {
  return useQuery({
    queryKey: ["niches"],
    queryFn: async () => {
      const { data, error } = await supabase.from("niches").select("*").order("position");
      if (error) throw error;
      return (data ?? []) as unknown as Niche[];
    },
  });
}

/** Quantidade de mensagens não lidas agrupadas por nicho (null = sem nicho) */
export function useNicheUnreadCounts() {
  return useQuery({
    queryKey: ["niche-unread"],
    refetchInterval: 20000,
    queryFn: async () => {
      const { data: convs, error } = await supabase
        .from("whatsapp_conversations")
        .select("lead_id, unread_count")
        .gt("unread_count", 0)
        .not("lead_id", "is", null);
      if (error) throw error;
      const rows = (convs ?? []) as { lead_id: string; unread_count: number }[];
      if (!rows.length) return {} as Record<string, number>;

      const { data: leads, error: e2 } = await supabase
        .from("leads")
        .select("id, niche_id")
        .in("id", rows.map((r) => r.lead_id));
      if (e2) throw e2;

      const nicheByLead = new Map(
        ((leads ?? []) as { id: string; niche_id: string | null }[]).map((l) => [l.id, l.niche_id]),
      );
      const counts: Record<string, number> = {};
      for (const r of rows) {
        const key = nicheByLead.get(r.lead_id) ?? "__none__";
        counts[key] = (counts[key] ?? 0) + (r.unread_count || 0);
      }
      return counts;
    },
  });
}


/** Marca como lidas todas as conversas dos leads de um nicho (null = todos). */
export function useMarkNicheRead() {
  const qc = useQueryClient();
  return async (nicheId: string | null) => {
    let leadIds: string[] = [];
    const query = supabase.from("leads").select("id");
    const { data: leads } = nicheId
      ? await query.eq("niche_id", nicheId)
      : await query;
    leadIds = ((leads ?? []) as { id: string }[]).map((l) => l.id);
    if (leadIds.length) {
      await supabase
        .from("whatsapp_conversations")
        .update({ unread_count: 0 })
        .gt("unread_count", 0)
        .in("lead_id", leadIds);
    }
    qc.invalidateQueries({ queryKey: ["niche-unread"] });
    qc.invalidateQueries({ queryKey: ["lead-unread"] });
  };
}

/** null = "Todos os nichos" */
export function useActiveNiche() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ACTIVE_NICHE_KEY,
    queryFn: async () => readStored(),
    staleTime: Infinity,
    initialData: () => readStored(),
  });

  function setActiveNiche(id: string | null) {
    if (typeof window !== "undefined") {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
    qc.setQueryData(ACTIVE_NICHE_KEY, id);
  }

  return { activeNicheId: data ?? null, setActiveNiche };
}
