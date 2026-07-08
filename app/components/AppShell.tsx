import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ActiveInstanceSelector } from "./ActiveInstanceSelector";
import { NavLink } from "./NavLink";
import { PageHeader } from "./ui/PageHeader";

type AppShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
};

export function AppShell({ title, subtitle, children, actions }: AppShellProps) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/dashboard">
            <span className="brand-mark">WA</span>
            <span>
              <strong>WA Sender Simple</strong>
              <small>Operacao WhatsApp</small>
            </span>
          </Link>
          <nav className="nav" aria-label="Principal">
            <NavLink href="/dashboard">Dashboard</NavLink>
            <NavLink href="/whatsapp">WhatsApp</NavLink>
            <NavLink href="/conversas">Conversas</NavLink>
            <NavLink href="/etiquetas">Etiquetas</NavLink>
            <NavLink href="/envios">Envios</NavLink>
            <NavLink href="/contatos">Contatos</NavLink>
            <NavLink href="/campanhas">Campanhas</NavLink>
            <NavLink href="/instancias">Instancias</NavLink>
            <form action="/api/auth/logout" method="post">
              <button className="link-button" type="submit">
                Sair
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="page">
        <Suspense fallback={null}>
          <ActiveInstanceSelector />
        </Suspense>
        <PageHeader title={title} subtitle={subtitle} actions={actions} />
        {children}
      </main>
    </div>
  );
}

