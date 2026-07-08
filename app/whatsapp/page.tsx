import { Suspense } from "react";
import { AppShell } from "@/app/components/AppShell";
import { WhatsappClient } from "./WhatsappClient";

export default function WhatsappPage() {
  return (
    <AppShell title="WhatsApp" subtitle="Conexao, catalogo e manutencao da instancia principal.">
      <Suspense fallback={<div className="data-card empty-state compact">Carregando WhatsApp...</div>}>
        <WhatsappClient />
      </Suspense>
    </AppShell>
  );
}


