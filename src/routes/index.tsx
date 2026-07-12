import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileSpreadsheet, Kanban, Users, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="grad-brand grid h-9 w-9 place-items-center rounded-lg">
            <Kanban className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight">Prospecta</span>
        </div>
        <nav className="flex items-center gap-3">
          <Link
            to="/auth"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Entrar
          </Link>
          <Link
            to="/auth"
            search={{ mode: "signup" }}
            className="grad-brand rounded-md px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Começar grátis
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-16 pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface/60 px-3 py-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            CRM Kanban para prospecção
          </span>
          <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
            Qualifique leads
            <br />
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              arrastando cards.
            </span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
            Importe sua planilha do Excel, arraste os leads entre etapas do funil e
            exporte quando quiser. Rápido, visual e feito para vendedores.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              to="/auth"
              search={{ mode: "signup" }}
              className="grad-brand inline-flex items-center gap-2 rounded-lg px-6 py-3 text-base font-semibold text-primary-foreground shadow-glow transition hover:opacity-90"
            >
              Criar conta grátis <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/auth"
              className="rounded-lg border border-border bg-surface/60 px-6 py-3 text-base font-semibold transition hover:bg-surface-2"
            >
              Já tenho conta
            </Link>
          </div>
        </div>

        <div className="mt-24 grid gap-6 md:grid-cols-3">
          {[
            { icon: FileSpreadsheet, title: "Excel de ida e volta", desc: "Importe e exporte planilhas com nome, profissão, telefone, rede social e link em um clique." },
            { icon: Kanban, title: "Kanban customizável", desc: "Crie suas próprias etapas: Lead inicial, Contato feito, Up 1, Up 2, Encerramento — do seu jeito." },
            { icon: Zap, title: "Arrasta e solta", desc: "Mova leads entre colunas com naturalidade. Sem cliques extras, sem fricção." },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="glass rounded-xl p-6">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-border/60 py-8 text-center text-sm text-muted-foreground">
        <div className="flex items-center justify-center gap-2">
          <Users className="h-4 w-4" /> Feito para quem prospecta de verdade.
        </div>
      </footer>
    </div>
  );
}
