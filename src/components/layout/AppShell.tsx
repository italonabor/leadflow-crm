import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveWorkspace } from "@/lib/useActiveWorkspace";
import { Button } from "@/components/ui/button";
import {
  Kanban,
  Users,
  Workflow,
  MessageCircle,
  MessageSquare,
  Rocket,
  LogOut,
  Menu,
  X,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NicheNav } from "@/components/layout/NicheNav";


type NavItem = {
  to: "/board" | "/team" | "/inbox" | "/whatsapp" | "/prospect" | "/chat" | "/integrations";
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
};

const NAV: NavItem[] = [
  { to: "/board", label: "Pipeline", icon: <Kanban className="h-4 w-4" /> },
  { to: "/inbox", label: "Inbox WhatsApp", icon: <MessageCircle className="h-4 w-4" /> },
  { to: "/prospect", label: "Prospecção", icon: <Rocket className="h-4 w-4" /> },
  { to: "/team", label: "Equipe", icon: <Users className="h-4 w-4" /> },
  { to: "/chat", label: "Chat", icon: <MessageSquare className="h-4 w-4" /> },
  { to: "/whatsapp", label: "WhatsApp API", icon: <MessageCircle className="h-4 w-4" /> },
  { to: "/integrations", label: "Integrações", icon: <Workflow className="h-4 w-4" /> },
];

export function AppShell({
  user,
  title,
  toolbar,
  children,
  contentClassName = "",
  scrollable = true,
}: {
  user: { id: string; email?: string | null };
  title: string;
  toolbar?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  scrollable?: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const workspaceQ = useActiveWorkspace(user.id);
  const ws = workspaceQ.data;
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const initial = (user.email ?? "?")[0]!.toUpperCase();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border/60 bg-surface/70 backdrop-blur transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <Link to="/board" className="flex min-w-0 items-center gap-2" onClick={() => setMobileOpen(false)}>
            <div className="grad-brand grid h-9 w-9 shrink-0 place-items-center rounded-lg">
              <Kanban className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-display text-base font-bold leading-tight">Prospecta</div>
              <div className="truncate text-[11px] text-muted-foreground">CRM de prospecção</div>
            </div>
          </Link>
          <button
            className="rounded-md p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {ws && (
          <div className="mx-3 mb-3 rounded-lg border border-border/60 bg-card/60 px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Workspace</div>
            <div className="mt-0.5 truncate text-sm font-semibold">{ws.name}</div>
            <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {ws.role === "admin" ? "Administrador" : "Vendedor"}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <nav className="space-y-0.5 px-2">
            {NAV.map((item) => {
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-primary/15 text-primary shadow-[inset_2px_0_0_0_var(--primary)]"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  <span className={active ? "text-primary" : ""}>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {ws && (
            <NicheNav
              userId={user.id}
              workspaceId={ws.id}
              onNavigate={() => setMobileOpen(false)}
            />
          )}
        </div>


        <div className="border-t border-border/60 p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{user.email}</div>
                  <div className="text-[11px] text-muted-foreground">Conta</div>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-56">
              <div className="px-2 py-1.5 text-xs text-muted-foreground">{user.email}</div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {mobileOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Fechar"
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass flex items-center gap-3 border-b border-border/60 px-4 py-3 sm:px-6">
          <button
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="truncate font-display text-lg font-semibold sm:text-xl">{title}</h1>
          {toolbar && <div className="ml-auto flex items-center gap-2">{toolbar}</div>}
        </header>

        <main className={`flex-1 min-h-0 ${scrollable ? "overflow-auto" : "overflow-hidden"} ${contentClassName}`}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 ${className}`}>{children}</div>;
}

// Re-export for pages that want the sign-out helper elsewhere
export { Button };
