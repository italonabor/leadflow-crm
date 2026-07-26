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
