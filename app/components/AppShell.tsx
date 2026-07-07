import Link from "next/link";

type AppShellProps = {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

export function AppShell({ title, children, actions }: AppShellProps) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" href="/dashboard">
          WA Sender Simple
        </Link>
        <nav className="nav" aria-label="Principal">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/whatsapp">WhatsApp</Link>
          <Link href="/conversas">Conversas</Link>
          <Link href="/etiquetas">Etiquetas</Link>
          <Link href="/envios">Envios</Link>
          <Link href="/contatos">Contatos</Link>
          <Link href="/campanhas">Campanhas</Link>
          <form action="/api/auth/logout" method="post">
            <button className="link-button" type="submit">
              Sair
            </button>
          </form>
        </nav>
      </header>
      <main className="page">
        <div className="page-header">
          <h1 className="page-title">{title}</h1>
          {actions}
        </div>
        {children}
      </main>
    </div>
  );
}
