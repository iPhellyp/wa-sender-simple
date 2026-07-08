import Link from "next/link";

export function InstanceNotFoundMessage() {
  return (
    <div className="empty-state compact">
      <strong>Instancia nao encontrada</strong>
      <span>Escolha uma instancia operacional ou crie a primeira instancia para continuar.</span>
      <Link className="button" href="/instancias">
        Abrir instancias
      </Link>
    </div>
  );
}
