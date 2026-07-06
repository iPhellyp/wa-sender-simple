type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const nextParam = typeof params.next === "string" ? params.next : "/dashboard";
  const nextPath =
    nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  const hasError = params.error === "1";
  const hasServerConfigError = params.error === "server_config";

  return (
    <main className="page" style={{ maxWidth: 460 }}>
      <section className="card">
        <h1 className="page-title">WA Sender Simple</h1>
        <form className="form-grid" action="/api/auth/login" method="post" style={{ marginTop: 20 }}>
          <input name="next" type="hidden" value={nextPath} />
          <div className="field">
            <label htmlFor="password">Senha admin</label>
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {hasError ? <div className="message error">Senha invalida.</div> : null}
          {hasServerConfigError ? (
            <div className="message error">ADMIN_PASSWORD ausente no servidor.</div>
          ) : null}
          <button className="button" type="submit">
            Entrar
          </button>
        </form>
      </section>
    </main>
  );
}
