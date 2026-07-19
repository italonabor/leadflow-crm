import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ActiveWorkspace = {
  id: string;
  name: string;
  role: "admin" | "atendente";
  owner_id: string;
};

export function useActiveWorkspace(userId: string) {
  return useQuery({
    queryKey: ["active-workspace", userId],
    queryFn: async (): Promise<ActiveWorkspace | null> => {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("role, workspace_id, workspaces!inner(id, name, owner_id)")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const w = data.workspaces as unknown as { id: string; name: string; owner_id: string };
      return { id: w.id, name: w.name, owner_id: w.owner_id, role: data.role as "admin" | "atendente" };
    },
  });
}
