import Link from "next/link";

export function InstanceNotFoundMessage() {
  return (
    <div className="empty-state compact">
      <strong>Instancia nao encontrada</strong>
      <span>A URL informou uma instancia invalida. Escolha uma instancia operacional para continuar.</span>
      <Link className="button" href="/instancias">
        Abrir instancias
      </Link>
    </div>
  );
}
